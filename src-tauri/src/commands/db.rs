//! Transactional writes.
//!
//! The frontend talks to SQLite through the SQL plugin for reads, which is fine
//! — a `select` is a single statement and cannot be half-applied.
//!
//! Writes are different. Two operations in this app must be all-or-nothing:
//!
//!   * **A transfer** writes two `transactions` rows. Half a transfer is money
//!     that left one account and never arrived in the other.
//!   * **A snapshot mutation** rewrites `derived_delta_satang` for every later
//!     snapshot of the account. Half of that leaves the timeline permanently
//!     inconsistent.
//!
//! Neither can be done from the frontend: `tauri-plugin-sql` exposes a *pool*
//! with `load`/`execute`/`select`/`close` and no transaction API, so a `BEGIN`
//! issued through one `execute` call may be handed a different pooled
//! connection than the `COMMIT` that follows it. These commands open their own
//! connection and own a real `sqlx` transaction instead.
//!
//! # Why the delta maths is implemented here *and* in TypeScript
//!
//! `src/domain/snapshots.ts` computes the same deltas, and it is the version
//! with the test matrix attached. It runs in the frontend to preview a change
//! before it is saved, and to render an optimistic update.
//!
//! This module is the **authoritative** implementation, because the insert must
//! happen before the recalculation can see the new row's `id`, and doing that
//! in two transactions would defeat the point. The two implementations are
//! specified in `docs/data-rules.md` and covered by tests on both sides.

use crate::error::{AppError, AppResult};
use crate::paths;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

// ── connection ──────────────────────────────────────────────────────────────

/// Opens a write connection to the live database.
///
/// `busy_timeout` matters here: the SQL plugin holds its own pool against the
/// same file, and the default rollback journal means a writer can find the
/// database locked. Waiting is the correct behaviour for a single-user desktop
/// app; failing instantly is not.
pub async fn open(db_path: &Path) -> AppResult<SqliteConnection> {
    let url = format!("sqlite://{}", db_path.to_string_lossy().replace('\\', "/"));
    let opts = SqliteConnectOptions::from_str(&url)?
        .create_if_missing(false)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(15));
    Ok(SqliteConnection::connect_with(&opts).await?)
}

async fn live_connection(app: &tauri::AppHandle) -> AppResult<SqliteConnection> {
    let db_path = paths::database_path(app)?;
    if !db_path.exists() {
        return Err(AppError::NotFound(
            "ยังไม่พบฐานข้อมูล กรุณาเปิดแอปใหม่อีกครั้ง".into(),
        ));
    }
    open(&db_path).await
}

/// `YYYY-MM-DDTHH:MM:SSZ`, matching the schema's stored format.
fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ── snapshot mutations ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInput {
    /// Absent for an insert.
    pub id: Option<i64>,
    pub account_id: i64,
    /// What the user typed. Stored verbatim, never recomputed.
    pub balance_satang: i64,
    pub effective_at: String,
    pub update_type: String,
    pub category_id: Option<i64>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRow {
    pub id: i64,
    pub account_id: i64,
    pub balance_satang: i64,
    pub effective_at: String,
    pub update_type: String,
    pub category_id: Option<i64>,
    pub note: Option<String>,
    pub derived_delta_satang: i64,
    pub prev_snapshot_id: Option<i64>,
    pub is_classified: bool,
}

const SNAPSHOT_COLUMNS: &str = "id, account_id, balance_satang, effective_at, update_type, \
     category_id, note, COALESCE(derived_delta_satang, 0) AS derived_delta_satang, \
     prev_snapshot_id, is_classified";

async fn load_snapshot_rows(
    conn: &mut SqliteConnection,
    account_id: i64,
) -> AppResult<Vec<SnapshotRow>> {
    let rows = sqlx::query(&format!(
        "SELECT {SNAPSHOT_COLUMNS} FROM balance_snapshots \
         WHERE account_id = ? ORDER BY effective_at ASC, id ASC"
    ))
    .bind(account_id)
    .fetch_all(&mut *conn)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(SnapshotRow {
                id: row.try_get("id")?,
                account_id: row.try_get("account_id")?,
                balance_satang: row.try_get("balance_satang")?,
                effective_at: row.try_get("effective_at")?,
                update_type: row.try_get("update_type")?,
                category_id: row.try_get("category_id")?,
                note: row.try_get("note")?,
                derived_delta_satang: row.try_get("derived_delta_satang")?,
                prev_snapshot_id: row.try_get("prev_snapshot_id")?,
                is_classified: row.try_get::<i64, _>("is_classified")? != 0,
            })
        })
        .collect()
}

