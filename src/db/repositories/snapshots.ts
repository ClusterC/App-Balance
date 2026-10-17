// The snapshot timeline.
//
// Reads live here; writes do not. Inserting or deleting a snapshot has to
// rewrite `derived_delta_satang` for every later row in the same transaction,
// and that recalculation must see the new row's `id` — so it is a Rust command
// (`src/lib/commands.ts` → `saveSnapshot` / `deleteSnapshot`), which owns a real
// `sqlx` transaction. This module is the read side and the CSV-facing queries.

import { select } from '../connection';
import { toSnapshot, type SnapshotRow } from '../types';
import type { RecalculatedSnapshot } from '../../domain/snapshots';

const COLUMNS =
  'id, account_id, balance_satang, effective_at, update_type, category_id, note, ' +
  'derived_delta_satang, prev_snapshot_id, is_classified, created_at, updated_at';

/**
 * A snapshot row as the domain layer consumes it.
 *
 * Identical to `SnapshotRow` with the SQLite flags and nulls normalised, so it
 * can be handed straight to `aggregatePeriod` / `buildBalanceSeries`.
 */
export type TimelineEntry = ReturnType<typeof toSnapshot>;

export async function listSnapshots(accountId?: number): Promise<TimelineEntry[]> {
  const rows =
    accountId === undefined
      ? await select<SnapshotRow[]>(
          `SELECT ${COLUMNS} FROM balance_snapshots ORDER BY effective_at ASC, id ASC`,
        )
      : await select<SnapshotRow[]>(
          `SELECT ${COLUMNS} FROM balance_snapshots WHERE account_id = $1
           ORDER BY effective_at ASC, id ASC`,
          [accountId],
        );
  return rows.map(toSnapshot);
}

/**
 * Every snapshot across every account, newest first.
 *
 * The timeline page reads this; all arithmetic elsewhere sorts chronologically
 * itself, so this ordering is for display only.
 */
export async function listSnapshotsNewestFirst(accountId?: number): Promise<TimelineEntry[]> {
  const rows =
    accountId === undefined
      ? await select<SnapshotRow[]>(
          `SELECT ${COLUMNS} FROM balance_snapshots ORDER BY effective_at DESC, id DESC`,
        )
      : await select<SnapshotRow[]>(
          `SELECT ${COLUMNS} FROM balance_snapshots WHERE account_id = $1
           ORDER BY effective_at DESC, id DESC`,
          [accountId],
        );
  return rows.map(toSnapshot);
}

export async function listSnapshotsInRange(start: string, end: string): Promise<TimelineEntry[]> {
  const rows = await select<SnapshotRow[]>(
    `SELECT ${COLUMNS} FROM balance_snapshots
     WHERE date(effective_at, '+7 hours') BETWEEN $1 AND $2
     ORDER BY effective_at ASC, id ASC`,
    [start, end],
  );
  return rows.map(toSnapshot);
}

export async function getSnapshot(id: number): Promise<TimelineEntry | null> {
  const rows = await select<SnapshotRow[]>(`SELECT ${COLUMNS} FROM balance_snapshots WHERE id = $1`, [
    id,
  ]);
  const row = rows[0];
  return row ? toSnapshot(row) : null;
}

/** The newest snapshot per account, for the account cards. */
export async function latestSnapshotPerAccount(): Promise<Map<number, TimelineEntry>> {
  const rows = await select<SnapshotRow[]>(
    `SELECT ${COLUMNS} FROM balance_snapshots s
     WHERE s.id = (
       SELECT id FROM balance_snapshots
       WHERE account_id = s.account_id
       ORDER BY effective_at DESC, id DESC LIMIT 1
     )`,
  );
  const byAccount = new Map<number, TimelineEntry>();
  for (const row of rows) {
    const entry = toSnapshot(row);
    byAccount.set(entry.accountId, entry);
  }
  return byAccount;
}

/**
 * Snapshot counts per account, keyed by account id.
 *
 * Used by the account list to distinguish "no history yet" from "history that
 * happens to be flat", which need different empty states.
 */
export async function snapshotCounts(): Promise<Map<number, number>> {
  const rows = await select<{ account_id: number; count: number }[]>(
    'SELECT account_id, count(*) AS count FROM balance_snapshots GROUP BY account_id',
  );
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.account_id, row.count);
  return counts;
}

/** A snapshot the CSV exporter and the reports both need: joined with names. */
export interface SnapshotDetail extends TimelineEntry {
  accountName: string;
  categoryName: string | null;
}

export async function listSnapshotDetails(
  start?: string,
  end?: string,
): Promise<SnapshotDetail[]> {
  const base = `SELECT s.id, s.account_id, s.balance_satang, s.effective_at, s.update_type,
       s.category_id, s.note, s.derived_delta_satang, s.prev_snapshot_id, s.is_classified,
       s.created_at, s.updated_at, a.name AS account_name, c.name AS category_name
     FROM balance_snapshots s
     JOIN accounts a   ON a.id = s.account_id
     LEFT JOIN categories c ON c.id = s.category_id`;

  const rows =
    start !== undefined && end !== undefined
      ? await select<(SnapshotRow & { account_name: string; category_name: string | null })[]>(
          `${base} WHERE date(s.effective_at, '+7 hours') BETWEEN $1 AND $2
           ORDER BY s.effective_at ASC, s.id ASC`,
          [start, end],
        )
      : await select<(SnapshotRow & { account_name: string; category_name: string | null })[]>(
          `${base} ORDER BY s.effective_at ASC, s.id ASC`,
        );

  return rows.map((row) => ({
    ...toSnapshot(row),
    accountName: row.account_name,
    categoryName: row.category_name,
  }));
}

/** Convenience for the domain functions, which take `RecalculatedSnapshot`. */
export function toRecalculated(entries: readonly TimelineEntry[]): RecalculatedSnapshot[] {
  return entries.map((entry) => ({
    id: entry.id,
    accountId: entry.accountId,
    balanceSatang: entry.balanceSatang,
    effectiveAt: entry.effectiveAt,
    updateType: entry.updateType,
    categoryId: entry.categoryId,
    note: entry.note,
    derivedDeltaSatang: entry.derivedDeltaSatang,
    prevSnapshotId: entry.prevSnapshotId,
    isClassified: entry.isClassified,
  }));
}
