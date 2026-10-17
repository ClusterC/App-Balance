// The delta engine — the load-bearing piece of the whole application.
//
// The product model: the user never links a bank. They type in the balance they
// can actually see, whenever they happen to look. Each entry is an immutable
// snapshot. What *happened* between two snapshots is the difference between
// them, and that difference — the delta — is the only record of the money
// moving. Everything else in the app is built on this timeline.
//
// A consequence that drives the design: snapshots can be entered out of order.
// A user checks their balance on Monday, then remembers a withdrawal from last
// Friday and enters that too. Inserting a past-dated snapshot changes the delta
// of *every* snapshot after it, so deltas are recalculated as a batch, in
// chronological order, rather than computed one at a time on read.
//
// This module is pure: array in, array out. No database, no React, no clock.
// That is what makes the required test cases — insert a past snapshot, edit a
// balance, delete a middle snapshot — three plain assertions.

import { bangkokDateKey } from './dates';
import { subSatang, type Satang } from './money';

export type UpdateType =
  | 'income'
  | 'expense'
  | 'transfer_in'
  | 'transfer_out'
  | 'adjustment'
  | 'unknown';

export const UPDATE_TYPES: readonly UpdateType[] = [
  'income',
  'expense',
  'transfer_in',
  'transfer_out',
  'adjustment',
  'unknown',
];

/** The parts of a snapshot this module reasons about. */
export interface SnapshotLike {
  readonly id: number;
  readonly accountId: number;
  /** What the user typed. Never derived, never rewritten. */
  readonly balanceSatang: Satang;
  /** ISO 8601 UTC. */
  readonly effectiveAt: string;
  readonly updateType: UpdateType;
  readonly categoryId: number | null;
  readonly note: string | null;
}

/** A snapshot carrying the values this module computes. */
export interface RecalculatedSnapshot extends SnapshotLike {
  /**
   * Change from the previous snapshot, or from the account's opening balance
   * for the first snapshot of an account.
   */
  readonly derivedDeltaSatang: Satang;
  /** The snapshot immediately before this one, by `effectiveAt`. */
  readonly prevSnapshotId: number | null;
  /** `false` only for `unknown` — those deltas are reported separately. */
  readonly isClassified: boolean;
}

/** The account a snapshot belongs to, as far as the delta chain cares. */
export interface AccountOpening {
  readonly id: number;
  readonly openingBalanceSatang: Satang;
  /** `YYYY-MM-DD`, Bangkok-local. Informational: the seed is the balance. */
  readonly openingDate: string;
}

// ── ordering ────────────────────────────────────────────────────────────────

/**
 * Chronological order, oldest first, ties broken by `id`.
 *
 * A unique index on `(account_id, effective_at)` means ties should not occur,
 * but two rows can still be handed in with equal timestamps by a test or by a
 * migration, and an unstable order there would make deltas depend on input
 * order. The `id` tie-break makes the result deterministic.
 */
export function compareChronologically(a: SnapshotLike, b: SnapshotLike): number {
  if (a.effectiveAt !== b.effectiveAt) return a.effectiveAt < b.effectiveAt ? -1 : 1;
  return a.id - b.id;
}

/** Newest first, for display. All arithmetic still uses chronological order. */
export function compareNewestFirst(a: SnapshotLike, b: SnapshotLike): number {
  return -compareChronologically(a, b);
}

// ── the core recalculation ──────────────────────────────────────────────────

/**
 * Recomputes `derivedDeltaSatang`, `prevSnapshotId` and `isClassified` for one
 * account's snapshots.
 *
 * The first snapshot's delta is measured against the account's
 * `openingBalanceSatang`, as though a virtual snapshot existed on the opening
 * date. Every later delta is against the immediately preceding snapshot.
 *
 * Pure and total: it sorts a copy, never mutates its input, and is safe to call
 * with an empty list.
 */
export function recalculateDeltas(
  snapshots: readonly SnapshotLike[],
  opening: AccountOpening,
): RecalculatedSnapshot[] {
  const ordered = [...snapshots].sort(compareChronologically);

  const result: RecalculatedSnapshot[] = [];
  let previousBalance = opening.openingBalanceSatang;
  let previousId: number | null = null;

  for (const snapshot of ordered) {
    result.push({
      ...snapshot,
      derivedDeltaSatang: subSatang(snapshot.balanceSatang, previousBalance),
      prevSnapshotId: previousId,
      isClassified: snapshot.updateType !== 'unknown',
    });
    previousBalance = snapshot.balanceSatang;
    previousId = snapshot.id;
  }

  return result;
}

/** Groups snapshots by account, so one call can recalculate a whole database. */
export function groupByAccount<T extends { accountId: number }>(
  rows: readonly T[],
): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.accountId);
    if (bucket) bucket.push(row);
    else grouped.set(row.accountId, [row]);
  }
  return grouped;
}

/**
 * Recalculates every account at once.
 *
 * Takes the full snapshot set and the full account set, so a caller can hand
 * over two query results and get back a complete, consistent delta timeline.
 * Accounts with no snapshots produce no entries.
 */
export function recalculateAll(
  snapshots: readonly SnapshotLike[],
  accounts: readonly AccountOpening[],
): RecalculatedSnapshot[] {
  const openings = new Map(accounts.map((account) => [account.id, account]));
  const result: RecalculatedSnapshot[] = [];

  for (const [accountId, rows] of groupByAccount(snapshots)) {
    const opening = openings.get(accountId);
    if (!opening) continue;
    result.push(...recalculateDeltas(rows, opening));
  }

  return result.sort(compareChronologically);
}