/// Rewrites the derived columns for one account, in chronological order.
///
/// The seed uses this directly: it inserts a batch of snapshots first and
/// recalculates once at the end, rather than paying for a recalculation per row.
pub(crate) async fn recalculate_account(
    conn: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    account_id: i64,
) -> AppResult<()> {
    recalculate(conn, account_id).await?;
    Ok(())
}

/// Rewrites the derived columns for one account, in chronological order.
///
/// The seed is the account's opening balance, as though a virtual snapshot
/// existed on the opening date. Returns the number of rows written, which the
/// UI reports back to the user as "recalculated N entries".
async fn recalculate(
    conn: &mut SqliteConnection,
    account_id: i64,
) -> AppResult<(usize, Vec<SnapshotRow>)> {
    let opening: i64 = sqlx::query_scalar("SELECT opening_balance_satang FROM accounts WHERE id = ?")
        .bind(account_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::NotFound("ไม่พบบัญชีที่ต้องการ".into()))?;

    let rows = load_snapshot_rows(&mut *conn, account_id).await?;

    let mut previous_balance = opening;
    let mut previous_id: Option<i64> = None;
    let mut written = 0usize;
    let mut out = Vec::with_capacity(rows.len());

    for row in rows {
        let delta = row.balance_satang - previous_balance;
        let is_classified = row.update_type != "unknown";

        // Only touch rows that actually differ, so a no-op edit does not churn
        // the file (and does not bump updated_at on untouched history).
        if row.derived_delta_satang != delta
            || row.prev_snapshot_id != previous_id
            || row.is_classified != is_classified
        {
            sqlx::query(
                "UPDATE balance_snapshots \
                 SET derived_delta_satang = ?, prev_snapshot_id = ?, is_classified = ?, \
                     updated_at = ? \
                 WHERE id = ?",
            )
            .bind(delta)
            .bind(previous_id)
            .bind(i64::from(is_classified))
            .bind(now_iso())
            .bind(row.id)
            .execute(&mut *conn)
            .await?;
            written += 1;
        }

        previous_balance = row.balance_satang;
        previous_id = Some(row.id);

        out.push(SnapshotRow {
            derived_delta_satang: delta,
            prev_snapshot_id: previous_id,
            is_classified,
            ..row
        });
    }

    Ok((written, out))
}

/// The result of a snapshot mutation, for the caller to apply to its state.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMutationResult {
    pub snapshot_id: i64,
    /// How many rows had their derived columns rewritten.
    pub recalculated: usize,
    /// The account's full timeline, already recalculated.
    pub snapshots: Vec<SnapshotRow>,
}

/// Inserts or updates a snapshot and recalculates the account's timeline.
///
/// One transaction: the row and every derived column it affects are committed
/// together or not at all.
#[tauri::command]
pub async fn save_snapshot(
    app: tauri::AppHandle,
    snapshot: SnapshotInput,
) -> AppResult<SnapshotMutationResult> {
    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    let account_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM accounts WHERE id = ?")
        .bind(snapshot.account_id)
        .fetch_optional(&mut *tx)
        .await?;
    if account_exists.is_none() {
        return Err(AppError::NotFound("ไม่พบบัญชีที่ต้องการ".into()));
    }

    let now = now_iso();
    let snapshot_id = match snapshot.id {
        Some(id) => {
            let affected = sqlx::query(
                "UPDATE balance_snapshots \
                 SET balance_satang = ?, effective_at = ?, update_type = ?, \
                     category_id = ?, note = ?, updated_at = ? \
                 WHERE id = ? AND account_id = ?",
            )
            .bind(snapshot.balance_satang)
            .bind(&snapshot.effective_at)
            .bind(&snapshot.update_type)
            .bind(snapshot.category_id)
            .bind(snapshot.note.as_deref())
            .bind(&now)
            .bind(id)
            .bind(snapshot.account_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();

            if affected == 0 {
                return Err(AppError::NotFound(
                    "ไม่พบการบันทึกยอดที่ต้องการแก้ไข".into(),
                ));
            }
            id
        }
        None => {
            let result = sqlx::query(
                "INSERT INTO balance_snapshots \
                   (account_id, balance_satang, effective_at, update_type, category_id, note, \
                    created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(snapshot.account_id)
            .bind(snapshot.balance_satang)
            .bind(&snapshot.effective_at)
            .bind(&snapshot.update_type)
            .bind(snapshot.category_id)
            .bind(snapshot.note.as_deref())
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| duplicate_time_error(e, &snapshot.effective_at))?;
            result.last_insert_rowid()
        }
    };

    let (recalculated, snapshots) = recalculate(&mut tx, snapshot.account_id).await?;
    tx.commit().await?;
    conn.close().await.ok();

    Ok(SnapshotMutationResult {
        snapshot_id,
        recalculated,
        snapshots,
    })
}

/// Deletes a snapshot and relinks its neighbours.
#[tauri::command]
pub async fn delete_snapshot(
    app: tauri::AppHandle,
    account_id: i64,
    snapshot_id: i64,
) -> AppResult<SnapshotMutationResult> {
    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    let affected = sqlx::query("DELETE FROM balance_snapshots WHERE id = ? AND account_id = ?")
        .bind(snapshot_id)
        .bind(account_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(
            "ไม่พบการบันทึกยอดที่ต้องการลบ".into(),
        ));
    }

    let (recalculated, snapshots) = recalculate(&mut tx, account_id).await?;
    tx.commit().await?;
    conn.close().await.ok();

    Ok(SnapshotMutationResult {
        snapshot_id,
        recalculated,
        snapshots,
    })
}

