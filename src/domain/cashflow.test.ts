import { describe, expect, it } from 'vitest';
import {
  aggregatePeriod,
  buildBalanceSeries,
  compareWithPrevious,
  enumerateDays,
  latestBalances,
  latestActivityMonth,
  spendingByCategory,
  splitAssetsAndLiabilities,
  type CashflowInput,
  type TransactionLike,
} from './cashflow';
import { recalculateAll, recalculateDeltas, type SnapshotLike } from './snapshots';

const range = { start: '2026-10-01', end: '2026-10-31' };

const categories = [
  { id: 1, name: 'เงินเดือน', kind: 'income' as const },
  { id: 2, name: 'อาหาร', kind: 'expense' as const },
  { id: 3, name: 'เดินทาง', kind: 'expense' as const },
];

const accounts = [
  { id: 1, name: 'ออมทรัพย์' },
  { id: 2, name: 'เงินสด' },
];

function transaction(overrides: Partial<TransactionLike> & { id: number }): TransactionLike {
  return {
    accountId: 1,
    kind: 'expense',
    amountSatang: -10_000,
    categoryId: null,
    occurredAt: '2026-10-05T03:00:00Z',
    note: null,
    linkedSnapshotId: null,
    ...overrides,
  };
}

function snapshot(
  id: number,
  balanceSatang: number,
  effectiveAt: string,
  updateType: SnapshotLike['updateType'],
  categoryId: number | null = null,
  accountId = 1,
): SnapshotLike {
  return { id, accountId, balanceSatang, effectiveAt, updateType, categoryId, note: null };
}

function build(overrides: Partial<CashflowInput> = {}): CashflowInput {
  return {
    transactions: [],
    snapshots: [],
    range,
    categories,
    accounts,
    ...overrides,
  };
}

describe('aggregatePeriod — transactions', () => {
  it('sums income and expense separately, with expense staying negative', () => {
    const summary = aggregatePeriod(
      build({
        transactions: [
          transaction({ id: 1, kind: 'income', amountSatang: 3_000_000, categoryId: 1 }),
          transaction({ id: 2, kind: 'expense', amountSatang: -250_000, categoryId: 2 }),
          transaction({ id: 3, kind: 'expense', amountSatang: -100_000, categoryId: 3 }),
        ],
      }),
    );

    expect(summary.income).toBe(3_000_000);
    expect(summary.expense).toBe(-350_000);
    expect(summary.net).toBe(2_650_000);
    expect(summary.transactionCount).toBe(3);
  });

  it('excludes transactions outside the window', () => {
    const summary = aggregatePeriod(
      build({
        transactions: [
          transaction({ id: 1, occurredAt: '2026-09-30T03:00:00Z' }),
          transaction({ id: 2, occurredAt: '2026-11-01T03:00:00Z' }),
          transaction({ id: 3, occurredAt: '2026-10-15T03:00:00Z' }),
        ],
      }),
    );

    expect(summary.transactionCount).toBe(1);
  });

  it('buckets by Bangkok day at a month boundary', () => {
    // 2026-10-31T18:30:00Z is 1 November in Bangkok, so it belongs to November.
    const october = aggregatePeriod(
      build({ transactions: [transaction({ id: 1, occurredAt: '2026-10-31T18:30:00Z' })] }),
    );
    const november = aggregatePeriod(
      build({
        range: { start: '2026-11-01', end: '2026-11-30' },
        transactions: [transaction({ id: 1, occurredAt: '2026-10-31T18:30:00Z' })],
      }),
    );

    expect(october.transactionCount).toBe(0);
    expect(november.transactionCount).toBe(1);
  });

  it('keeps transfers out of income and expense', () => {
    const summary = aggregatePeriod(
      build({
        transactions: [
          transaction({ id: 1, kind: 'transfer_out', amountSatang: -500_000, accountId: 1 }),
          transaction({ id: 2, kind: 'transfer_in', amountSatang: 500_000, accountId: 2 }),
        ],
      }),
    );

    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(0);
    expect(summary.net).toBe(0);
    expect(summary.transfersOut).toBe(-500_000);
    expect(summary.transfersIn).toBe(500_000);
  });

  it('reports adjustments on their own line', () => {
    const summary = aggregatePeriod(
      build({ transactions: [transaction({ id: 1, kind: 'adjustment', amountSatang: 75_000 })] }),
    );

    expect(summary.adjustments).toBe(75_000);
    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(0);
  });

  it('rolls expenses up by category, largest first', () => {
    const summary = aggregatePeriod(
      build({
        transactions: [
          transaction({ id: 1, amountSatang: -250_000, categoryId: 2 }),
          transaction({ id: 2, amountSatang: -100_000, categoryId: 3 }),
          transaction({ id: 3, amountSatang: -50_000, categoryId: 2 }),
        ],
      }),
    );

    expect(summary.byCategoryExpense).toEqual([
      { id: 2, name: 'อาหาร', amountSatang: 300_000, share: 0.75 },
      { id: 3, name: 'เดินทาง', amountSatang: 100_000, share: 0.25 },
    ]);
  });

  it('leaves an uncategorised expense out of the category roll-up but in the total', () => {
    const summary = aggregatePeriod(
      build({ transactions: [transaction({ id: 1, amountSatang: -90_000, categoryId: null })] }),
    );

    expect(summary.expense).toBe(-90_000);
    expect(summary.byCategoryExpense).toEqual([]);
  });

  it('nets the account roll-up, so a transfer cancels across accounts', () => {
    const summary = aggregatePeriod(
      build({
        transactions: [
          transaction({ id: 1, kind: 'transfer_out', amountSatang: -500_000, accountId: 1 }),
          transaction({ id: 2, kind: 'transfer_in', amountSatang: 500_000, accountId: 2 }),
        ],
      }),
    );

    expect(summary.byAccount.find((row) => row.id === 1)?.amountSatang).toBe(-500_000);
    expect(summary.byAccount.find((row) => row.id === 2)?.amountSatang).toBe(500_000);
  });
});

