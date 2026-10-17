// Cash-flow aggregation.
//
// This is where the app's one genuinely subtle rule lives, so it is worth
// stating plainly.
//
// There are two ways money movement can be recorded:
//
//   1. As a **transaction** — the user says "I spent ฿250 on food".
//   2. As a **snapshot delta** — the user types a new balance and the app
//      notices it went down by ฿250.
//
// Both describe the same ฿250 if the user did both. The rule from the spec is
// that a snapshot delta is excluded from income/expense totals **only when a
// transaction explicitly points at it** via `linkedSnapshotId`. Nothing is
// inferred from a matching amount or date — an explicit link wins, and that is
// the whole rule.
//
// The unavoidable consequence: the app cannot detect an *unlinked* pair. A user
// who enters the same event both ways and never links them gets a doubled
// figure. Rather than guessing and silently dropping data, the app counts both
// and raises a warning banner naming the affected entries, so the user decides.
// That behaviour is `doubleCountCandidates` in `snapshots.ts`, and the
// `warnings` field below is where the UI learns about it.
//
// Pure module: no React, no database, no clock.

import { bangkokDateKey, isWithin, type DateRange } from './dates';
import { sumSatang, type Satang } from './money';
import {
  compareChronologically,
  type RecalculatedSnapshot,
} from './snapshots';

/** A recorded transaction, as far as aggregation cares. */
export interface TransactionLike {
  readonly id: number;
  readonly accountId: number;
  readonly kind: 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'adjustment';
  /** Signed: positive for income and transfer_in, negative for expense and transfer_out. */
  readonly amountSatang: Satang;
  readonly categoryId: number | null;
  readonly occurredAt: string;
  readonly note: string | null;
  /** Set when this transaction explains a snapshot's delta. */
  readonly linkedSnapshotId: number | null;
}

export interface CashflowInput {
  readonly transactions: readonly TransactionLike[];
  /** Deltas, already recalculated, with `isClassified` populated. */
  readonly snapshots: readonly RecalculatedSnapshot[];
  readonly range: DateRange;
  readonly categories: readonly { id: number; name: string; kind: 'income' | 'expense' }[];
  readonly accounts: readonly { id: number; name: string }[];
}

/** One line of a per-category or per-account breakdown. */
export interface Rollup {
  readonly id: number;
  readonly name: string;
  readonly amountSatang: Satang;
  readonly share: number;
}

export interface CashflowWarning {
  readonly kind: 'possible_double_count' | 'snapshots_before_opening';
  /** Snapshot ids the warning is about, so the UI can link to them. */
  readonly snapshotIds: readonly number[];
}

export interface CashflowSummary {
  readonly income: Satang;
  readonly expense: Satang;
  /** `income + expense`, since expense is stored as a negative magnitude. */
  readonly net: Satang;
  readonly transfersIn: Satang;
  readonly transfersOut: Satang;
  readonly adjustments: Satang;
  /** Classified deltas with no linked transaction — counted above. */
  readonly deltaIncome: Satang;
  readonly deltaExpense: Satang;
  /** Deltas whose update type is `unknown`; deliberately outside income/expense. */
  readonly unclassified: Satang;
  readonly unclassifiedCount: number;
  readonly transactionCount: number;
  readonly byCategoryExpense: readonly Rollup[];
  readonly byCategoryIncome: readonly Rollup[];
  readonly byAccount: readonly Rollup[];
  readonly warnings: readonly CashflowWarning[];
}

/**
 * Aggregates one reporting window.
 *
 * Everything is filtered by Bangkok calendar day, so a transaction at
 * `2026-10-31T18:00:00Z` belongs to 1 November in Bangkok and lands in
 * November's report, not October's.
 */