// ── pure mutation helpers ───────────────────────────────────────────────────
//
// These exist so the three required behaviours — insert a past-dated snapshot,
// edit a balance, delete a middle snapshot — are testable as pure array
// transforms, with no database involved. The repository layer calls the same
// logic after it has written the row.

/**
 * Adds a snapshot and recalculates.
 *
 * `id` must already be assigned: a real insert gets one from SQLite, and the
 * delta chain depends on it only for deterministic tie-breaking.
 */
export function insertSnapshot(
  snapshots: readonly SnapshotLike[],
  incoming: SnapshotLike,
  opening: AccountOpening,
): RecalculatedSnapshot[] {
  return recalculateDeltas([...snapshots, incoming], opening);
}

/** Replaces a snapshot's mutable fields and recalculates the whole chain. */
export function editSnapshot(
  snapshots: readonly SnapshotLike[],
  id: number,
  changes: Partial<Omit<SnapshotLike, 'id' | 'accountId'>>,
  opening: AccountOpening,
): RecalculatedSnapshot[] {
  const updated = snapshots.map((snapshot) =>
    snapshot.id === id ? { ...snapshot, ...changes } : snapshot,
  );
  return recalculateDeltas(updated, opening);
}

/**
 * Removes a snapshot and recalculates.
 *
 * The neighbours re-link automatically: the snapshot after the deleted one now
 * measures against the one before it, so its delta absorbs the removed change
 * rather than leaving a gap.
 */
export function deleteSnapshot(
  snapshots: readonly SnapshotLike[],
  id: number,
  opening: AccountOpening,
): RecalculatedSnapshot[] {
  return recalculateDeltas(
    snapshots.filter((snapshot) => snapshot.id !== id),
    opening,
  );
}

// ── derived views ───────────────────────────────────────────────────────────

/** The newest snapshot by `effectiveAt`, or `null` for an empty timeline. */
export function latestSnapshot(
  snapshots: readonly SnapshotLike[],
): SnapshotLike | null {
  let latest: SnapshotLike | null = null;
  for (const snapshot of snapshots) {
    if (!latest || compareChronologically(snapshot, latest) > 0) latest = snapshot;
  }
  return latest;
}

/**
 * The balance an account holds after a given snapshot, which is simply the
 * snapshot's own balance — included as a named function because the UI reads
 * better for it, and because it makes the "balance is never recomputed" rule
 * explicit at the call site.
 */
export function balanceAfter(snapshot: SnapshotLike): Satang {
  return snapshot.balanceSatang;
}

/** Total movement across a set of snapshots, in satang. */
export function totalDelta(snapshots: readonly RecalculatedSnapshot[]): Satang {
  let total = 0;
  for (const snapshot of snapshots) total += snapshot.derivedDeltaSatang;
  return total;
}

/**
 * Snapshots entered before the account's opening date.
 *
 * Not an error the engine acts on — the opening balance is still the seed — but
 * worth surfacing, because it usually means the user mistyped a year.
 */
export function snapshotsBeforeOpening(
  snapshots: readonly SnapshotLike[],
  opening: AccountOpening,
): SnapshotLike[] {
  return snapshots.filter(
    (snapshot) => bangkokDateKey(snapshot.effectiveAt) < opening.openingDate,
  );
}

/**
 * Snapshots sharing an exact `effectiveAt`.
 *
 * The database's unique index makes this impossible through the normal write
 * path, so a non-empty result means the data was edited outside the app.
 */
export function duplicateTimestamps(snapshots: readonly SnapshotLike[]): SnapshotLike[][] {
  const byTime = new Map<string, SnapshotLike[]>();
  for (const snapshot of snapshots) {
    const bucket = byTime.get(snapshot.effectiveAt);
    if (bucket) bucket.push(snapshot);
    else byTime.set(snapshot.effectiveAt, [snapshot]);
  }
  return [...byTime.values()].filter((rows) => rows.length > 1);
}

/**
 * Whether a delta should be treated as a duplicate of a recorded transaction.
 *
 * The rule from the spec is deliberately narrow: a snapshot delta is excluded
 * from cash-flow totals **only** when a transaction points at it by
 * `linkedSnapshotId`. Nothing is guessed from matching dates or amounts.
 */
export function isLinkedToTransaction(
  snapshotId: number,
  linkedSnapshotIds: ReadonlySet<number>,
): boolean {
  return linkedSnapshotIds.has(snapshotId);
}

/**
 * Accounts where an unlinked, classified delta lands on a day that already has
 * transactions.
 *
 * This is the double-counting risk the spec asks to surface rather than
 * silently correct: the app cannot tell a genuine coincidence from a user
 * entering the same event twice, so it warns and lets them decide.
 */
export function doubleCountCandidates(
  snapshots: readonly RecalculatedSnapshot[],
  transactionDatesByAccount: ReadonlyMap<number, ReadonlySet<string>>,
  linkedSnapshotIds: ReadonlySet<number>,
): RecalculatedSnapshot[] {
  return snapshots.filter((snapshot) => {
    if (!snapshot.isClassified) return false;
    if (linkedSnapshotIds.has(snapshot.id)) return false;
    if (snapshot.updateType !== 'income' && snapshot.updateType !== 'expense') return false;
    const dates = transactionDatesByAccount.get(snapshot.accountId);
    if (!dates) return false;
    return dates.has(bangkokDateKey(snapshot.effectiveAt));
  });
}
