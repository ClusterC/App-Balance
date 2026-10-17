# Database schema

The schema lives in `src-tauri/migrations/0001_init.sql` and is applied by the Tauri SQL plugin on first launch. This document explains the shape and the invariants; the migration file is the authority.

All monetary columns are **integer satang** (1 THB = 100 satang). No floating point is ever stored. All timestamps are ISO 8601 UTC text (`YYYY-MM-DDTHH:MM:SSZ`); day boundaries in queries use `date(…, '+7 hours')` because Asia/Bangkok is a fixed UTC+7 with no daylight saving.

## Tables

### `app_settings`

| column | type | notes |
|---|---|---|
| key | TEXT PK | e.g. `stalenessThresholdDays`, `themeMode` |
| value | TEXT | JSON-encoded scalar |
| updated_at | TEXT | |

A key exists only when something consumes it; defaults live in `src/db/repositories/settings.ts`.

### `accounts`

| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | non-empty, `CHECK` enforced |
| institution | TEXT | nullable |
| account_type | TEXT | `bank` / `cash` / `ewallet` / `credit_card` / `other` |
| number_suffix | TEXT | **max 4 chars** — privacy: a full account number is never stored |
| color, icon | TEXT | nullable display hints |
| currency | TEXT | default `THB` |
| opening_balance_satang | INTEGER | seeds the delta chain |
| opening_date | TEXT | `YYYY-MM-DD`, Bangkok-local |
| credit_limit_satang | INTEGER | nullable, credit cards only |
| is_liability | INTEGER | credit cards are liabilities |
| is_archived | INTEGER | archive instead of delete |
| position | INTEGER | display order |
| created_at, updated_at | TEXT | |

### `categories`

`name`, `kind` (`income`/`expense`), `icon`, `color`, `is_archived`, `position`, timestamps. Unique on `(name, kind)`. Referenced rows block deletion (archive instead); FK `ON DELETE SET NULL` on referencing tables.

### `balance_snapshots` — the core table

| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| account_id | INTEGER FK | `ON DELETE CASCADE` with the account |
| **balance_satang** | INTEGER | **source of truth** — exactly what the user typed, never rewritten |
| effective_at | TEXT | ISO UTC |
| update_type | TEXT | `income` / `expense` / `transfer_in` / `transfer_out` / `adjustment` / `unknown` |
| category_id | INTEGER FK | nullable |
| note | TEXT | nullable |
| **derived_delta_satang** | INTEGER | **derived, cached** — recomputed after every mutation |
| **prev_snapshot_id** | INTEGER | derived — the chronologically previous snapshot |
| **is_classified** | INTEGER | derived — false only for `update_type = 'unknown'` |
| created_at, updated_at | TEXT | `created_at` is preserved on edit (audit trail) |

Unique index on `(account_id, effective_at)`. Index on `account_id, effective_at` for the timeline query.

**The delta invariant:** the three derived columns are always consistent with the full chronological chain of the account, measured against `accounts.opening_balance_satang` for the first snapshot. The Rust command `recalculate` (in `src-tauri/src/commands/db.rs`) recomputes them for every later row of the account inside the same transaction as any insert/update/delete — this is why a past-dated insert correctly shifts all subsequent deltas.

### `transactions`

| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| account_id | INTEGER FK | `ON DELETE **RESTRICT**` — deleting an account must not erase history |
| kind | TEXT | `income` / `expense` / `transfer_in` / `transfer_out` / `adjustment` |
| amount_satang | INTEGER | **signed**; `CHECK (amount_satang <> 0)` plus per-kind sign CHECKs make the sign a database invariant |
| currency | TEXT | default `THB` |
| category_id | INTEGER FK | nullable |
| occurred_at | TEXT | ISO UTC |
| note | TEXT | |
| transfer_group_id | TEXT | both legs of a transfer share one id |
| linked_snapshot_id | INTEGER FK | the snapshot this transaction explains — the double-counting guard |
| created_at, updated_at | TEXT | |

Indexes on `account_id, occurred_at` and `category_id`.

### `tags`, `transaction_tags`

Classic many-to-many. Both FKs cascade.

### `budgets`

`category_id` (FK cascade), `period_start` (`YYYY-MM-01`), `amount_satang` (`> 0`), timestamps. One row per category per month; the spending side is computed, never stored.

## No double-counting, by construction

- Reports count explicit transactions **and** classified snapshot deltas.
- A snapshot whose id appears in any transaction's `linked_snapshot_id` is excluded from delta totals — the transaction already tells that story.
- Transfer legs cancel: `transfer_out` is negative, `transfer_in` positive, same group id, and neither is income nor expense.
- When an unlinked classified income/expense delta lands on a Bangkok calendar day that also has transactions, `domain/snapshots.ts`' `doubleCountCandidates` flags it and the UI warns. The app never silently corrects this — the user decides.

## Migrations

The plugin applies migrations in order and records the version in its own metadata table. Version 1 is the schema above; future changes append new migration files and never rewrite old ones, so an existing database upgrades in place.