export function aggregatePeriod(input: CashflowInput): CashflowSummary {
  const { range, categories, accounts } = input;

  const inRange = (instant: string): boolean => isWithin(bangkokDateKey(instant), range);

  // A snapshot's delta is excluded only when a transaction names it.
  const linkedSnapshotIds = new Set<number>();
  for (const transaction of input.transactions) {
    if (transaction.linkedSnapshotId !== null) {
      linkedSnapshotIds.add(transaction.linkedSnapshotId);
    }
  }

  const windowTransactions = input.transactions.filter((t) => inRange(t.occurredAt));
  const windowSnapshots = input.snapshots.filter((s) => inRange(s.effectiveAt));

  // ── transactions ─────────────────────────────────────────────────────────
  let transactionIncome = 0;
  let transactionExpense = 0;
  let transfersIn = 0;
  let transfersOut = 0;
  let adjustments = 0;

  const expenseByCategory = new Map<number, number>();
  const incomeByCategory = new Map<number, number>();
  const byAccount = new Map<number, number>();

  for (const transaction of windowTransactions) {
    switch (transaction.kind) {
      case 'income':
        transactionIncome += transaction.amountSatang;
        break;
      case 'expense':
        transactionExpense += transaction.amountSatang;
        break;
      case 'transfer_in':
        transfersIn += transaction.amountSatang;
        break;
      case 'transfer_out':
        transfersOut += transaction.amountSatang;
        break;
      case 'adjustment':
        adjustments += transaction.amountSatang;
        break;
    }

    // Transfers are excluded from the per-category view: they have no
    // category, and counting them would make category totals disagree with
    // the income/expense headline.
    if (transaction.kind === 'expense' && transaction.categoryId !== null) {
      expenseByCategory.set(
        transaction.categoryId,
        (expenseByCategory.get(transaction.categoryId) ?? 0) + Math.abs(transaction.amountSatang),
      );
    }
    if (transaction.kind === 'income' && transaction.categoryId !== null) {
      incomeByCategory.set(
        transaction.categoryId,
        (incomeByCategory.get(transaction.categoryId) ?? 0) + transaction.amountSatang,
      );
    }

    // The account roll-up is net movement, so a transfer appears on both sides
    // and cancels out across the total.
    byAccount.set(
      transaction.accountId,
      (byAccount.get(transaction.accountId) ?? 0) + transaction.amountSatang,
    );
  }

  // ── snapshot deltas ──────────────────────────────────────────────────────
  let deltaIncome = 0;
  let deltaExpense = 0;
  let unclassified = 0;
  let unclassifiedCount = 0;
  const doubleCounted: number[] = [];

  for (const snapshot of windowSnapshots) {
    if (linkedSnapshotIds.has(snapshot.id)) continue; // counted via its transaction

    if (!snapshot.isClassified) {
      unclassified += snapshot.derivedDeltaSatang;
      unclassifiedCount += 1;
      continue;
    }

    switch (snapshot.updateType) {
      case 'income':
        deltaIncome += snapshot.derivedDeltaSatang;
        if (snapshot.categoryId !== null) {
          incomeByCategory.set(
            snapshot.categoryId,
            (incomeByCategory.get(snapshot.categoryId) ?? 0) + snapshot.derivedDeltaSatang,
          );
        }
        break;
      case 'expense':
        deltaExpense += snapshot.derivedDeltaSatang; // already negative
        if (snapshot.categoryId !== null) {
          expenseByCategory.set(
            snapshot.categoryId,
            (expenseByCategory.get(snapshot.categoryId) ?? 0) + Math.abs(snapshot.derivedDeltaSatang),
          );
        }
        break;
      case 'transfer_in':
        transfersIn += snapshot.derivedDeltaSatang;
        break;
      case 'transfer_out':
        transfersOut += snapshot.derivedDeltaSatang;
        break;
      case 'adjustment':
        adjustments += snapshot.derivedDeltaSatang;
        break;
      case 'unknown':
        break;
    }

    byAccount.set(
      snapshot.accountId,
      (byAccount.get(snapshot.accountId) ?? 0) + snapshot.derivedDeltaSatang,
    );

    // An unlinked classified delta landing on a day that also has transactions
    // for the same account is the shape of a double count. Advisory only.
    if (
      (snapshot.updateType === 'income' || snapshot.updateType === 'expense') &&
      windowTransactions.some(
        (t) =>
          t.accountId === snapshot.accountId &&
          bangkokDateKey(t.occurredAt) === bangkokDateKey(snapshot.effectiveAt),
      )
    ) {
      doubleCounted.push(snapshot.id);
    }
  }

  const income = transactionIncome + deltaIncome;
  const expense = transactionExpense + deltaExpense;

  const warnings: CashflowWarning[] = [];
  if (doubleCounted.length > 0) {
    warnings.push({ kind: 'possible_double_count', snapshotIds: doubleCounted });
  }

  return {
    income,
    expense,
    net: income + expense,
    transfersIn,
    transfersOut,
    adjustments,
    deltaIncome,
    deltaExpense,
    unclassified,
    unclassifiedCount,
    transactionCount: windowTransactions.length,
    byCategoryExpense: toRollups(expenseByCategory, categories),
    byCategoryIncome: toRollups(incomeByCategory, categories),
    byAccount: toRollups(byAccount, accounts),
    warnings,
  };
}