/// Classifies an existing delta without altering the recorded balance.
#[tauri::command]
pub async fn classify_snapshot(
    app: tauri::AppHandle,
    account_id: i64,
    snapshot_id: i64,
    update_type: String,
    category_id: Option<i64>,
    note: Option<String>,
) -> AppResult<SnapshotMutationResult> {
    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    let affected = sqlx::query(
        "UPDATE balance_snapshots \
         SET update_type = ?, category_id = ?, note = ?, updated_at = ? \
         WHERE id = ? AND account_id = ?",
    )
    .bind(&update_type)
    .bind(category_id)
    .bind(note.as_deref())
    .bind(now_iso())
    .bind(snapshot_id)
    .bind(account_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(
            "ไม่พบการบันทึกยอดที่ต้องการจัดหมวด".into(),
        ));
    }

    let (recalculated, snapshots) = recalculate(&mut tx, account_id).await?;
    tx.commit().await?;
    conn.close().await.ok();

    Ok(SnapshotMutationResult {
        snapshot_id,
        recalculated,
        snapshots,
    })
}

/// Turns SQLite's unique-index violation on `(account_id, effective_at)` into a
/// message a user can act on, instead of a raw constraint string.
fn duplicate_time_error(error: sqlx::Error, effective_at: &str) -> AppError {
    let text = error.to_string();
    if text.contains("uq_snap_account_time") || text.contains("UNIQUE constraint failed") {
        return AppError::InvalidInput(format!(
            "มีบันทึกยอดของบัญชีนี้ที่เวลา {effective_at} อยู่แล้ว กรุณาเลือกเวลาอื่น"
        ));
    }
    AppError::Database(error)
}

// ── transfers ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub from_account_id: i64,
    pub to_account_id: i64,
    /// Always a positive magnitude; the sign is derived from the leg's kind.
    pub amount_satang: i64,
    pub occurred_at: String,
    pub note: Option<String>,
    /// When set, a matching pair of snapshots is written as well, and each leg
    /// is linked to its snapshot so the delta is not counted twice.
    ///
    /// Note there is no `category_id`: a transfer is a movement between the
    /// user's own accounts, so it is never income or expense and carries no
    /// category. Both legs are written with `category_id = NULL`.
    pub mirror_snapshots: bool,
    /// `balance_satang` for each side, when `mirror_snapshots` is on.
    pub from_balance_satang: Option<i64>,
    pub to_balance_satang: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub transfer_group_id: String,
    pub out_transaction_id: i64,
    pub in_transaction_id: i64,
    pub created_snapshots: usize,
}