describe('aggregatePeriod — the double-counting rule', () => {
  it('counts a classified delta with no linked transaction', () => {
    // Decision: a classified delta the user never linked to a transaction is
    // real money movement, so it counts.
    const snapshots = recalculateDeltas(
      [snapshot(1, 400_000, '2026-10-10T03:00:00Z', 'income', 1)],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(build({ snapshots }));

    expect(summary.income).toBe(100_000);
    expect(summary.deltaIncome).toBe(100_000);
  });

  it('counts a classified expense delta the same way', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 250_000, '2026-10-10T03:00:00Z', 'expense', 2)],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(build({ snapshots }));

    expect(summary.expense).toBe(-50_000);
    expect(summary.deltaExpense).toBe(-50_000);
    expect(summary.byCategoryExpense[0]?.amountSatang).toBe(50_000);
  });

  it('excludes a delta a transaction explicitly links to, counting it exactly once', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 250_000, '2026-10-10T03:00:00Z', 'expense', 2)],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(
      build({
        snapshots,
        transactions: [
          transaction({
            id: 1,
            amountSatang: -50_000,
            categoryId: 2,
            occurredAt: '2026-10-10T03:00:00Z',
            linkedSnapshotId: 1,
          }),
        ],
      }),
    );

    // -50,000 once, not -100,000.
    expect(summary.expense).toBe(-50_000);
    expect(summary.deltaExpense).toBe(0);
    expect(summary.transactionCount).toBe(1);
  });

  it('puts an unclassified delta in its own bucket, outside income and expense', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 180_000, '2026-10-10T03:00:00Z', 'unknown')],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(build({ snapshots }));

    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(0);
    expect(summary.unclassified).toBe(-120_000);
    expect(summary.unclassifiedCount).toBe(1);
  });

  it('keeps transfer deltas out of income and expense', () => {
    const snapshots = recalculateDeltas(
      [
        snapshot(1, 200_000, '2026-10-10T03:00:00Z', 'transfer_out', null, 1),
        snapshot(2, 200_000, '2026-10-10T03:00:00Z', 'transfer_in', null, 2),
      ],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(build({ snapshots }));

    expect(summary.income).toBe(0);
    expect(summary.expense).toBe(0);
    expect(summary.transfersOut).toBe(-100_000);
  });

  it('counts an adjustment delta on its own line', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 320_000, '2026-10-10T03:00:00Z', 'adjustment')],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(build({ snapshots }));

    expect(summary.adjustments).toBe(20_000);
    expect(summary.income).toBe(0);
  });

  it('warns when an unlinked classified delta shares a Bangkok day with a transaction', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 250_000, '2026-10-10T03:00:00Z', 'expense', 2)],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(
      build({
        snapshots,
        transactions: [
          transaction({ id: 1, amountSatang: -50_000, categoryId: 2, occurredAt: '2026-10-10T09:00:00Z' }),
        ],
      }),
    );

    expect(summary.warnings).toEqual([
      { kind: 'possible_double_count', snapshotIds: [1] },
    ]);
    // Advisory only: nothing was dropped.
    expect(summary.expense).toBe(-100_000);
  });

  it('does not warn when the linked transaction already explains the delta', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 250_000, '2026-10-10T03:00:00Z', 'expense', 2)],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(
      build({
        snapshots,
        transactions: [
          transaction({
            id: 1,
            amountSatang: -50_000,
            categoryId: 2,
            occurredAt: '2026-10-10T03:00:00Z',
            linkedSnapshotId: 1,
          }),
        ],
      }),
    );

    expect(summary.warnings).toEqual([]);
  });

  it('does not warn for a delta on a day with no transaction', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 250_000, '2026-10-10T03:00:00Z', 'expense', 2)],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    expect(aggregatePeriod(build({ snapshots })).warnings).toEqual([]);
  });
});