/** Sorts a map into descending rollups with shares of the total. */
function toRollups(
  values: ReadonlyMap<number, number>,
  labels: readonly { id: number; name: string }[],
): Rollup[] {
  const names = new Map(labels.map((label) => [label.id, label.name]));
  const total = sumSatang([...values.values()].map((v) => Math.abs(v)));

  return [...values.entries()]
    .map(([id, amount]) => ({
      id,
      name: names.get(id) ?? 'ไม่ทราบหมวดหมู่',
      amountSatang: amount,
      share: total === 0 ? 0 : Math.abs(amount) / total,
    }))
    .sort((a, b) => Math.abs(b.amountSatang) - Math.abs(a.amountSatang));
}

// ── comparisons ─────────────────────────────────────────────────────────────

export interface PeriodComparison {
  readonly current: CashflowSummary;
  readonly previous: CashflowSummary;
  readonly incomeChange: Satang;
  readonly expenseChange: Satang;
  readonly netChange: Satang;
}

/** Aggregates a window and the equally long window before it. */
export function compareWithPrevious(
  input: Omit<CashflowInput, 'range'>,
  range: DateRange,
  previous: DateRange,
): PeriodComparison {
  const current = aggregatePeriod({ ...input, range });
  const prior = aggregatePeriod({ ...input, range: previous });

  return {
    current,
    previous: prior,
    incomeChange: current.income - prior.income,
    expenseChange: current.expense - prior.expense,
    netChange: current.net - prior.net,
  };
}

// ── balance series ──────────────────────────────────────────────────────────

export interface BalancePoint {
  /** Bangkok `YYYY-MM-DD`. */
  readonly dateKey: string;
  /** Net worth at the end of that day. */
  readonly balanceSatang: Satang;
  /** Per-account balances, so a chart can show a stacked or split view. */
  readonly byAccount: ReadonlyMap<number, Satang>;
}

export interface BalanceSeriesInput {
  readonly snapshots: readonly RecalculatedSnapshot[];
  readonly accounts: readonly {
    id: number;
    openingBalanceSatang: Satang;
    openingDate: string;
  }[];
  readonly range: DateRange;
}

/**
 * A daily net-worth series over `range`, forward-filled.
 *
 * The forward fill is the important part. An account only has a snapshot on the
 * days the user checked it, so on any other day its balance is the most recent
 * one — not zero. Without carrying the last known value forward, the total line
 * would collapse on every day the user did not open the app, which is most of
 * them.
 *
 * Accounts with no snapshot in range still contribute their opening balance, so
 * a newly created account shows up immediately rather than appearing only once
 * it has history.
 */
