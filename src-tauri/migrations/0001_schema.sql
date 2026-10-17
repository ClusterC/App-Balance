-- ============================================================================
-- Balance — initial schema (migration 0001)
--
-- Conventions enforced throughout:
--   * Money is ALWAYS an INTEGER count of satang (1 THB = 100 satang).
--     Never a float. ฿1,234.56 is stored as 123456.
--   * Timestamps are ISO 8601 UTC text, e.g. 2026-10-16T08:30:00Z.
--     Bangkok-local dates are derived for display, never stored.
--   * Liability accounts (credit cards) store NEGATIVE balances, so
--     net worth is always SUM(balance) with no per-type branching.
--   * Archiving is preferred over deletion for anything referenced.
--
-- The default Thai categories are appended from sql/seed_categories.sql by
-- `migrations()` in lib.rs, so the same statement serves the migration and the
-- "start over" reset.
-- ============================================================================

-- ── accounts ────────────────────────────────────────────────────────────────
CREATE TABLE accounts (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  institution            TEXT,
  account_type           TEXT    NOT NULL
                         CHECK (account_type IN ('bank','cash','ewallet','credit_card','other')),
  -- Only a short suffix is ever stored; a full account number is never needed.
  number_suffix          TEXT    CHECK (number_suffix IS NULL OR length(number_suffix) <= 4),
  color                  TEXT,
  icon                   TEXT,
  currency               TEXT    NOT NULL DEFAULT 'THB',
  opening_balance_satang INTEGER NOT NULL DEFAULT 0,
  opening_date           TEXT    NOT NULL,
  credit_limit_satang    INTEGER CHECK (credit_limit_satang IS NULL OR credit_limit_satang > 0),
  is_liability           INTEGER NOT NULL DEFAULT 0 CHECK (is_liability IN (0,1)),
  is_archived            INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  archived_at            TEXT,
  position               INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_accounts_archived ON accounts(is_archived, position);

-- ── categories ──────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  kind        TEXT    NOT NULL CHECK (kind IN ('income','expense')),
  icon        TEXT,
  color       TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE UNIQUE INDEX uq_categories_name_kind ON categories(name, kind);
CREATE INDEX idx_categories_kind ON categories(kind, is_archived, position);

-- ── balance_snapshots ───────────────────────────────────────────────────────
-- The heart of the app: an immutable, user-entered statement of what an
-- account actually held at a point in time.
CREATE TABLE balance_snapshots (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id           INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- SOURCE OF TRUTH: exactly what the user typed. Never recalculated.
  balance_satang       INTEGER NOT NULL,
  effective_at         TEXT    NOT NULL,
  update_type          TEXT    NOT NULL DEFAULT 'unknown'
                       CHECK (update_type IN
                         ('income','expense','transfer_in','transfer_out','adjustment','unknown')),
  category_id          INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note                 TEXT,
  -- DERIVED, cached. Recomputed in chronological order after any mutation.
  derived_delta_satang INTEGER,
  prev_snapshot_id     INTEGER REFERENCES balance_snapshots(id) ON DELETE SET NULL,
  is_classified        INTEGER NOT NULL DEFAULT 0 CHECK (is_classified IN (0,1)),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- One snapshot per account per instant; chronological scans are the hot path.
CREATE UNIQUE INDEX uq_snap_account_time ON balance_snapshots(account_id, effective_at);
CREATE INDEX idx_snap_effective ON balance_snapshots(effective_at DESC);
CREATE INDEX idx_snap_category  ON balance_snapshots(category_id);

-- ── tags ────────────────────────────────────────────────────────────────────
CREATE TABLE tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  color      TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── transactions ────────────────────────────────────────────────────────────
CREATE TABLE transactions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  -- RESTRICT, not CASCADE: deleting an account must not silently erase history.
  account_id         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  kind               TEXT    NOT NULL
                     CHECK (kind IN ('income','expense','transfer_in','transfer_out','adjustment')),
  -- SIGNED. The CHECK below makes the sign a database invariant, so no code
  -- path can produce an expense with a positive amount.
  amount_satang      INTEGER NOT NULL CHECK (amount_satang <> 0),
  currency           TEXT    NOT NULL DEFAULT 'THB',
  category_id        INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  occurred_at        TEXT    NOT NULL,
  note               TEXT,
  -- Both legs of a transfer share one UUID so they can be edited/deleted together.
  transfer_group_id  TEXT,
  -- Set when this transaction is the explicit explanation of a snapshot's delta.
  -- Such a delta is then excluded from cash-flow totals to avoid double counting.
  linked_snapshot_id INTEGER REFERENCES balance_snapshots(id) ON DELETE SET NULL,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (
       (kind IN ('income','transfer_in')  AND amount_satang > 0)
    OR (kind IN ('expense','transfer_out') AND amount_satang < 0)
    OR (kind = 'adjustment')
  )
);

CREATE INDEX idx_tx_account_time ON transactions(account_id, occurred_at DESC);
CREATE INDEX idx_tx_time         ON transactions(occurred_at DESC);
CREATE INDEX idx_tx_category     ON transactions(category_id);
CREATE INDEX idx_tx_kind_time    ON transactions(kind, occurred_at);
CREATE INDEX idx_tx_transfer     ON transactions(transfer_group_id);
CREATE INDEX idx_tx_snapshot     ON transactions(linked_snapshot_id);

CREATE TABLE transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         INTEGER NOT NULL REFERENCES tags(id)         ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX idx_tx_tags_tag ON transaction_tags(tag_id);

-- ── budgets ─────────────────────────────────────────────────────────────────
CREATE TABLE budgets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  -- First day of the budget month, 'YYYY-MM-01'.
  period_start  TEXT    NOT NULL,
  amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE UNIQUE INDEX uq_budget_cat_period ON budgets(category_id, period_start);

-- ── settings ────────────────────────────────────────────────────────────────
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── backup / restore bookkeeping ────────────────────────────────────────────
CREATE TABLE import_export_metadata (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL CHECK (kind IN ('manual_backup','auto_safety','restore')),
  file_path      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL,
  app_version    TEXT NOT NULL,
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