/// Writes both legs of a transfer in a single transaction.
///
/// The two rows are guaranteed to agree in magnitude because the outgoing leg
/// is written as `-amount` and the incoming leg as `+amount` from one input
/// value, and the schema's sign `CHECK` would reject anything else.
#[tauri::command]
pub async fn create_transfer(
    app: tauri::AppHandle,
    request: TransferRequest,
) -> AppResult<TransferResult> {
    if request.from_account_id == request.to_account_id {
        return Err(AppError::InvalidInput(
            "บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน".into(),
        ));
    }
    if request.amount_satang <= 0 {
        return Err(AppError::InvalidInput(
            "จำนวนเงินที่โอนต้องมากกว่าศูนย์".into(),
        ));
    }

    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    for account_id in [request.from_account_id, request.to_account_id] {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM accounts WHERE id = ?")
            .bind(account_id)
            .fetch_optional(&mut *tx)
            .await?;
        if exists.is_none() {
            return Err(AppError::NotFound(
                "ไม่พบบัญชีต้นทางหรือปลายทางที่เลือก".into(),
            ));
        }
    }

    let now = now_iso();
    let group_id = uuid::Uuid::new_v4().to_string();

    // Outgoing leg: negative by construction.
    let out_id = sqlx::query(
        "INSERT INTO transactions \
           (account_id, kind, amount_satang, category_id, occurred_at, note, \
            transfer_group_id, created_at, updated_at) \
         VALUES (?, 'transfer_out', ?, NULL, ?, ?, ?, ?, ?)",
    )
    .bind(request.from_account_id)
    .bind(-request.amount_satang)
    .bind(&request.occurred_at)
    .bind(request.note.as_deref())
    .bind(&group_id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    // Incoming leg: the same magnitude, positive.
    let in_id = sqlx::query(
        "INSERT INTO transactions \
           (account_id, kind, amount_satang, category_id, occurred_at, note, \
            transfer_group_id, created_at, updated_at) \
         VALUES (?, 'transfer_in', ?, NULL, ?, ?, ?, ?, ?)",
    )
    .bind(request.to_account_id)
    .bind(request.amount_satang)
    .bind(&request.occurred_at)
    .bind(request.note.as_deref())
    .bind(&group_id)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    let mut created_snapshots = 0usize;

    if request.mirror_snapshots {
        let pairs = [
            (
                request.from_account_id,
                request.from_balance_satang,
                "transfer_out",
                out_id,
            ),
            (
                request.to_account_id,
                request.to_balance_satang,
                "transfer_in",
                in_id,
            ),
        ];

        for (account_id, balance, update_type, transaction_id) in pairs {
            let Some(balance) = balance else { continue };

            let snapshot_id = sqlx::query(
                "INSERT INTO balance_snapshots \
                   (account_id, balance_satang, effective_at, update_type, note, \
                    created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(account_id)
            .bind(balance)
            .bind(&request.occurred_at)
            .bind(update_type)
            .bind(request.note.as_deref())
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| duplicate_time_error(e, &request.occurred_at))?
            .last_insert_rowid();

            // Linking the leg to its snapshot is the *only* thing that removes
            // the delta from cash-flow totals — nothing is inferred.
            sqlx::query("UPDATE transactions SET linked_snapshot_id = ? WHERE id = ?")
                .bind(snapshot_id)
                .bind(transaction_id)
                .execute(&mut *tx)
                .await?;

            recalculate(&mut tx, account_id).await?;
            created_snapshots += 1;
        }
    }

    tx.commit().await?;
    conn.close().await.ok();

    Ok(TransferResult {
        transfer_group_id: group_id,
        out_transaction_id: out_id,
        in_transaction_id: in_id,
        created_snapshots,
    })
}

/// Deletes both legs of a transfer, and any snapshots mirrored with them.
#[tauri::command]
pub async fn delete_transfer(app: tauri::AppHandle, transfer_group_id: String) -> AppResult<usize> {
    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    let snapshot_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT linked_snapshot_id FROM transactions \
         WHERE transfer_group_id = ? AND linked_snapshot_id IS NOT NULL",
    )
    .bind(&transfer_group_id)
    .fetch_all(&mut *tx)
    .await?;

    let account_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT account_id FROM transactions WHERE transfer_group_id = ?",
    )
    .bind(&transfer_group_id)
    .fetch_all(&mut *tx)
    .await?;

    let affected = sqlx::query("DELETE FROM transactions WHERE transfer_group_id = ?")
        .bind(&transfer_group_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();

    for snapshot_id in snapshot_ids {
        sqlx::query("DELETE FROM balance_snapshots WHERE id = ?")
            .bind(snapshot_id)
            .execute(&mut *tx)
            .await?;
    }

    for account_id in account_ids {
        recalculate(&mut tx, account_id).await?;
    }

    tx.commit().await?;
    conn.close().await.ok();
    Ok(affected as usize)
}

// ── accounts ────────────────────────────────────────────────────────────────