export function buildBalanceSeries(input: BalanceSeriesInput): BalancePoint[] {
  const { range, accounts } = input;

  const ordered = [...input.snapshots].sort(compareChronologically);

  // Seed each account with its opening balance, then apply snapshots in order.
  const current = new Map<number, Satang>();
  for (const account of accounts) current.set(account.id, account.openingBalanceSatang);

  const dates = enumerateDays(range);
  const points: BalancePoint[] = [];
  let cursor = 0;

  for (const dateKey of dates) {
    // Apply every snapshot dated on or before this day, in chronological order.
    while (cursor < ordered.length) {
      const snapshot = ordered[cursor];
      if (!snapshot) break;
      if (bangkokDateKey(snapshot.effectiveAt) > dateKey) break;
      current.set(snapshot.accountId, snapshot.balanceSatang);
      cursor += 1;
    }

    let total = 0;
    for (const value of current.values()) total += value;

    points.push({
      dateKey,
      balanceSatang: total,
      byAccount: new Map(current),
    });
  }

  return points;
}

/** Every Bangkok date key in `range`, inclusive. */
export function enumerateDays(range: DateRange): string[] {
  const days: string[] = [];
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return days;

  // Bounded so a reversed or absurd range cannot loop forever.
  const limit = Math.min(Math.round((end - start) / 86_400_000), 3_660);
  for (let i = 0; i <= limit; i += 1) {
    days.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

/** Total assets and liabilities from the latest known balance per account. */
export function splitAssetsAndLiabilities(
  latestBalances: ReadonlyMap<number, Satang>,
  accounts: readonly { id: number; isLiability: boolean }[],
): { assets: Satang; liabilities: Satang; netWorth: Satang } {
  let assets = 0;
  let liabilities = 0;

  for (const account of accounts) {
    const balance = latestBalances.get(account.id) ?? 0;
    if (account.isLiability) liabilities += balance;
    else assets += balance;
  }

  // Liabilities are stored negative, so a plain sum is the net worth. The
  // reported liability figure is flipped to a positive magnitude for display,
  // which is how people read "you owe ฿18,600".
  return { assets, liabilities: Math.abs(liabilities), netWorth: assets + liabilities };
}

/**
 * The newest snapshot per account, which is the account's current balance.
 *
 * An account with no snapshots falls back to its opening balance, so a
 * freshly-created account reports its opening figure rather than nothing.
 */
export function latestBalances(
  snapshots: readonly RecalculatedSnapshot[],
  accounts: readonly { id: number; openingBalanceSatang: Satang }[],
): Map<number, Satang> {
  const latest = new Map<number, Satang>(
    accounts.map((account) => [account.id, account.openingBalanceSatang]),
  );
  const newestAt = new Map<number, string>();

  for (const snapshot of snapshots) {
    const previous = newestAt.get(snapshot.accountId);
    if (previous === undefined || snapshot.effectiveAt > previous) {
      newestAt.set(snapshot.accountId, snapshot.effectiveAt);
      latest.set(snapshot.accountId, snapshot.balanceSatang);
    }
  }

  return latest;
}

/** The `YYYY-MM` of the newest snapshot across all accounts, or `null`. */
export function latestActivityMonth(snapshots: readonly RecalculatedSnapshot[]): string | null {
  let newest: string | null = null;
  for (const snapshot of snapshots) {
    if (!newest || snapshot.effectiveAt > newest) newest = snapshot.effectiveAt;
  }
  return newest ? bangkokDateKey(newest).slice(0, 7) : null;
}

/**
 * Spending per category for a window, keyed by category id.
 *
 * Budget progress needs the same figure `aggregatePeriod` computes, but indexed
 * rather than as a sorted list, so the two do not drift apart.
 */
export function spendingByCategory(
  summary: CashflowSummary,
): Map<number, Satang> {
  return new Map(summary.byCategoryExpense.map((rollup) => [rollup.id, rollup.amountSatang]));
}
