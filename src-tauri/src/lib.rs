//! Balance — Tauri application entry point.
//!
//! The Rust layer owns everything the frontend cannot do safely:
//!
//!   1. **Schema migrations**, registered against the SQLite connection URL and
//!      run as a side effect of the frontend's first `Database.load`.
//!   2. **Backup / restore**, because it needs real filesystem access and
//!      SQLite's `VACUUM INTO`.
//!   3. **CSV writing**, so exported files can be UTF-8 **with a BOM** — Excel
//!      on Windows otherwise decodes them in the system ANSI codepage and
//!      renders Thai as mojibake.
//!   4. **Transactional writes.** `tauri-plugin-sql` hands the frontend a
//!      connection *pool* with no transaction API, so any operation that must
//!      touch several rows atomically (a transfer's two legs, a snapshot
//!      mutation's delta recalculation) is a command here instead. See
//!      `commands::db` for the reasoning.
//!
//! Ordinary single-statement reads and writes go through the SQL plugin from
//! the frontend.

mod commands;
mod error;
mod paths;

use tauri_plugin_sql::{Migration, MigrationKind};

/// The database file name, resolved by the SQL plugin relative to the app
/// config directory (`%APPDATA%\com.personal.balanceapp\` on Windows).
pub const DB_URL: &str = "sqlite:balance.db";

/// Schema version currently expected by this build. Used to reject restoring a
/// backup written by a newer version of the app.
pub const SCHEMA_VERSION: i64 = 1;

/// The default Thai categories.
///
/// Shared between migration 0001 and the `purge_all_data` command, so "start
/// over" leaves the app as usable as a fresh install.
pub const DEFAULT_CATEGORIES_SQL: &str = include_str!("../sql/seed_categories.sql");

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_initial_tables",
        // Tables first, then the seed rows, as one migration so a failure in
        // either half rolls the whole thing back.
        sql: concat!(
            include_str!("../migrations/0001_schema.sql"),
            "\n",
            include_str!("../sql/seed_categories.sql"),
        ),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::restart_app,
            commands::csv::export_csv,
            commands::backup::create_backup,
            commands::backup::inspect_backup,
            commands::backup::restore_backup,
            commands::db::save_snapshot,
            commands::db::delete_snapshot,
            commands::db::classify_snapshot,
            commands::db::create_transfer,
            commands::db::delete_transfer,
            commands::db::purge_account,
            commands::db::purge_all_data,
            commands::db::save_budget,
            commands::db::reorder_category,
            commands::seed::seed_dev_data,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the Balance application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_sql_contains_schema_and_seed() {
        let sql = &migrations()[0].sql;
        assert!(sql.contains("CREATE TABLE accounts"));
        assert!(sql.contains("CREATE TABLE balance_snapshots"));
        assert!(sql.contains("INSERT INTO categories"));
    }

    /// The seed is applied twice (migration, reset), so it must be idempotent
    /// in shape: a plain `INSERT` with explicit columns and no table creation.
    #[test]
    fn seed_sql_is_a_bare_insert() {
        assert!(DEFAULT_CATEGORIES_SQL.contains("INSERT INTO categories"));
        assert!(!DEFAULT_CATEGORIES_SQL.contains("CREATE TABLE"));
        assert!(!DEFAULT_CATEGORIES_SQL.contains("DELETE"));
    }

    #[test]
    fn schema_version_matches_the_only_migration() {
        assert_eq!(SCHEMA_VERSION, migrations().last().unwrap().version);
    }
}
