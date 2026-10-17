//! Backup and restore.
//!
//! A backup is a ZIP containing:
//!   * `balance.db`     — a consistent copy taken with `VACUUM INTO`
//!   * `manifest.json`  — app version, schema version, row counts, checksum
//!
//! Restore is deliberately paranoid, because it replaces the user's only copy of
//! their financial history. The order is:
//!
//!   1. Read and validate the archive *without touching the live database*.
//!   2. Refuse if the backup was written by a newer schema than this build.
//!   3. Write an automatic safety backup of the current database.
//!   4. Move the current database aside, move the restored one into place.
//!   5. Roll back to the safety copy if any step fails.
//!
//! Nothing is deleted until a complete replacement is sitting on disk.

use crate::error::{AppError, AppResult};
use crate::paths;
use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqliteConnection};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const DB_ENTRY: &str = "balance.db";
const MANIFEST_ENTRY: &str = "manifest.json";

/// Contents of `manifest.json` inside a backup archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub app_name: String,
    pub app_version: String,
    pub schema_version: i64,
    /// ISO 8601 UTC.
    pub created_at: String,
    pub counts: TableCounts,
    /// FNV-1a hash of the database bytes, to catch a truncated archive.
    pub checksum: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TableCounts {
    pub accounts: i64,
    pub categories: i64,
    pub snapshots: i64,
    pub transactions: i64,
    pub budgets: i64,
}

/// What the frontend shows before the user confirms a restore.
#[derive(Debug, Serialize)]
pub struct BackupInspection {
    pub manifest: BackupManifest,
    /// True when the archive can be restored by this build.
    pub compatible: bool,
    /// Thai explanation when `compatible` is false.
    pub reason: Option<String>,
}

// ── checksum ────────────────────────────────────────────────────────────────

/// FNV-1a, 64-bit. Not cryptographic — this only needs to detect truncation or
/// corruption, and avoiding a crypto dependency keeps the build lean.
fn checksum(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

// ── backup ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_backup(app: tauri::AppHandle, path: String) -> AppResult<BackupManifest> {
    let db_path = paths::database_path(&app)?;
    if !db_path.exists() {
        return Err(AppError::NotFound(
            "ยังไม่มีฐานข้อมูลให้สำรอง (ไม่พบไฟล์ balance.db)".into(),
        ));
    }

    let counts = count_tables(&db_path).await?;
    let staged = paths::temp_path("backup.db")?;

    // `VACUUM INTO` writes a consistent snapshot without stopping the app or
    // requiring the live connection to be closed. The path is interpolated
    // because SQLite does not accept a bound parameter here; it is a path we
    // generated ourselves, and quotes are escaped defensively.
    let escaped = staged.to_string_lossy().replace('\'', "''");
    let mut conn = open(&db_path).await?;
    sqlx::query(&format!("VACUUM INTO '{escaped}'"))
        .execute(&mut conn)
        .await?;
    conn.close().await.ok();

    let bytes = std::fs::read(&staged)?;
    let manifest = BackupManifest {
        app_name: "Balance".into(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: crate::SCHEMA_VERSION,
        created_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        counts,
        checksum: checksum(&bytes),
    };

    write_archive(Path::new(&path), &bytes, &manifest)?;
    std::fs::remove_file(&staged).ok();

    Ok(manifest)
}

fn write_archive(target: &Path, db_bytes: &[u8], manifest: &BackupManifest) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let file = std::fs::File::create(target)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(DB_ENTRY, opts)?;
    zip.write_all(db_bytes)?;

    zip.start_file(MANIFEST_ENTRY, opts)?;
    zip.write_all(serde_json::to_string_pretty(manifest)?.as_bytes())?;

    zip.finish()?;
    Ok(())
}