describe('aggregatePeriod — a mixed period', () => {
  it('combines transactions and unlinked deltas without losing either', () => {
    const snapshots = recalculateDeltas(
      [
        snapshot(1, 400_000, '2026-10-02T03:00:00Z', 'income', 1),
        snapshot(2, 350_000, '2026-10-20T03:00:00Z', 'expense', 2),
        snapshot(3, 340_000, '2026-10-25T03:00:00Z', 'unknown'),
      ],
      { id: 1, openingBalanceSatang: 300_000, openingDate: '2026-01-01' },
    );

    const summary = aggregatePeriod(
      build({
        snapshots,
        transactions: [
          transaction({ id: 1, kind: 'income', amountSatang: 500_000, categoryId: 1, occurredAt: '2026-10-05T03:00:00Z' }),
          transaction({ id: 2, amountSatang: -120_000, categoryId: 3, occurredAt: '2026-10-06T03:00:00Z' }),
        ],
      }),
    );

    expect(summary.income).toBe(600_000); // 500,000 transaction + 100,000 delta
    expect(summary.expense).toBe(-170_000); // -120,000 transaction + -50,000 delta
    expect(summary.net).toBe(430_000);
    expect(summary.unclassified).toBe(-10_000);
    expect(summary.transactionCount).toBe(2);
  });
});

describe('compareWithPrevious', () => {
  it('reports the change against the prior window', () => {
    const input = {
      transactions: [
        transaction({ id: 1, kind: 'income', amountSatang: 3_000_000, occurredAt: '2026-10-05T03:00:00Z' }),
        transaction({ id: 2, kind: 'income', amountSatang: 2_000_000, occurredAt: '2026-09-05T03:00:00Z' }),
        transaction({ id: 3, amountSatang: -400_000, occurredAt: '2026-10-06T03:00:00Z' }),
        transaction({ id: 4, amountSatang: -300_000, occurredAt: '2026-09-06T03:00:00Z' }),
      ],
      snapshots: [],
      categories,
      accounts,
    };

    const comparison = compareWithPrevious(input, range, { start: '2026-09-01', end: '2026-09-30' });

    expect(comparison.current.income).toBe(3_000_000);
    expect(comparison.previous.income).toBe(2_000_000);
    expect(comparison.incomeChange).toBe(1_000_000);
    expect(comparison.expenseChange).toBe(-100_000);
    expect(comparison.netChange).toBe(900_000);
  });
});

const openingAccounts = [
  { id: 1, openingBalanceSatang: 100_000, openingDate: '2026-01-01' },
  { id: 2, openingBalanceSatang: 50_000, openingDate: '2026-01-01' },
];

describe('buildBalanceSeries', () => {
  it('forward-fills each account, so the total does not collapse on quiet days', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 150_000, '2026-10-03T03:00:00Z', 'income', null, 1)],
      openingAccounts[0]!,
    );

    const series = buildBalanceSeries({
      snapshots,
      accounts: openingAccounts,
      range: { start: '2026-10-01', end: '2026-10-05' },
    });

    expect(series.map((point) => point.dateKey)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);

    // Account 1: 100,000 → 100,000 → 150,000 → 150,000 → 150,000
    // Account 2 stays at its opening 50,000 throughout.
    expect(series.map((point) => point.balanceSatang)).toEqual([
      150_000, 150_000, 200_000, 200_000, 200_000,
    ]);
  });

  it('applies a snapshot dated on or before the first day immediately', () => {
    const snapshots = recalculateDeltas(
      [snapshot(1, 999_000, '2026-09-01T03:00:00Z', 'income', null, 1)],
      openingAccounts[0]!,
    );

    const series = buildBalanceSeries({
      snapshots,
      accounts: openingAccounts,
      range: { start: '2026-10-01', end: '2026-10-02' },
    });

    expect(series[0]?.balanceSatang).toBe(1_049_000);
  });

  it('carries each account separately', () => {
    const series = buildBalanceSeries({
      snapshots: [],
      accounts: openingAccounts,
      range: { start: '2026-10-01', end: '2026-10-01' },
    });

    expect(series[0]?.byAccount.get(1)).toBe(100_000);
    expect(series[0]?.byAccount.get(2)).toBe(50_000);
  });

  it('returns nothing for a reversed range', () => {
    expect(
      buildBalanceSeries({
        snapshots: [],
        accounts: openingAccounts,
        range: { start: '2026-10-05', end: '2026-10-01' },
      }),
    ).toEqual([]);
  });
});