/// Permanently deletes an account and everything under it.
///
/// Refuses while transactions reference the account, because
/// `transactions.account_id` is `ON DELETE RESTRICT` — deleting history
/// silently is exactly what that constraint exists to prevent. The caller is
/// expected to offer archiving instead, which is why the error message says so.
#[tauri::command]
pub async fn purge_account(app: tauri::AppHandle, account_id: i64) -> AppResult<()> {
    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    let transactions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM transactions WHERE account_id = ?")
            .bind(account_id)
            .fetch_one(&mut *tx)
            .await?;

    if transactions > 0 {
        return Err(AppError::InvalidInput(format!(
            "ลบบัญชีนี้ไม่ได้ เพราะยังมีรายการผูกอยู่ {transactions} รายการ กรุณาเก็บเข้าคลังแทน"
        )));
    }

    sqlx::query("DELETE FROM balance_snapshots WHERE account_id = ?")
        .bind(account_id)
        .execute(&mut *tx)
        .await?;

    let affected = sqlx::query("DELETE FROM accounts WHERE id = ?")
        .bind(account_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound("ไม่พบบัญชีที่ต้องการลบ".into()));
    }

    tx.commit().await?;
    conn.close().await.ok();
    Ok(())
}

/// Wipes every row in every user table, in one transaction.
///
/// Used by the destructive "start over" action, which requires a typed
/// confirmation in the UI. `app_settings` is cleared too, so the app returns to
/// first-run state.
#[tauri::command]
pub async fn purge_all_data(app: tauri::AppHandle) -> AppResult<()> {
    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    // Order matters only for readability — foreign keys are deferred by the
    // transaction, and every table is emptied regardless.
    for table in [
        "transaction_tags",
        "transactions",
        "balance_snapshots",
        "budgets",
        "tags",
        "accounts",
        "app_settings",
        "import_export_metadata",
    ] {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&mut *tx)
            .await?;
    }

    // The default Thai categories are seed data, not user data: restoring them
    // is what makes the app usable immediately after a reset.
    sqlx::query("DELETE FROM categories").execute(&mut *tx).await?;
    sqlx::query(crate::DEFAULT_CATEGORIES_SQL)
        .execute(&mut *tx)
        .await?;

    // Reset AUTOINCREMENT counters so a wiped database starts numbering at 1
    // again. Absent on a database where nothing has been inserted yet.
    let _ = sqlx::query("DELETE FROM sqlite_sequence").execute(&mut *tx).await;

    tx.commit().await?;
    conn.close().await.ok();
    Ok(())
}

// ── budgets and transactions (single-row, but validated together) ───────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetRequest {
    pub id: Option<i64>,
    pub category_id: i64,
    /// `YYYY-MM-01`.
    pub period_start: String,
    pub amount_satang: i64,
}