// ── inspect ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn inspect_backup(path: String) -> AppResult<BackupInspection> {
    let (_, manifest) = read_archive(Path::new(&path))?;

    let (compatible, reason) = if manifest.schema_version > crate::SCHEMA_VERSION {
        (
            false,
            Some(format!(
                "ไฟล์สำรองนี้สร้างจากแอปเวอร์ชันใหม่กว่า (schema {} > {}) กรุณาอัปเดตแอปก่อนกู้คืน",
                manifest.schema_version,
                crate::SCHEMA_VERSION
            )),
        )
    } else {
        (true, None)
    };

    Ok(BackupInspection {
        manifest,
        compatible,
        reason,
    })
}

// ── restore ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct RestoreOutcome {
    pub safety_backup_path: Option<String>,
    pub manifest: BackupManifest,
}

#[tauri::command]
pub async fn restore_backup(
    app: tauri::AppHandle,
    path: String,
    safety_path: Option<String>,
) -> AppResult<RestoreOutcome> {
    let (db_bytes, manifest) = read_archive(Path::new(&path))?;

    if manifest.schema_version > crate::SCHEMA_VERSION {
        return Err(AppError::InvalidBackup(format!(
            "schema {} is newer than supported {}",
            manifest.schema_version,
            crate::SCHEMA_VERSION
        )));
    }

    if checksum(&db_bytes) != manifest.checksum {
        return Err(AppError::InvalidBackup(
            "checksum mismatch — the archive is corrupt".into(),
        ));
    }

    // Verify the payload really is a SQLite database before we replace anything.
    let staged = paths::temp_path("restore.db")?;
    std::fs::write(&staged, &db_bytes)?;
    let valid = {
        let mut conn = open(&staged).await?;
        let ok: Result<(i64,), sqlx::Error> =
            sqlx::query_as("SELECT count(*) FROM sqlite_master WHERE type = 'table'")
                .fetch_one(&mut conn)
                .await;
        conn.close().await.ok();
        ok.map(|(n,)| n > 0).unwrap_or(false)
    };
    if !valid {
        std::fs::remove_file(&staged).ok();
        return Err(AppError::InvalidBackup(
            "the archive does not contain a readable database".into(),
        ));
    }

    let db_path = paths::database_path(&app)?;

    // Step 3: safety backup of what is about to be replaced.
    let mut safety_backup_path = None;
    if db_path.exists() {
        let target = match &safety_path {
            Some(p) if !p.trim().is_empty() => PathBuf::from(p),
            _ => {
                let dir = paths::app_data_dir(&app)?.join("backups");
                std::fs::create_dir_all(&dir)?;
                dir.join(format!("safety-{}.zip", paths::today_local_date()))
            }
        };

        let live_bytes = std::fs::read(&db_path)?;
        let live_counts = count_tables(&db_path).await.unwrap_or_default();
        let live_manifest = BackupManifest {
            app_name: "Balance".into(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version: crate::SCHEMA_VERSION,
            created_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            counts: live_counts,
            checksum: checksum(&live_bytes),
        };
        write_archive(&target, &live_bytes, &live_manifest)?;
        safety_backup_path = Some(target.to_string_lossy().into_owned());
    }

    // Step 4: swap. Move the old file aside rather than deleting it, so a
    // failure between these two operations is recoverable.
    let old = db_path.with_extension("db.replaced");
    std::fs::remove_file(&old).ok();
    if db_path.exists() {
        std::fs::rename(&db_path, &old)?;
    }

    match std::fs::rename(&staged, &db_path) {
        Ok(()) => {
            std::fs::remove_file(&old).ok();
            // WAL/SHM sidecars belong to the replaced database.
            std::fs::remove_file(db_path.with_extension("db-wal")).ok();
            std::fs::remove_file(db_path.with_extension("db-shm")).ok();
        }
        Err(e) => {
            // Roll back: put the original back exactly where it was.
            if old.exists() {
                std::fs::rename(&old, &db_path).ok();
            }
            std::fs::remove_file(&staged).ok();
            return Err(AppError::Io(std::io::Error::new(
                e.kind(),
                format!("could not replace the database, original restored: {e}"),
            )));
        }
    }

    Ok(RestoreOutcome {
        safety_backup_path,
        manifest,
    })
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Opens a connection for reading or writing a database file.
///
/// Delegates to the shared helper in [`crate::commands::db`] so the plugin's
/// own pool and this connection agree on `foreign_keys` and, more importantly,
/// on `busy_timeout` — the restore path reads the live database while the
/// plugin still holds it open.
async fn open(path: &Path) -> AppResult<SqliteConnection> {
    crate::commands::db::open(path).await
}

async fn count_tables(path: &Path) -> AppResult<TableCounts> {
    let mut conn = open(path).await?;
    let mut counts = TableCounts::default();

    for (table, field) in [
        ("accounts", 0usize),
        ("categories", 1),
        ("balance_snapshots", 2),
        ("transactions", 3),
        ("budgets", 4),
    ] {
        let n: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&mut conn)
            .await
            .unwrap_or(0);
        match field {
            0 => counts.accounts = n,
            1 => counts.categories = n,
            2 => counts.snapshots = n,
            3 => counts.transactions = n,
            _ => counts.budgets = n,
        }
    }

    conn.close().await.ok();
    Ok(counts)
}

/// Reads and validates the structure of an archive. Does not touch the live DB.
fn read_archive(path: &Path) -> AppResult<(Vec<u8>, BackupManifest)> {
    if !path.exists() {
        return Err(AppError::NotFound(path.to_string_lossy().into_owned()));
    }

    let file = std::fs::File::open(path)?;
    let mut zip = zip::ZipArchive::new(file)?;

    let mut db_bytes = Vec::new();
    {
        let mut entry = zip
            .by_name(DB_ENTRY)
            .map_err(|_| AppError::InvalidBackup(format!("missing {DB_ENTRY} in archive")))?;
        entry.read_to_end(&mut db_bytes)?;
    }

    let manifest: BackupManifest = {
        let mut entry = zip
            .by_name(MANIFEST_ENTRY)
            .map_err(|_| AppError::InvalidBackup(format!("missing {MANIFEST_ENTRY} in archive")))?;
        let mut text = String::new();
        entry.read_to_string(&mut text)?;
        serde_json::from_str(&text)?
    };

    if manifest.app_name != "Balance" {
        return Err(AppError::InvalidBackup(format!(
            "unexpected app_name: {}",
            manifest.app_name
        )));
    }

    Ok((db_bytes, manifest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_is_stable_and_sensitive() {
        let a = checksum(b"balance");
        assert_eq!(a, checksum(b"balance"));
        assert_ne!(a, checksum(b"balancf"));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn archive_round_trips() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("balance-test-{}.zip", uuid::Uuid::new_v4()));

        let payload = b"SQLite format 3\0fake".to_vec();
        let manifest = BackupManifest {
            app_name: "Balance".into(),
            app_version: "0.1.0".into(),
            schema_version: 1,
            created_at: "2026-10-16T00:00:00Z".into(),
            counts: TableCounts::default(),
            checksum: checksum(&payload),
        };

        write_archive(&path, &payload, &manifest).unwrap();
        let (bytes, read_manifest) = read_archive(&path).unwrap();

        assert_eq!(bytes, payload);
        assert_eq!(read_manifest.checksum, manifest.checksum);
        assert_eq!(read_manifest.schema_version, 1);

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn rejects_a_foreign_archive() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("balance-test-{}.zip", uuid::Uuid::new_v4()));
        let manifest = BackupManifest {
            app_name: "SomethingElse".into(),
            app_version: "1.0.0".into(),
            schema_version: 1,
            created_at: "2026-10-16T00:00:00Z".into(),
            counts: TableCounts::default(),
            checksum: checksum(b"x"),
        };
        write_archive(&path, b"x", &manifest).unwrap();

        let err = read_archive(&path).unwrap_err();
        assert!(matches!(err, AppError::InvalidBackup(_)));

        std::fs::remove_file(&path).ok();
    }
}