describe('enumerateDays', () => {
  it('lists every day inclusively', () => {
    expect(enumerateDays({ start: '2026-10-30', end: '2026-11-02' })).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('returns a single day for a one-day range', () => {
    expect(enumerateDays({ start: '2026-10-16', end: '2026-10-16' })).toEqual(['2026-10-16']);
  });
});

describe('splitAssetsAndLiabilities', () => {
  it('sums liabilities as a positive magnitude for display', () => {
    const balances = new Map([
      [1, 4_250_000],
      [2, 350_000],
      [3, -1_860_000],
    ]);
    const accountsWithType = [
      { id: 1, isLiability: false },
      { id: 2, isLiability: false },
      { id: 3, isLiability: true },
    ];

    const split = splitAssetsAndLiabilities(balances, accountsWithType);

    expect(split.assets).toBe(4_600_000);
    expect(split.liabilities).toBe(1_860_000);
    expect(split.netWorth).toBe(2_740_000);
  });

  it('uses one formula regardless of account type', () => {
    // netWorth is assets + the raw (negative) liability, with no branching.
    const balances = new Map([
      [1, 100_000],
      [2, -100_000],
    ]);
    const split = splitAssetsAndLiabilities(balances, [
      { id: 1, isLiability: false },
      { id: 2, isLiability: true },
    ]);

    expect(split.netWorth).toBe(0);
  });

  it('handles an account with no balance recorded', () => {
    const split = splitAssetsAndLiabilities(new Map(), [{ id: 1, isLiability: false }]);

    expect(split.assets).toBe(0);
    expect(split.netWorth).toBe(0);
  });
});

describe('latestBalances', () => {
  it('takes the newest snapshot per account', () => {
    const snapshots = recalculateAll(
      [
        snapshot(1, 150_000, '2026-10-01T03:00:00Z', 'income', null, 1),
        snapshot(2, 180_000, '2026-10-05T03:00:00Z', 'income', null, 1),
        snapshot(3, 60_000, '2026-10-03T03:00:00Z', 'income', null, 2),
      ],
      openingAccounts,
    );

    const latest = latestBalances(snapshots, openingAccounts);

    expect(latest.get(1)).toBe(180_000);
    expect(latest.get(2)).toBe(60_000);
  });

  it('falls back to the opening balance for an account with no snapshots', () => {
    const latest = latestBalances([], openingAccounts);

    expect(latest.get(1)).toBe(100_000);
    expect(latest.get(2)).toBe(50_000);
  });
});

describe('latestActivityMonth', () => {
  it('reports the Bangkok month of the newest snapshot', () => {
    const snapshots = recalculateDeltas(
      [
        snapshot(1, 150_000, '2026-10-31T18:30:00Z', 'income'),
        snapshot(2, 150_000, '2026-09-01T03:00:00Z', 'income'),
      ],
      { id: 1, openingBalanceSatang: 100_000, openingDate: '2026-01-01' },
    );

    expect(latestActivityMonth(snapshots)).toBe('2026-11');
  });

  it('returns null with no history', () => {
    expect(latestActivityMonth([])).toBeNull();
  });
});

describe('spendingByCategory', () => {
  it('indexes the expense roll-up by category id', () => {
    const summary = aggregatePeriod(
      build({
        transactions: [
          transaction({ id: 1, amountSatang: -250_000, categoryId: 2 }),
          transaction({ id: 2, amountSatang: -100_000, categoryId: 3 }),
        ],
      }),
    );

    const indexed = spendingByCategory(summary);

    expect(indexed.get(2)).toBe(250_000);
    expect(indexed.get(3)).toBe(100_000);
    expect(indexed.get(1)).toBeUndefined();
  });
});
