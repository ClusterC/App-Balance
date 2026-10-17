//! Development-only sample data.
//!
//! The spec allows a dev seed behind an explicit flag, and forbids fake data in
//! production. Both halves of that are enforced here:
//!
//!   * The command refuses to run in a release build, so a shipped installer
//!     cannot be talked into writing sample rows.
//!   * It refuses to run on a database that already has accounts, so it can
//!     never interleave with real history.
//!
//! Everything it writes goes through the same tables and constraints the app
//! uses, so the seeded data exercises the real delta chain rather than sitting
//! in a shape the app cannot produce.

use crate::error::{AppError, AppResult};
use crate::paths;
use serde::Serialize;
use sqlx::Connection;

/// Days of history the seed generates. Long enough that the forecast page has
/// more than the four periods it requires.
const DAYS_OF_HISTORY: i64 = 190;

/// One seeded account: name, institution, type, number suffix, liability flag,
/// opening balance, credit limit, display position.
type AccountPlan = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    i64,
    i64,
    i64,
    i64,
);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedResult {
    pub accounts: usize,
    pub snapshots: usize,
    pub transactions: usize,
    pub budgets: usize,
}

/// Whether the dev seed may run at all.
fn seed_allowed() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
pub async fn seed_dev_data(app: tauri::AppHandle) -> AppResult<SeedResult> {
    if !seed_allowed() {
        return Err(AppError::InvalidInput(
            "ข้อมูลตัวอย่างใช้ได้เฉพาะในโหมดพัฒนาเท่านั้น".into(),
        ));
    }

    let db_path = paths::database_path(&app)?;
    let mut conn = super::db::open(&db_path).await?;
    let mut tx = conn.begin().await?;

    let existing: i64 = sqlx::query_scalar("SELECT count(*) FROM accounts")
        .fetch_one(&mut *tx)
        .await?;
    if existing > 0 {
        return Err(AppError::InvalidInput(
            "มีข้อมูลอยู่ในฐานข้อมูลแล้ว การเพิ่มข้อมูลตัวอย่างจึงถูกยกเลิก".into(),
        ));
    }

    let today = chrono::Utc::now();
    let date_key = |days_ago: i64| -> String {
        (today - chrono::Duration::days(days_ago))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    };

    // ── accounts ────────────────────────────────────────────────────────────
    let accounts: [AccountPlan; 4] = [
        ("ออมทรัพย์ กสิกร", "ธนาคารกสิกรไทย", "bank", "0571", 0, 4_250_000, 0, 0),
        ("เงินสดในกระเป๋า", "", "cash", "", 0, 350_000, 0, 1),
        ("TrueMoney Wallet", "TrueMoney", "ewallet", "8823", 0, 128_000, 0, 2),
        (
            "บัตรเครดิต SCB",
            "ธนาคารไทยพาณิชย์",
            "credit_card",
            "4417",
            1,
            -1_860_000,
            5_000_000,
            3,
        ),
    ];

    for (name, institution, account_type, suffix, is_liability, opening, credit_limit, position) in
        accounts
    {
        sqlx::query(
            "INSERT INTO accounts \
               (name, institution, account_type, number_suffix, currency, opening_balance_satang, \
                opening_date, credit_limit_satang, is_liability, position, created_at, updated_at) \
             VALUES (?, ?, ?, ?, 'THB', ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(name)
        .bind(if institution.is_empty() {
            None
        } else {
            Some(institution)
        })
        .bind(account_type)
        .bind(if suffix.is_empty() { None } else { Some(suffix) })
        .bind(opening)
        .bind(date_key(DAYS_OF_HISTORY))
        .bind(if credit_limit > 0 {
            Some(credit_limit)
        } else {
            None
        })
        .bind(is_liability)
        .bind(position)
        .bind(date_key(DAYS_OF_HISTORY))
        .bind(date_key(0))
        .execute(&mut *tx)
        .await?;
    }

    // ── category lookup, so seeded rows reference the real seeded categories ─
    let salary: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'เงินเดือน'")
        .fetch_one(&mut *tx)
        .await?;
    let side_income: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'รายได้เสริม'")
        .fetch_one(&mut *tx)
        .await?;
    let food: i64 =
        sqlx::query_scalar("SELECT id FROM categories WHERE name = 'อาหารและเครื่องดื่ม'")
            .fetch_one(&mut *tx)
            .await?;
    let transport: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'เดินทาง'")
        .fetch_one(&mut *tx)
        .await?;
    let utilities: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'ค่าสาธารณูปโภค'")
        .fetch_one(&mut *tx)
        .await?;
    let shopping: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'ช้อปปิ้ง'")
        .fetch_one(&mut *tx)
        .await?;
    let housing: i64 = sqlx::query_scalar("SELECT id FROM categories WHERE name = 'ที่อยู่อาศัย'")
        .fetch_one(&mut *tx)
        .await?;
    let entertainment: i64 =
        sqlx::query_scalar("SELECT id FROM categories WHERE name = 'ความบันเทิง'")
            .fetch_one(&mut *tx)
            .await?;

    // ── snapshots and matching transactions ─────────────────────────────────
    //
    // Written as (days_ago, account_index, delta_satang, update_type, category,
    // note). The running balance per account is accumulated below, which is how
    // a real user produces these rows: they read a number off a screen and type
    // it in. Deltas rather than absolute balances keep the list readable.
    type Row = (i64, usize, i64, &'static str, Option<i64>, &'static str);

    let mut plan: Vec<Row> = Vec::new();

    for week in 0..(DAYS_OF_HISTORY / 7) {
        let days = week * 7 + 2;
        // Salary on the 25th-ish of each month, i.e. roughly every fourth week.
        if week % 4 == 0 {
            plan.push((days, 0, 3_250_000, "income", Some(salary), "เงินเดือน"));
        }
        // Occasional freelance income, so income is not perfectly periodic.
        if week % 7 == 3 {
            plan.push((days + 1, 0, 850_000, "income", Some(side_income), "งานเสริม"));
        }
        // Recurring monthly costs, with a little variation.
        if week % 4 == 1 {
            plan.push((days, 0, -1_450_000, "expense", Some(housing), "ค่าเช่า"));
            plan.push((days + 1, 0, -380_000 - (week % 3) * 42_000, "expense", Some(utilities), "ค่าไฟ ค่าน้ำ"));
        }
        // Everyday spending, at a deliberately irregular cadence.
        plan.push((days, 1, -95_000 - (week % 5) * 21_000, "expense", Some(food), "อาหาร"));
        plan.push((days + 2, 1, -60_000 - (week % 4) * 18_000, "expense", Some(transport), "เดินทาง"));
        if week % 3 == 0 {
            plan.push((days + 3, 2, -245_000, "expense", Some(shopping), "ของใช้"));
        }
        if week % 5 == 2 {
            plan.push((days + 4, 2, -180_000, "expense", Some(entertainment), "ดูหนัง"));
        }
        // Card spending accumulates as a growing negative balance.
        plan.push((days + 1, 3, -320_000 - (week % 3) * 55_000, "expense", Some(food), "จ่ายด้วยบัตร"));
        // Monthly card payment brings the balance back up.
        if week % 4 == 3 {
            plan.push((days + 5, 3, 900_000, "income", None, "ชำระบัตรเครดิต"));
        }
        // One deliberately unclassified entry, so the unclassified bucket and
        // its badge are visible in the seeded UI.
        if week == 12 {
            plan.push((days + 6, 0, -260_000, "unknown", None, "ยอดหายไป ไม่ทราบสาเหตุ"));
        }
    }

    // Oldest first, so the accumulated balance is chronological.
    plan.sort_by_key(|row| -row.0);

    let mut balances = [4_250_000i64, 350_000, 128_000, -1_860_000];
    let mut snapshots = 0usize;
    let mut transactions = 0usize;
    let now = date_key(0);

    for (days_ago, account_index, delta, update_type, category, note) in plan {
        let account_id = account_index as i64 + 1;
        balances[account_index] += delta;
        let effective_at = date_key(days_ago);

        // A snapshot is written for the bank and cash accounts on every event;
        // the e-wallet and card only when the user would plausibly check them,
        // which keeps the timeline from looking mechanical.
        let write_snapshot = account_index < 2 || days_ago % 3 != 1;

        let mut snapshot_id: Option<i64> = None;
        if write_snapshot {
            let existing: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM balance_snapshots WHERE account_id = ? AND effective_at = ?",
            )
            .bind(account_id)
            .bind(&effective_at)
            .fetch_optional(&mut *tx)
            .await?;

            if existing.is_none() {
                let id = sqlx::query(
                    "INSERT INTO balance_snapshots \
                       (account_id, balance_satang, effective_at, update_type, category_id, note, \
                        created_at, updated_at) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(account_id)
                .bind(balances[account_index])
                .bind(&effective_at)
                .bind(update_type)
                .bind(category)
                .bind(note)
                .bind(&now)
                .bind(&now)
                .execute(&mut *tx)
                .await?
                .last_insert_rowid();
                snapshot_id = Some(id);
                snapshots += 1;
            }
        }

        // Transfers and adjustments are recorded as snapshots only — an
        // adjustment has no cash-flow meaning, and a transfer nets to zero.
        if update_type == "adjustment" {
            continue;
        }

        let kind = update_type;
        let amount = match kind {
            "income" => delta.abs(),
            "expense" => -delta.abs(),
            _ => continue,
        };

        sqlx::query(
            "INSERT INTO transactions \
               (account_id, kind, amount_satang, category_id, occurred_at, note, \
                linked_snapshot_id, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(account_id)
        .bind(kind)
        .bind(amount)
        .bind(category)
        .bind(&effective_at)
        .bind(note)
        .bind(snapshot_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        transactions += 1;
    }

    // ── a transfer, to exercise the two-leg path ─────────────────────────────
    let transfer_group = uuid::Uuid::new_v4().to_string();
    let transfer_at = date_key(9);
    for (account_id, amount, kind) in [(1i64, -500_000i64, "transfer_out"), (2, 500_000, "transfer_in")]
    {
        sqlx::query(
            "INSERT INTO transactions \
               (account_id, kind, amount_satang, occurred_at, note, transfer_group_id, \
                created_at, updated_at) \
             VALUES (?, ?, ?, ?, 'ถอนเงินมาใช้', ?, ?, ?)",
        )
        .bind(account_id)
        .bind(kind)
        .bind(amount)
        .bind(&transfer_at)
        .bind(&transfer_group)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        transactions += 1;
    }

    // ── recalculate every account's delta chain ──────────────────────────────
    for account_id in 1..=4i64 {
        super::db::recalculate_account(&mut tx, account_id).await?;
    }

    // ── budgets for the current month ────────────────────────────────────────
    let month_start = format!("{}-01", chrono::Utc::now().format("%Y-%m"));
    let budget_plan: [(i64, i64); 5] = [
        (food, 1_200_000),
        (transport, 600_000),
        (utilities, 500_000),
        (shopping, 800_000),
        (entertainment, 400_000),
    ];
    let mut budgets = 0usize;
    for (category, amount) in budget_plan {
        sqlx::query(
            "INSERT INTO budgets (category_id, period_start, amount_satang, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(category)
        .bind(&month_start)
        .bind(amount)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        budgets += 1;
    }

    tx.commit().await?;
    conn.close().await.ok();

    Ok(SeedResult {
        accounts: 4,
        snapshots,
        transactions,
        budgets,
    })
}
