# Balance

A local-first personal finance desktop app for Windows. Track the balances of your bank accounts, cash wallets and e-wallets by recording what you actually see — and let the app compute what happened in between.

แอปบันทึกและติดตามยอดเงินคงเหลือในบัญชีธนาคาร เงินสด และกระเป๋าเงินอิเล็กทรอนิกส์ (ทำงานออฟไลน์ ข้อมูลเก็บในเครื่องเท่านั้น) — ส่วนติดต่อผู้ใช้เป็นภาษาไทย

## The idea

Most finance apps want your bank credentials. Balance deliberately does not connect to anything. The workflow is:

1. **Create accounts** — bank, cash, e-wallet, credit card — each with an opening balance.
2. **Record a snapshot** whenever you check your balance: what you see, and when you saw it.
3. **The app derives the delta** — the difference from the previous snapshot — which is the only record of money moving.
4. **Classify each delta** as income, expense, transfer, or adjustment, or leave it "unknown" and review later.
5. **Reports, budgets and forecasts** are computed from that timeline, entirely on your machine.

Because the user types the balance they can actually see, snapshots can arrive out of chronological order. Inserting a past-dated snapshot changes the delta of *every later snapshot*, so deltas are recalculated as a batch, in chronological order, inside one SQLite transaction, by Rust. The recorded balances are the source of truth; the deltas are derived and may be recalculated freely.

## Features

- **Accounts** — bank / cash / e-wallet / credit card / other, with institution, optional 4-digit number suffix (privacy: never the full number), color, opening balance, credit limit for liabilities. Archive, restore, or purge with typed confirmation.
- **Timeline** — the core. Immutable dated snapshots per account, derived deltas, chronological recalculation on insert/edit/delete, filtering by account / date range / category / update type / classified status.
- **Transactions & transfers** — optional explicit records. A transfer writes two linked legs in one database transaction and never inflates income or expense. A snapshot delta linked to a transaction is excluded from cash-flow totals; the app warns when an unlinked classified delta lands on a day that already has transactions (possible double-counting) and lets you decide.
- **Budgets** — per-category monthly limits with progress, remaining, and over-budget states, computed by the same aggregator as the reports.
- **Reports** — weekly / monthly / custom ranges: income, expense, net, unclassified deltas, spending by category and account, net-worth series, comparison against the prior equivalent period, and CSV export (UTF-8 with BOM) for accounts, snapshots, transactions, categories, and the selected period.
- **Forecast** — a transparent baseline model over historical expenses (weighted moving average, optional linear-regression trend, modified z-score outlier exclusion, 80% confidence band from historical variance). Discloses its method, data range, and period count, and honestly reports "insufficient data" when fewer than 4 comparable periods exist. Deterministic, pure functions, fully unit-tested. Not financial advice.
- **Dashboard** — assets, liabilities, net worth, this month's cashflow, net-worth trend, recent updates, and a configurable staleness warning (default: 30 days since the last snapshot).
- **Backup & restore** — one-click portable ZIP backup (SQLite database + JSON manifest with checksums); restore validates the archive and writes an automatic safety backup of the current data before swapping.
- **Thai-first UI** — Material Design 3-inspired, light/dark/system themes, Buddhist-era date display, Asia/Bangkok day boundaries everywhere, negative amounts signed and glyph-annotated (never color-only), keyboard-accessible, charts with text summaries for screen readers.

## Privacy

Balance is offline by construction:

- **No network access.** No bank syncing, no telemetry, no analytics, no ads, no tracking, no cloud.
- **All data stays on your machine**, in the standard Tauri app-data directory (e.g. `%APPDATA%\com.personal.balanceapp\` on Windows).
- **Money is never a float.** All amounts are stored as integer satang (1 THB = 100 satang) and converted exactly.
- **Snapshots are immutable.** Editing and deletion require confirmation; deletion relinks and recalculates rather than silently rewriting history.
- Deleting the app's data folder deletes everything — that's the whole database. Take backups.

## Building from source

### Prerequisites (Windows 10/11)

- [Node.js](https://nodejs.org/) 20 or newer
- [Rust](https://rustup.rs/) 1.90 or newer, with the MSVC toolchain
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) with the "Desktop development with C++" workload (MSVC + Windows SDK)
- WebView2 Runtime (pre-installed on Windows 10 21H2+ / Windows 11)

### Commands

```bash
npm install          # frontend dependencies
npm run tauri dev    # run the app in development (Rust compiles on first run)
npm run tauri build  # produce the Windows installer

npm run typecheck    # tsc, strict
npm run lint         # eslint, zero warnings allowed
npm test             # vitest — domain logic and schemas
```

The release build lands in `src-tauri/target/release/bundle/nsis/Balance_<version>_x64-setup.exe` (NSIS installer) with the raw executable next to it in `src-tauri/target/release/balance.exe`.

Automated Windows builds run on version tags via GitHub Actions (see `.github/workflows/release.yml`).

## Architecture

```
src/
  domain/      Pure business logic: money (satang), dates (Bangkok),
               delta recalculation, cashflow aggregation, forecast.
               No React, no database, no clock — fully unit-tested.
  db/          Repository layer over the Tauri SQL plugin.
               Reads only; every multi-row write is a Rust command.
  lib/         Typed wrappers over Tauri commands (snapshots, transfers,
               backup, CSV, seed) and the CSV/backup flows.
  state/       One small Zustand store: load everything, reload after
               mutation. No optimistic patching — Rust's recalculation
               is the single source of truth for deltas.
  features/    One folder per page: dashboard, accounts, timeline,
               transactions, budgets, reports, forecast, settings.
  components/  Shared M3-flavoured building blocks (StatCard, ChartCard,
               FilterBar, ConfirmDialog with typed confirmation, …).
  i18n/        Thai dictionary; `t(path)` with interpolation.
  theme/       MUI theme with light/dark color schemes, M3-style tokens.

src-tauri/
  src/commands/
    db.rs      SQLite writes that need real transactions — most
               importantly the snapshot delta recalculation.
    backup.rs  ZIP backup/restore with manifest + checksum validation.
    csv.rs     UTF-8 BOM CSV export.
    seed.rs    Development-only sample data (refused in release builds).
```

**Why delta math lives in Rust *and* TypeScript:** the recalculation must happen inside the same SQL transaction as the insert/update/delete, and it must see the new row's id — so Rust owns the write path. The same logic exists as pure TypeScript functions (`domain/snapshots.ts`) that the required test cases exercise directly; the Rust implementation is the authority, the TS one is the specification with tests.

## Database

Normalized SQLite, migrated by the Tauri SQL plugin on first launch. Tables: `app_settings`, `accounts`, `categories`, `balance_snapshots`, `transactions`, `tags`, `transaction_tags`, `budgets`. Foreign keys are enabled; `(account_id, effective_at)` is uniquely indexed; every mutable row carries `created_at` / `updated_at`. See [docs/database-schema.md](docs/database-schema.md) for the full schema.

## Roadmap / known limitations

Completed: accounts, snapshot timeline with delta recalculation, classification, explicit transactions and transfers, budgets, reports with CSV export, forecasting, dashboard, backup/restore, settings with themes, Thai-first M3 UI.

Not yet: CSV **import** with preview (export is done), account reorder UI, global search page, per-category forecast scope selector. The forecast excludes transfers/adjustments/income by design; unclassified deltas are reported separately rather than guessed into a bucket.

## Contributing

Issues and PRs are welcome. Keep the discipline the codebase already follows: strict TypeScript, no `any`, pure domain logic separated from UI, parameterized SQL only, Thai user-facing messages, and tests for every money-math change.

## License

[MIT](LICENSE)
