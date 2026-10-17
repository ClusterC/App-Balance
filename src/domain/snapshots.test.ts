import { describe, expect, it } from 'vitest';
import {
  compareChronologically,
  compareNewestFirst,
  deleteSnapshot,
  doubleCountCandidates,
  duplicateTimestamps,
  editSnapshot,
  groupByAccount,
  insertSnapshot,
  latestSnapshot,
  recalculateAll,
  recalculateDeltas,
  snapshotsBeforeOpening,
  totalDelta,
  type AccountOpening,
  type RecalculatedSnapshot,
  type SnapshotLike,
} from './snapshots';

const opening: AccountOpening = {
  id: 1,
  openingBalanceSatang: 100_000,
  openingDate: '2026-01-01',
};

function snapshot(
  id: number,
  balanceSatang: number,
  effectiveAt: string,
  updateType: SnapshotLike['updateType'] = 'income',
  accountId = 1,
): SnapshotLike {
  return { id, accountId, balanceSatang, effectiveAt, updateType, categoryId: null, note: null };
}

function deltas(rows: readonly RecalculatedSnapshot[]): number[] {
  return rows.map((row) => row.derivedDeltaSatang);
}

describe('recalculateDeltas', () => {
  it('measures the first delta against the opening balance', () => {
    const result = recalculateDeltas([snapshot(1, 150_000, '2026-02-01T00:00:00Z')], opening);

    expect(result).toHaveLength(1);
    expect(result[0]?.derivedDeltaSatang).toBe(50_000);
    expect(result[0]?.prevSnapshotId).toBeNull();
  });

  it('chains later deltas off the immediately preceding snapshot', () => {
    const result = recalculateDeltas(
      [
        snapshot(1, 150_000, '2026-02-01T00:00:00Z'),
        snapshot(2, 130_000, '2026-03-01T00:00:00Z'),
        snapshot(3, 180_000, '2026-04-01T00:00:00Z'),
      ],
      opening,
    );

    expect(deltas(result)).toEqual([50_000, -20_000, 50_000]);
    expect(result.map((row) => row.prevSnapshotId)).toEqual([null, 1, 2]);
  });

  it('sorts chronologically regardless of input order', () => {
    const shuffled = [
      snapshot(3, 180_000, '2026-04-01T00:00:00Z'),
      snapshot(1, 150_000, '2026-02-01T00:00:00Z'),
      snapshot(2, 130_000, '2026-03-01T00:00:00Z'),
    ];

    const result = recalculateDeltas(shuffled, opening);

    expect(result.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(deltas(result)).toEqual([50_000, -20_000, 50_000]);
  });

  it('does not mutate its input', () => {
    const rows = [snapshot(1, 150_000, '2026-02-01T00:00:00Z')];
    const before = structuredClone(rows);

    recalculateDeltas(rows, opening);

    expect(rows).toEqual(before);
  });

  it('handles an empty timeline', () => {
    expect(recalculateDeltas([], opening)).toEqual([]);
  });

  it('produces a zero delta when the balance is unchanged', () => {
    const result = recalculateDeltas(
      [
        snapshot(1, 150_000, '2026-02-01T00:00:00Z'),
        snapshot(2, 150_000, '2026-03-01T00:00:00Z'),
      ],
      opening,
    );

    expect(result[1]?.derivedDeltaSatang).toBe(0);
  });

  it('handles negative balances, as a credit card has', () => {
    const card: AccountOpening = { id: 2, openingBalanceSatang: -500_000, openingDate: '2026-01-01' };
    const result = recalculateDeltas(
      [
        snapshot(1, -1_200_000, '2026-02-01T00:00:00Z', 'expense', 2),
        snapshot(2, -300_000, '2026-03-01T00:00:00Z', 'income', 2),
      ],
      card,
    );

    expect(deltas(result)).toEqual([-700_000, 900_000]);
  });

  it('marks only `unknown` as unclassified', () => {
    const result = recalculateDeltas(
      [
        snapshot(1, 110_000, '2026-02-01T00:00:00Z', 'income'),
        snapshot(2, 120_000, '2026-03-01T00:00:00Z', 'unknown'),
        snapshot(3, 130_000, '2026-04-01T00:00:00Z', 'adjustment'),
      ],
      opening,
    );

    expect(result.map((row) => row.isClassified)).toEqual([true, false, true]);
  });

  it('still computes a delta for an unclassified row', () => {
    const result = recalculateDeltas([snapshot(1, 175_000, '2026-02-01T00:00:00Z', 'unknown')], opening);

    expect(result[0]?.derivedDeltaSatang).toBe(75_000);
    expect(result[0]?.isClassified).toBe(false);
  });
});

describe('chronological recalc on mutation', () => {
  const timeline = [
    snapshot(1, 150_000, '2026-02-01T00:00:00Z'),
    snapshot(3, 180_000, '2026-04-01T00:00:00Z'),
  ];

  it('inserting a past snapshot shifts every later delta', () => {
    const before = recalculateDeltas(timeline, opening);
    expect(before[1]?.derivedDeltaSatang).toBe(30_000);

    const after = insertSnapshot(
      timeline,
      snapshot(2, 130_000, '2026-03-01T00:00:00Z'),
      opening,
    );

    expect(after.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(deltas(after)).toEqual([50_000, -20_000, 50_000]);
    // The delta that used to span Feb–Apr is now split at March.
    expect(after[2]?.prevSnapshotId).toBe(2);
  });

  it('inserting a snapshot before the first one re-seeds the chain', () => {
    const after = insertSnapshot(
      timeline,
      snapshot(0, 120_000, '2026-01-15T00:00:00Z'),
      opening,
    );

    // The old first delta was 50,000 against the opening; now the opening only
    // reaches the new row, and the old first row measures against it.
    expect(deltas(after)).toEqual([20_000, 30_000, 30_000]);
  });

  it('editing a balance shifts its own delta and the next one', () => {
    const after = editSnapshot(timeline, 1, { balanceSatang: 160_000 }, opening);

    expect(deltas(after)).toEqual([60_000, 20_000]);
  });

  it('editing a timestamp reorders the chain', () => {
    const after = editSnapshot(timeline, 1, { effectiveAt: '2026-05-01T00:00:00Z' }, opening);

    expect(after.map((row) => row.id)).toEqual([3, 1]);
    expect(deltas(after)).toEqual([80_000, -30_000]);
  });

  it('deleting a middle snapshot relinks its neighbours', () => {
    const three = recalculateDeltas(
      [
        snapshot(1, 150_000, '2026-02-01T00:00:00Z'),
        snapshot(2, 130_000, '2026-03-01T00:00:00Z'),
        snapshot(3, 180_000, '2026-04-01T00:00:00Z'),
      ],
      opening,
    );
    expect(deltas(three)).toEqual([50_000, -20_000, 50_000]);

    const after = deleteSnapshot(
      [
        snapshot(1, 150_000, '2026-02-01T00:00:00Z'),
        snapshot(2, 130_000, '2026-03-01T00:00:00Z'),
        snapshot(3, 180_000, '2026-04-01T00:00:00Z'),
      ],
      2,
      opening,
    );

    // The removed -20,000 is absorbed: April now measures against February.
    expect(deltas(after)).toEqual([50_000, 30_000]);
    expect(after[1]?.prevSnapshotId).toBe(1);
  });

  it('deleting the first snapshot re-seeds from the opening balance', () => {
    const after = deleteSnapshot(timeline, 1, opening);

    expect(deltas(after)).toEqual([80_000]);
    expect(after[0]?.prevSnapshotId).toBeNull();
  });

  it('deleting the last snapshot leaves the rest untouched', () => {
    const after = deleteSnapshot(timeline, 3, opening);

    expect(deltas(after)).toEqual([50_000]);
  });

  it('deleting everything leaves an empty chain', () => {
    expect(deleteSnapshot(timeline, 1, opening)).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('orders chronologically, oldest first', () => {
    const rows = [
      snapshot(1, 0, '2026-03-01T00:00:00Z'),
      snapshot(2, 0, '2026-01-01T00:00:00Z'),
    ];
    expect([...rows].sort(compareChronologically).map((row) => row.id)).toEqual([2, 1]);
  });

  it('breaks a timestamp tie by id, so the result never depends on input order', () => {
    const a = snapshot(2, 0, '2026-01-01T00:00:00Z');
    const b = snapshot(1, 0, '2026-01-01T00:00:00Z');
    expect([a, b].sort(compareChronologically).map((row) => row.id)).toEqual([1, 2]);
    expect([b, a].sort(compareChronologically).map((row) => row.id)).toEqual([1, 2]);
  });

  it('orders newest first for display', () => {
    const rows = [
      snapshot(1, 0, '2026-01-01T00:00:00Z'),
      snapshot(2, 0, '2026-03-01T00:00:00Z'),
    ];
    expect([...rows].sort(compareNewestFirst).map((row) => row.id)).toEqual([2, 1]);
  });
});

describe('recalculateAll', () => {
  it('recalculates several accounts independently', () => {
    const accounts: AccountOpening[] = [
      { id: 1, openingBalanceSatang: 100_000, openingDate: '2026-01-01' },
      { id: 2, openingBalanceSatang: 0, openingDate: '2026-01-01' },
    ];
    const rows = [
      snapshot(1, 150_000, '2026-02-01T00:00:00Z', 'income', 1),
      snapshot(2, 30_000, '2026-02-01T00:00:00Z', 'income', 2),
      snapshot(3, 130_000, '2026-03-01T00:00:00Z', 'expense', 1),
    ];

    const result = recalculateAll(rows, accounts);

    expect(deltas(result)).toEqual([50_000, 30_000, -20_000]);
    expect(result.map((row) => row.accountId)).toEqual([1, 2, 1]);
  });

  it('skips snapshots whose account is unknown', () => {
    const result = recalculateAll(
      [snapshot(1, 150_000, '2026-02-01T00:00:00Z', 'income', 99)],
      [opening],
    );

    expect(result).toEqual([]);
  });
});

describe('groupByAccount', () => {
  it('buckets rows by account', () => {
    const grouped = groupByAccount([
      { accountId: 1, id: 1 },
      { accountId: 2, id: 2 },
      { accountId: 1, id: 3 },
    ]);

    expect(grouped.get(1)?.map((row) => row.id)).toEqual([1, 3]);
    expect(grouped.get(2)?.map((row) => row.id)).toEqual([2]);
  });

  it('returns an empty map for no rows', () => {
    expect(groupByAccount([]).size).toBe(0);
  });
});

describe('derived views', () => {
  it('finds the newest snapshot', () => {
    const rows = [
      snapshot(1, 0, '2026-01-01T00:00:00Z'),
      snapshot(2, 0, '2026-03-01T00:00:00Z'),
      snapshot(3, 0, '2026-02-01T00:00:00Z'),
    ];

    expect(latestSnapshot(rows)?.id).toBe(2);
    expect(latestSnapshot([])).toBeNull();
  });

  it('totals the deltas', () => {
    const rows = recalculateDeltas(
      [
        snapshot(1, 150_000, '2026-02-01T00:00:00Z'),
        snapshot(2, 130_000, '2026-03-01T00:00:00Z'),
      ],
      opening,
    );

    // The deltas sum to the net movement from the opening balance.
    expect(totalDelta(rows)).toBe(30_000);
  });

  it('finds snapshots dated before the opening date', () => {
    const rows = [
      snapshot(1, 0, '2025-12-01T00:00:00Z'),
      snapshot(2, 0, '2026-02-01T00:00:00Z'),
    ];

    expect(snapshotsBeforeOpening(rows, opening).map((row) => row.id)).toEqual([1]);
  });

  it('uses the Bangkok day when comparing against the opening date', () => {
    // 2026-01-01T00:00:00Z is 07:00 Bangkok on the 1st, so it is not before.
    // 2025-12-31T18:00:00Z is 01:00 Bangkok on the 1st — also not before.
    const rows = [
      snapshot(1, 0, '2026-01-01T00:00:00Z'),
      snapshot(2, 0, '2025-12-31T18:00:00Z'),
      snapshot(3, 0, '2025-12-31T16:00:00Z'),
    ];

    expect(snapshotsBeforeOpening(rows, opening).map((row) => row.id)).toEqual([3]);
  });

  it('detects duplicate timestamps', () => {
    const rows = [
      snapshot(1, 0, '2026-01-01T00:00:00Z'),
      snapshot(2, 0, '2026-01-01T00:00:00Z'),
      snapshot(3, 0, '2026-02-01T00:00:00Z'),
    ];

    const duplicates = duplicateTimestamps(rows);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.map((row) => row.id)).toEqual([1, 2]);
  });

  it('reports no duplicates for a clean timeline', () => {
    expect(
      duplicateTimestamps([
        snapshot(1, 0, '2026-01-01T00:00:00Z'),
        snapshot(2, 0, '2026-02-01T00:00:00Z'),
      ]),
    ).toEqual([]);
  });
});

describe('doubleCountCandidates', () => {
  const rows = recalculateDeltas(
    [
      snapshot(1, 150_000, '2026-02-01T00:00:00Z', 'income'),
      snapshot(2, 130_000, '2026-03-01T00:00:00Z', 'expense'),
      snapshot(3, 120_000, '2026-04-01T00:00:00Z', 'unknown'),
    ],
    opening,
  );

  it('flags an unlinked classified delta on a day that also has transactions', () => {
    const dates = new Map([[1, new Set(['2026-02-01'])]]);
    const flagged = doubleCountCandidates(rows, dates, new Set());

    expect(flagged.map((row) => row.id)).toEqual([1]);
  });

  it('never flags a delta that a transaction links to', () => {
    const dates = new Map([[1, new Set(['2026-02-01'])]]);
    const flagged = doubleCountCandidates(rows, dates, new Set([1]));

    expect(flagged).toEqual([]);
  });

  it('never flags an unclassified delta', () => {
    const dates = new Map([[1, new Set(['2026-04-01'])]]);
    const flagged = doubleCountCandidates(rows, dates, new Set());

    expect(flagged).toEqual([]);
  });

  it('does not flag a delta on a day with no transactions', () => {
    const dates = new Map([[1, new Set(['2026-09-09'])]]);
    expect(doubleCountCandidates(rows, dates, new Set())).toEqual([]);
  });

  it('does not flag anything for an account with no transactions at all', () => {
    expect(doubleCountCandidates(rows, new Map(), new Set())).toEqual([]);
  });

  it('compares Bangkok days, not UTC days', () => {
    // The snapshot is 2026-02-01T00:00:00Z → 07:00 Bangkok on the 1st.
    // A transaction at 2026-01-31T18:00:00Z → 01:00 Bangkok on the 1st: the
    // same local day, so it must be flagged even though the UTC dates differ.
    const dates = new Map([[1, new Set(['2026-02-01'])]]);
    const flagged = doubleCountCandidates(rows, dates, new Set());

    expect(flagged).toHaveLength(1);
  });
});