/// Creates or updates a budget, rejecting an expense category that does not
/// exist and an amount that is not positive.
#[tauri::command]
pub async fn save_budget(app: tauri::AppHandle, budget: BudgetRequest) -> AppResult<i64> {
    if budget.amount_satang <= 0 {
        return Err(AppError::InvalidInput("วงเงินงบประมาณต้องมากกว่าศูนย์".into()));
    }

    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    let kind: Option<String> = sqlx::query_scalar("SELECT kind FROM categories WHERE id = ?")
        .bind(budget.category_id)
        .fetch_optional(&mut *tx)
        .await?;

    match kind.as_deref() {
        Some("expense") => {}
        Some(_) => {
            return Err(AppError::InvalidInput(
                "ตั้งงบประมาณได้เฉพาะหมวดหมู่รายจ่าย".into(),
            ))
        }
        None => return Err(AppError::NotFound("ไม่พบหมวดหมู่ที่เลือก".into())),
    }

    let now = now_iso();
    let id = match budget.id {
        Some(id) => {
            sqlx::query(
                "UPDATE budgets SET category_id = ?, period_start = ?, amount_satang = ?, \
                 updated_at = ? WHERE id = ?",
            )
            .bind(budget.category_id)
            .bind(&budget.period_start)
            .bind(budget.amount_satang)
            .bind(&now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
            id
        }
        None => sqlx::query(
            "INSERT INTO budgets (category_id, period_start, amount_satang, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(category_id, period_start) DO UPDATE SET \
               amount_satang = excluded.amount_satang, updated_at = excluded.updated_at",
        )
        .bind(budget.category_id)
        .bind(&budget.period_start)
        .bind(budget.amount_satang)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid(),
    };

    tx.commit().await?;
    conn.close().await.ok();
    Ok(id)
}

/// Moves a category up or down within its `kind`, rewriting `position` so the
/// order is contiguous.
#[tauri::command]
pub async fn reorder_category(
    app: tauri::AppHandle,
    category_id: i64,
    direction: String,
) -> AppResult<()> {
    let delta: i64 = match direction.as_str() {
        "up" => -1,
        "down" => 1,
        _ => {
            return Err(AppError::InvalidInput(
                "ทิศทางการจัดลำดับไม่ถูกต้อง".into(),
            ))
        }
    };

    let mut conn = live_connection(&app).await?;
    let mut tx = conn.begin().await?;

    let (kind, position): (String, i64) =
        sqlx::query_as("SELECT kind, position FROM categories WHERE id = ?")
            .bind(category_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("ไม่พบหมวดหมู่ที่ต้องการ".into()))?;

    let neighbour: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM categories WHERE kind = ? AND position = ? AND id <> ? \
         ORDER BY position LIMIT 1",
    )
    .bind(&kind)
    .bind(position + delta)
    .bind(category_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(neighbour_id) = neighbour {
        // Swap through a sentinel so the unique-ish ordering never collides.
        sqlx::query("UPDATE categories SET position = -1 WHERE id = ?")
            .bind(category_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE categories SET position = ? WHERE id = ?")
            .bind(position)
            .bind(neighbour_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE categories SET position = ? WHERE id = ?")
            .bind(position + delta)
            .bind(category_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    conn.close().await.ok();
    Ok(())
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    /// A fresh in-memory database with the real migration applied.
    ///
    /// Running the actual migration SQL rather than a hand-written test schema
    /// is deliberate: the constraints and indexes under test are the ones that
    /// ship.
    async fn migrated() -> SqliteConnection {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let mut conn = SqliteConnection::connect_with(&opts).await.unwrap();
        conn.execute(include_str!("../../migrations/0001_schema.sql"))
            .await
            .unwrap();
        conn.execute(crate::DEFAULT_CATEGORIES_SQL).await.unwrap();
        conn
    }

    async fn seed_account(conn: &mut SqliteConnection, opening: i64) -> i64 {
        sqlx::query(
            "INSERT INTO accounts \
               (name, account_type, opening_balance_satang, opening_date, created_at, updated_at) \
             VALUES ('ทดสอบ', 'bank', ?, '2026-01-01', '2026-01-01T00:00:00Z', \
                     '2026-01-01T00:00:00Z')",
        )
        .bind(opening)
        .execute(&mut *conn)
        .await
        .unwrap()
        .last_insert_rowid()
    }

    async fn insert_snapshot(
        conn: &mut SqliteConnection,
        account_id: i64,
        balance: i64,
        at: &str,
        update_type: &str,
    ) -> i64 {
        sqlx::query(
            "INSERT INTO balance_snapshots \
               (account_id, balance_satang, effective_at, update_type, created_at, updated_at) \
             VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(account_id)
        .bind(balance)
        .bind(at)
        .bind(update_type)
        .execute(&mut *conn)
        .await
        .unwrap()
        .last_insert_rowid()
    }

    async fn delta_of(conn: &mut SqliteConnection, id: i64) -> (i64, Option<i64>, i64) {
        sqlx::query_as(
            "SELECT COALESCE(derived_delta_satang, 0), prev_snapshot_id, is_classified \
             FROM balance_snapshots WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&mut *conn)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn migration_applies_to_a_fresh_database() {
        let mut conn = migrated().await;

        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .fetch_all(&mut conn)
                .await
                .unwrap();

        for expected in [
            "accounts",
            "app_settings",
            "balance_snapshots",
            "budgets",
            "categories",
            "import_export_metadata",
            "tags",
            "transaction_tags",
            "transactions",
        ] {
            assert!(tables.contains(&expected.to_string()), "missing {expected}");
        }

        let categories: i64 = sqlx::query_scalar("SELECT count(*) FROM categories")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert_eq!(categories, 17, "5 income + 12 expense defaults");
    }

    #[tokio::test]
    async fn transaction_sign_constraint_rejects_a_positive_expense() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;

        let error = sqlx::query(
            "INSERT INTO transactions (account_id, kind, amount_satang, occurred_at) \
             VALUES (?, 'expense', 500, '2026-01-01T00:00:00Z')",
        )
        .bind(account)
        .execute(&mut conn)
        .await
        .unwrap_err();

        assert!(error.to_string().contains("CHECK"), "got: {error}");
    }

    #[tokio::test]
    async fn transaction_sign_constraint_rejects_a_negative_income() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;

        let error = sqlx::query(
            "INSERT INTO transactions (account_id, kind, amount_satang, occurred_at) \
             VALUES (?, 'income', -500, '2026-01-01T00:00:00Z')",
        )
        .bind(account)
        .execute(&mut conn)
        .await
        .unwrap_err();

        assert!(error.to_string().contains("CHECK"), "got: {error}");
    }

    #[tokio::test]
    async fn deleting_an_account_with_transactions_is_refused() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;

        sqlx::query(
            "INSERT INTO transactions (account_id, kind, amount_satang, occurred_at) \
             VALUES (?, 'expense', -500, '2026-01-01T00:00:00Z')",
        )
        .bind(account)
        .execute(&mut conn)
        .await
        .unwrap();

        let error = sqlx::query("DELETE FROM accounts WHERE id = ?")
            .bind(account)
            .execute(&mut conn)
            .await
            .unwrap_err();

        assert!(
            error.to_string().to_uppercase().contains("FOREIGN KEY"),
            "expected a RESTRICT violation, got: {error}"
        );
    }

    #[tokio::test]
    async fn first_delta_is_measured_against_the_opening_balance() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 100_000).await;
        let first =
            insert_snapshot(&mut conn, account, 150_000, "2026-02-01T00:00:00Z", "income").await;

        recalculate(&mut conn, account).await.unwrap();

        let (delta, prev, classified) = delta_of(&mut conn, first).await;
        assert_eq!(delta, 50_000);
        assert_eq!(prev, None, "the opening balance is not a row");
        assert_eq!(classified, 1);
    }

    #[tokio::test]
    async fn inserting_a_past_snapshot_shifts_every_later_delta() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;

        let middle =
            insert_snapshot(&mut conn, account, 300_000, "2026-03-01T00:00:00Z", "income").await;
        let last =
            insert_snapshot(&mut conn, account, 400_000, "2026-04-01T00:00:00Z", "income").await;
        recalculate(&mut conn, account).await.unwrap();
        assert_eq!(delta_of(&mut conn, last).await.0, 100_000);

        // A snapshot dated between them: the last delta must shrink, and the
        // new row must chain off `middle`, not off the opening balance.
        let inserted =
            insert_snapshot(&mut conn, account, 350_000, "2026-03-15T00:00:00Z", "expense").await;
        recalculate(&mut conn, account).await.unwrap();

        assert_eq!(delta_of(&mut conn, inserted).await.0, 50_000);
        assert_eq!(delta_of(&mut conn, inserted).await.1, Some(middle));
        assert_eq!(delta_of(&mut conn, last).await.0, 50_000);
        assert_eq!(delta_of(&mut conn, last).await.1, Some(inserted));
    }

    #[tokio::test]
    async fn deleting_a_middle_snapshot_relinks_its_neighbours() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;

        let first =
            insert_snapshot(&mut conn, account, 100_000, "2026-02-01T00:00:00Z", "income").await;
        let middle =
            insert_snapshot(&mut conn, account, 150_000, "2026-03-01T00:00:00Z", "income").await;
        let last =
            insert_snapshot(&mut conn, account, 260_000, "2026-04-01T00:00:00Z", "income").await;
        recalculate(&mut conn, account).await.unwrap();

        sqlx::query("DELETE FROM balance_snapshots WHERE id = ?")
            .bind(middle)
            .execute(&mut conn)
            .await
            .unwrap();
        recalculate(&mut conn, account).await.unwrap();

        // The removed 50,000 is absorbed by the following delta rather than
        // leaving a hole in the chain.
        let (delta, prev, _) = delta_of(&mut conn, last).await;
        assert_eq!(delta, 160_000);
        assert_eq!(prev, Some(first));
    }

    #[tokio::test]
    async fn unknown_update_type_is_left_unclassified() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;
        let row = insert_snapshot(&mut conn, account, 75_000, "2026-02-01T00:00:00Z", "unknown").await;

        recalculate(&mut conn, account).await.unwrap();

        let (delta, _, classified) = delta_of(&mut conn, row).await;
        assert_eq!(delta, 75_000, "the delta is still computed");
        assert_eq!(classified, 0, "but it is not classified");
    }

    #[tokio::test]
    async fn credit_card_balance_stays_negative() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, -500_000).await;
        insert_snapshot(&mut conn, account, -1_200_000, "2026-02-01T00:00:00Z", "expense").await;

        recalculate(&mut conn, account).await.unwrap();

        let balance: i64 =
            sqlx::query_scalar("SELECT balance_satang FROM balance_snapshots WHERE account_id = ?")
                .bind(account)
                .fetch_one(&mut conn)
                .await
                .unwrap();
        assert_eq!(balance, -1_200_000, "stored as typed, never normalised");
    }

    #[tokio::test]
    async fn one_snapshot_per_account_per_instant() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;
        insert_snapshot(&mut conn, account, 100_000, "2026-02-01T00:00:00Z", "income").await;

        let duplicate = sqlx::query(
            "INSERT INTO balance_snapshots \
               (account_id, balance_satang, effective_at, update_type, created_at, updated_at) \
             VALUES (?, 200000, '2026-02-01T00:00:00Z', 'income', \
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(account)
        .execute(&mut conn)
        .await
        .unwrap_err();

        assert!(duplicate.to_string().contains("UNIQUE"), "got: {duplicate}");
    }

    #[tokio::test]
    async fn duplicate_time_error_is_translated_to_thai() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 0).await;
        insert_snapshot(&mut conn, account, 100_000, "2026-02-01T00:00:00Z", "income").await;

        let raw = sqlx::query(
            "INSERT INTO balance_snapshots \
               (account_id, balance_satang, effective_at, update_type, created_at, updated_at) \
             VALUES (?, 200000, '2026-02-01T00:00:00Z', 'income', \
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(account)
        .execute(&mut conn)
        .await
        .unwrap_err();

        let translated = duplicate_time_error(raw, "2026-02-01T00:00:00Z");
        assert!(matches!(translated, AppError::InvalidInput(_)));
        assert!(translated.to_string().contains("มีบันทึกยอด"));
    }

    #[tokio::test]
    async fn recalculation_is_idempotent() {
        let mut conn = migrated().await;
        let account = seed_account(&mut conn, 10_000).await;
        insert_snapshot(&mut conn, account, 90_000, "2026-02-01T00:00:00Z", "income").await;
        insert_snapshot(&mut conn, account, 40_000, "2026-03-01T00:00:00Z", "expense").await;

        let (first_pass, _) = recalculate(&mut conn, account).await.unwrap();
        let (second_pass, _) = recalculate(&mut conn, account).await.unwrap();

        assert_eq!(first_pass, 2, "both rows needed writing");
        assert_eq!(second_pass, 0, "a second pass changes nothing");
    }

    #[tokio::test]
    async fn budgets_reject_a_non_positive_amount() {
        let mut conn = migrated().await;
        let category: i64 =
            sqlx::query_scalar("SELECT id FROM categories WHERE kind = 'expense' LIMIT 1")
                .fetch_one(&mut conn)
                .await
                .unwrap();

        let error = sqlx::query(
            "INSERT INTO budgets (category_id, period_start, amount_satang, created_at, updated_at) \
             VALUES (?, '2026-10-01', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(category)
        .execute(&mut conn)
        .await
        .unwrap_err();

        assert!(error.to_string().contains("CHECK"), "got: {error}");
    }

    #[tokio::test]
    async fn a_budget_is_unique_per_category_and_month() {
        let mut conn = migrated().await;
        let category: i64 =
            sqlx::query_scalar("SELECT id FROM categories WHERE kind = 'expense' LIMIT 1")
                .fetch_one(&mut conn)
                .await
                .unwrap();

        let insert = "INSERT INTO budgets (category_id, period_start, amount_satang, created_at, updated_at) \
                      VALUES (?, '2026-10-01', 500000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')";
        sqlx::query(insert).bind(category).execute(&mut conn).await.unwrap();

        let error = sqlx::query(insert)
            .bind(category)
            .execute(&mut conn)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("UNIQUE"), "got: {error}");
    }

    #[tokio::test]
    async fn the_seed_sql_restores_default_categories() {
        let mut conn = migrated().await;
        let before: i64 = sqlx::query_scalar("SELECT count(*) FROM categories")
            .fetch_one(&mut conn)
            .await
            .unwrap();

        sqlx::query("DELETE FROM categories").execute(&mut conn).await.unwrap();
        conn.execute(crate::DEFAULT_CATEGORIES_SQL).await.unwrap();

        let after: i64 = sqlx::query_scalar("SELECT count(*) FROM categories")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert_eq!(after, before, "the reset path restores the same 17 rows");
    }
}
