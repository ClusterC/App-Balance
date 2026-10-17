// Transactions.
//
// Reads only, plus the two single-row writes that are genuinely single-row
// (a plain income/expense/adjustment and its deletion). A *transfer* writes two
// rows that must both exist or neither, so it goes through the Rust
// `create_transfer` command instead — see `src/lib/commands.ts`.

import { execute, select } from '../connection';
import { toTransaction, type Transaction, type TransactionKind, type TransactionRow } from '../types';

const COLUMNS =
  'id, account_id, kind, amount_satang, currency, category_id, occurred_at, note, ' +
  'transfer_group_id, linked_snapshot_id, created_at, updated_at';

export interface TransactionDraft {
  accountId: number;
  kind: TransactionKind;
  /** Signed, and required to match `kind` — the schema's CHECK enforces it. */
  amountSatang: number;
  categoryId: number | null;
  occurredAt: string;
  note: string | null;
  linkedSnapshotId: number | null;
}

export interface TransactionFilters {
  accountId?: number;
  categoryId?: number;
  kind?: TransactionKind;
  start?: string;
  end?: string;
}

export async function listTransactions(
  filters: TransactionFilters = {},
): Promise<Transaction[]> {
  // Built from a fixed set of fragments; every value is still bound, never
  // interpolated, so no filter can alter the statement's shape.
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.accountId !== undefined) {
    params.push(filters.accountId);
    conditions.push(`account_id = $${params.length}`);
  }
  if (filters.categoryId !== undefined) {
    params.push(filters.categoryId);
    conditions.push(`category_id = $${params.length}`);
  }
  if (filters.kind !== undefined) {
    params.push(filters.kind);
    conditions.push(`kind = $${params.length}`);
  }
  if (filters.start !== undefined && filters.end !== undefined) {
    params.push(filters.start, filters.end);
    conditions.push(`date(occurred_at, '+7 hours') BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await select<TransactionRow[]>(
    `SELECT ${COLUMNS} FROM transactions ${where} ORDER BY occurred_at DESC, id DESC`,
    params,
  );
  return rows.map(toTransaction);
}

export async function getTransaction(id: number): Promise<Transaction | null> {
  const rows = await select<TransactionRow[]>(`SELECT ${COLUMNS} FROM transactions WHERE id = $1`, [
    id,
  ]);
  const row = rows[0];
  return row ? toTransaction(row) : null;
}

export async function createTransaction(draft: TransactionDraft): Promise<number> {
  const result = await execute(
    `INSERT INTO transactions
       (account_id, kind, amount_satang, category_id, occurred_at, note, linked_snapshot_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      draft.accountId,
      draft.kind,
      draft.amountSatang,
      draft.categoryId,
      draft.occurredAt,
      draft.note,
      draft.linkedSnapshotId,
    ],
  );
  return result.lastInsertId ?? 0;
}

export async function updateTransaction(id: number, draft: TransactionDraft): Promise<void> {
  await execute(
    `UPDATE transactions SET account_id = $1, kind = $2, amount_satang = $3, category_id = $4,
       occurred_at = $5, note = $6, linked_snapshot_id = $7,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $8`,
    [
      draft.accountId,
      draft.kind,
      draft.amountSatang,
      draft.categoryId,
      draft.occurredAt,
      draft.note,
      draft.linkedSnapshotId,
      id,
    ],
  );
}

/**
 * Deletes a single transaction.
 *
 * Refuses a transfer leg: deleting one side of a transfer would leave a
 * one-legged movement that no report can explain. Transfers are deleted as a
 * pair through the Rust `delete_transfer` command.
 */
export async function deleteTransaction(id: number): Promise<void> {
  await execute(
    `DELETE FROM transactions
     WHERE id = $1
       AND transfer_group_id IS NULL`,
    [id],
  );
}

/** Transactions that name a snapshot as their explanation, for the double-count guard. */
export async function linkedSnapshotIds(): Promise<Set<number>> {
  const rows = await select<{ linked_snapshot_id: number }[]>(
    'SELECT linked_snapshot_id FROM transactions WHERE linked_snapshot_id IS NOT NULL',
  );
  return new Set(rows.map((row) => row.linked_snapshot_id));
}

/**
 * The Bangkok date keys that already carry a transaction, per account.
 *
 * `cashflow.ts` uses this to warn about a possible double count: an unlinked
 * classified delta sharing a day with a transaction is likely the same money
 * recorded twice. The `+7 hours` shift is what makes the comparison a Bangkok
 * day rather than a UTC one.
 */
export async function transactionDatesByAccount(): Promise<Map<number, Set<string>>> {
  const rows = await select<{ account_id: number; date_key: string }[]>(
    `SELECT DISTINCT account_id, date(occurred_at, '+7 hours') AS date_key FROM transactions`,
  );
  const dates = new Map<number, Set<string>>();
  for (const row of rows) {
    const set = dates.get(row.account_id) ?? new Set<string>();
    set.add(row.date_key);
    dates.set(row.account_id, set);
  }
  return dates;
}

/** A transaction joined with the names a table or CSV needs. */
export interface TransactionDetail extends Transaction {
  accountName: string;
  categoryName: string | null;
}

export async function listTransactionDetails(
  filters: TransactionFilters = {},
): Promise<TransactionDetail[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.accountId !== undefined) {
    params.push(filters.accountId);
    conditions.push(`t.account_id = $${params.length}`);
  }
  if (filters.categoryId !== undefined) {
    params.push(filters.categoryId);
    conditions.push(`t.category_id = $${params.length}`);
  }
  if (filters.kind !== undefined) {
    params.push(filters.kind);
    conditions.push(`t.kind = $${params.length}`);
  }
  if (filters.start !== undefined && filters.end !== undefined) {
    params.push(filters.start, filters.end);
    conditions.push(`date(t.occurred_at, '+7 hours') BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await select<(TransactionRow & { account_name: string; category_name: string | null })[]>(
    `SELECT ${COLUMNS.split(', ')
      .map((column) => `t.${column}`)
      .join(', ')}, a.name AS account_name, c.name AS category_name
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     ${where}
     ORDER BY t.occurred_at DESC, t.id DESC`,
    params,
  );

  return rows.map((row) => ({
    ...toTransaction(row),
    accountName: row.account_name,
    categoryName: row.category_name,
  }));
}
