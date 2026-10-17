import { describe, expect, it } from 'vitest';
import {
  HORIZONS,
  MIN_PERIODS,
  MIN_PERIODS_FOR_BAND,
  MIN_PERIODS_FOR_TREND,
  bucketKey,
  expenseObservations,
  forecastExpenses,
  horizonPlan,
  linearRegression,
  median,
  modifiedZScores,
  standardDeviation,
  weightedMovingAverage,
  type Observation,
} from './forecast';

const horizon7d = HORIZONS.find((h) => h.kind === '7d')!;
const horizon30d = HORIZONS.find((h) => h.kind === '30d')!;
const horizon3mo = HORIZONS.find((h) => h.kind === '3mo')!;

/** Weekly observations starting 2026-01-05 (a Monday), one per week. */
function weekly(amounts: readonly number[], startKey = '2026-01-05'): Observation[] {
  const start = Date.parse(`${startKey}T00:00:00Z`);
  return amounts.map((amountSatang, index) => ({
    dateKey: new Date(start + index * 7 * 86_400_000).toISOString().slice(0, 10),
    amountSatang,
  }));
}

/** Observations on the 15th of consecutive months, for the monthly horizons. */
function monthly(amounts: readonly number[], startYear = 2026, startMonth = 0): Observation[] {
  return amounts.map((amountSatang, index) => ({
    dateKey: new Date(Date.UTC(startYear, startMonth + index, 15)).toISOString().slice(0, 10),
    amountSatang,
  }));
}

describe('statistics helpers', () => {
  it('computes the median for odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('computes the weighted moving average with linear decay', () => {
    // Weights 1,2,3 over values 10,20,30 → (10 + 40 + 90) / 6 = 23.333…
    expect(weightedMovingAverage([10, 20, 30])).toBeCloseTo(23.333, 3);
    expect(weightedMovingAverage([100])).toBe(100);
    expect(weightedMovingAverage([])).toBe(0);
  });

  it('weights the newest value most heavily', () => {
    const rising = weightedMovingAverage([10, 10, 100]);
    const falling = weightedMovingAverage([100, 10, 10]);

    expect(rising).toBeGreaterThan(falling);
  });

  it('computes the sample standard deviation', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(standardDeviation([5])).toBe(0);
    expect(standardDeviation([])).toBe(0);
  });

  it('fits a least-squares line', () => {
    const fit = linearRegression([0, 10, 20, 30]);

    expect(fit.slope).toBeCloseTo(10, 6);
    expect(fit.intercept).toBeCloseTo(0, 6);
    expect(fit.rSquared).toBeCloseTo(1, 6);
  });

  it('reports no slope for a flat series', () => {
    const fit = linearRegression([50, 50, 50, 50]);

    expect(fit.slope).toBeCloseTo(0, 6);
    // A constant series has no variance to explain, so the fit is exact.
    expect(fit.rSquared).toBe(1);
  });

  it('reports a low R² for a series with no trend', () => {
    const fit = linearRegression([10, 90, 10, 90, 10, 90]);

    expect(Math.abs(fit.slope)).toBeLessThan(10);
    expect(fit.rSquared).toBeLessThan(0.5);
  });

  it('fits a single value without dividing by zero', () => {
    const fit = linearRegression([42]);

    expect(fit.slope).toBe(0);
    expect(fit.intercept).toBe(42);
  });
});

describe('modifiedZScores', () => {
  it('flags a single extreme value', () => {
    const scores = modifiedZScores([100, 100, 100, 100, 100, 100, 100, 10_000]);

    expect(scores[7]).toBeGreaterThan(3.5);
    for (let i = 0; i < 7; i += 1) {
      expect(scores[i]).toBeLessThan(3.5);
    }
  });

  it('is not fooled by the outlier it is looking for', () => {
    // Mean/σ would let 10,000 inflate σ enough to hide itself; median/MAD does
    // not move at all.
    const scores = modifiedZScores([100, 100, 100, 100, 100, 100, 100, 10_000]);
    expect(scores[7]).toBeGreaterThan(3.5);
  });

  it('falls back when MAD is zero, so a run of equal values still yields scores', () => {
    // Seven identical values and one different: MAD is 0.
    const scores = modifiedZScores([100, 100, 100, 100, 100, 100, 100, 500]);

    expect(scores[7]).toBeGreaterThan(3.5);
    expect(scores.every((score) => Number.isFinite(score))).toBe(true);
  });

  it('returns all zeros for a perfectly constant series', () => {
    expect(modifiedZScores([7, 7, 7, 7])).toEqual([0, 0, 0, 0]);
  });

  it('returns an empty list for no values', () => {
    expect(modifiedZScores([])).toEqual([]);
  });
});

describe('bucketKey and horizonPlan', () => {
  it('buckets by month or by week start', () => {
    expect(bucketKey('2026-10-16', 'month')).toBe('2026-10');
    expect(bucketKey('2026-10-16', 'week')).toBe('2026-10-12');
  });

  it('maps a 7-day horizon to one weekly period', () => {
    expect(horizonPlan(horizon7d)).toEqual({ grain: 'week', periods: 1 });
  });

  it('maps a 30-day horizon to fractional weekly periods', () => {
    // 30/7 rather than 4: rounding to 4 would under-report by a day's spending.
    expect(horizonPlan(horizon30d).grain).toBe('week');
    expect(horizonPlan(horizon30d).periods).toBeCloseTo(4.2857, 3);
  });

  it('maps a 3-month horizon to monthly periods', () => {
    expect(horizonPlan(horizon3mo)).toEqual({ grain: 'month', periods: 3 });
  });
});

describe('forecastExpenses — insufficient data', () => {
  it('reports no_data for an empty history', () => {
    const result = forecastExpenses({ observations: [], horizon: horizon7d, today: '2026-10-16' });

    expect(result.sufficient).toBe(false);
    expect(result.reason).toBe('no_data');
    expect(result.amountSatang).toBeNull();
    expect(result.periods).toEqual([]);
  });

  it('reports insufficient_periods for one period', () => {
    const result = forecastExpenses({
      observations: weekly([100_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sufficient).toBe(false);
    expect(result.reason).toBe('insufficient_periods');
    expect(result.amountSatang).toBeNull();
    expect(result.periodsUsed).toBe(1);
    expect(result.minPeriodsRequired).toBe(MIN_PERIODS);
  });

  it('reports insufficient_periods for three periods', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 110_000, 120_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sufficient).toBe(false);
    expect(result.reason).toBe('insufficient_periods');
    expect(result.periodsUsed).toBe(3);
  });

  it('produces a forecast at exactly four periods', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sufficient).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.amountSatang).not.toBeNull();
  });

  it('still reports the history range when it cannot forecast', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 100_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.historyRange).toEqual({ start: '2026-01-05', end: '2026-01-18' });
  });

  it('ignores zero and negative observations when bucketing', () => {
    const result = forecastExpenses({
      observations: [
        ...weekly([100_000, 100_000, 100_000]),
        { dateKey: '2026-01-26', amountSatang: 0 },
        { dateKey: '2026-01-27', amountSatang: -500 },
      ],
      horizon: horizon7d,
      today: '2026-10-16',
    });

    // The two non-positive entries do not create their own periods.
    expect(result.periodsAvailable).toBe(3);
    expect(result.sufficient).toBe(false);
  });
});

describe('forecastExpenses — stable spending', () => {
  it('forecasts close to the mean for a flat series', () => {
    const result = forecastExpenses({
      observations: weekly([200_000, 200_000, 200_000, 200_000, 200_000, 200_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sufficient).toBe(true);
    expect(result.perPeriodSatang).toBe(200_000);
    expect(result.amountSatang).toBe(200_000);
    expect(result.method).toBe('wma');
  });

  it('produces a tight band when the series barely moves', () => {
    const result = forecastExpenses({
      observations: weekly([200_000, 201_000, 199_000, 200_000, 200_000, 200_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.hasConfidenceBand).toBe(true);
    expect(result.upperSatang! - result.lowerSatang!).toBeLessThan(20_000);
  });

  it('scales a 30-day forecast by the fractional period count', () => {
    const weeklyResult = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000, 100_000, 100_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });
    const monthlyResult = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000, 100_000, 100_000]),
      horizon: horizon30d,
      today: '2026-10-16',
    });

    expect(monthlyResult.amountSatang).toBe(Math.round(weeklyResult.amountSatang! * (30 / 7)));
  });
});

describe('forecastExpenses — a rising trend', () => {
  it('forecasts above the plain recent mean when spending is climbing', () => {
    const amounts = [100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000, 450_000];
    const result = forecastExpenses({
      observations: weekly(amounts),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sufficient).toBe(true);
    expect(result.method).toBe('wma_trend');
    expect(result.slopePerPeriod).toBeGreaterThan(0);
    // The slope is added on top of the weighted average, so the forecast sits
    // above the weighted average — and well above the flat 275,000 mean.
    expect(result.perPeriodSatang!).toBeGreaterThan(weightedMovingAverage(amounts));
    expect(result.perPeriodSatang!).toBeGreaterThan(275_000);
  });

  it('forecasts below the recent mean when spending is falling', () => {
    const amounts = [450_000, 400_000, 350_000, 300_000, 250_000, 200_000, 150_000, 100_000];
    const result = forecastExpenses({
      observations: weekly(amounts),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.slopePerPeriod).toBeLessThan(0);
    expect(result.perPeriodSatang!).toBeLessThan(weightedMovingAverage(amounts));
    expect(result.perPeriodSatang!).toBeLessThan(275_000);
  });

  it('only applies a trend once there are enough periods', () => {
    const seven = forecastExpenses({
      observations: weekly([100_000, 120_000, 140_000, 160_000, 180_000, 200_000, 220_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });
    const eight = forecastExpenses({
      observations: weekly([100_000, 120_000, 140_000, 160_000, 180_000, 200_000, 220_000, 240_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(seven.method).toBe('wma');
    expect(eight.method).toBe('wma_trend');
    expect(MIN_PERIODS_FOR_TREND).toBe(8);
  });

  it('ignores a slope that does not describe the data', () => {
    // Zig-zag: a least-squares slope exists but explains almost nothing.
    const result = forecastExpenses({
      observations: weekly([100_000, 300_000, 100_000, 300_000, 100_000, 300_000, 100_000, 300_000, 100_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.rSquared).toBeLessThan(0.5);
    expect(result.method).toBe('wma');
  });

  it('never forecasts a negative amount', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 90_000, 80_000, 70_000, 60_000, 50_000, 40_000, 30_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.amountSatang).toBeGreaterThanOrEqual(0);
    expect(result.perPeriodSatang).toBeGreaterThanOrEqual(0);
  });
});

describe('forecastExpenses — outliers', () => {
  it('flags a single huge period, excludes it, and says how many', () => {
    const amounts = [100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 5_000_000];
    const result = forecastExpenses({
      observations: weekly(amounts),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.excludedOutliers).toBe(1);
    expect(result.periodsUsed).toBe(7);
    expect(result.periodsAvailable).toBe(8);

    const outlier = result.periods[7];
    expect(outlier?.excluded).toBe(true);
    expect(outlier?.modifiedZ).toBeGreaterThan(3.5);
    // The actual figure stays visible — the chart still draws it.
    expect(outlier?.actualSatang).toBe(5_000_000);

    // The forecast reflects the typical week, not the spike.
    expect(result.perPeriodSatang).toBe(100_000);
  });

  it('excludes the outlier from the fit rather than letting it dominate', () => {
    const withSpike = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 5_000_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(withSpike.amountSatang).toBe(100_000);
  });

  it('reports no outliers for a series without one', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 110_000, 95_000, 105_000, 102_000, 98_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.excludedOutliers).toBe(0);
    expect(result.periods.every((period) => !period.excluded)).toBe(true);
  });

  it('still forecasts when an outlier leaves exactly the minimum periods', () => {
    // Five periods, one of them an outlier: four remain, which is enough.
    const result = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000, 9_000_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.excludedOutliers).toBe(1);
    expect(result.sufficient).toBe(true);
  });

  it('refuses to forecast when exclusions drop it below the minimum', () => {
    // Three normal periods and one outlier: only three remain. The normal
    // periods are spread enough that the outlier genuinely breaks the median
    // absolute deviation — a tight cluster would hide it instead.
    const result = forecastExpenses({
      observations: weekly([100_000, 120_000, 140_000, 9_000_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.excludedOutliers).toBe(1);
    expect(result.periodsUsed).toBe(3);
    expect(result.sufficient).toBe(false);
    expect(result.reason).toBe('insufficient_periods');
  });
});

describe('forecastExpenses — disclosure fields', () => {
  it('reports every field the UI must disclose', () => {
    const result = forecastExpenses({
      observations: monthly([100_000, 112_000, 118_000, 131_000, 140_000, 149_000, 161_000, 169_000]),
      horizon: horizon3mo,
      today: '2026-10-16',
    });

    expect(result.sufficient).toBe(true);
    expect(result.method).toBe('wma_trend');
    expect(result.periodsUsed).toBe(8);
    expect(result.periodsAvailable).toBe(8);
    expect(result.historyRange).toEqual({ start: '2026-01-01', end: '2026-08-31' });
    expect(result.excludedOutliers).toBe(0);
    expect(result.hasConfidenceBand).toBe(true);
    expect(result.lowerSatang).not.toBeNull();
    expect(result.upperSatang).not.toBeNull();
    expect(result.lowerSatang!).toBeLessThan(result.upperSatang!);
    expect(result.lowerSatang!).toBeLessThan(result.amountSatang!);
    expect(result.upperSatang!).toBeGreaterThan(result.amountSatang!);
  });

  it('collapses the band to a point for a perfectly linear history', () => {
    // With no residual scatter there is no uncertainty to express, so the
    // band has zero width rather than an invented one.
    const result = forecastExpenses({
      observations: monthly([100_000, 110_000, 120_000, 130_000, 140_000, 150_000, 160_000, 170_000]),
      horizon: horizon3mo,
      today: '2026-10-16',
    });

    expect(result.hasConfidenceBand).toBe(true);
    expect(result.lowerSatang).toBe(result.upperSatang);
  });

  it('omits the band below the required period count but still forecasts', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000, 100_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sufficient).toBe(true);
    expect(result.hasConfidenceBand).toBe(false);
    expect(result.lowerSatang).toBe(result.amountSatang);
    expect(result.upperSatang).toBe(result.amountSatang);
    expect(MIN_PERIODS_FOR_BAND).toBe(6);
  });

  it('flags a sparse history, where an empty period may be missing data', () => {
    // Four periods, but only three have any spending: the empty week counts as
    // zero, which may be a real quiet week or simply unrecorded.
    const result = forecastExpenses({
      observations: [
        { dateKey: '2026-01-05', amountSatang: 100_000 },
        { dateKey: '2026-01-19', amountSatang: 100_000 },
        { dateKey: '2026-01-26', amountSatang: 100_000 },
        { dateKey: '2026-02-02', amountSatang: 100_000 },
      ],
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sparse).toBe(true);
    expect(result.periodsAvailable).toBe(5);
    // The gap is filled with a zero rather than skipped, so periods stay evenly
    // spaced.
    expect(result.periods[1]?.actualSatang).toBeNull();
  });

  it('does not flag a fully populated history as sparse', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000, 100_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    });

    expect(result.sparse).toBe(false);
  });

  it('carries the horizon through so the disclosure can name it', () => {
    const result = forecastExpenses({
      observations: weekly([100_000, 100_000, 100_000, 100_000]),
      horizon: horizon3mo,
      today: '2026-10-16',
    });

    expect(result.horizon.kind).toBe('3mo');
    expect(result.horizon.label).toBe('3 เดือน');
    expect(result.grain).toBe('month');
  });
});

describe('forecastExpenses — determinism', () => {
  it('produces identical output for identical input', () => {
    const input = {
      observations: weekly([100_000, 120_000, 90_000, 140_000, 110_000]),
      horizon: horizon7d,
      today: '2026-10-16',
    };

    expect(forecastExpenses(input)).toEqual(forecastExpenses(input));
  });
});

describe('expenseObservations', () => {
  const dateKeyOf = (instant: string): string => instant.slice(0, 10);

  it('takes expense transactions as spending', () => {
    const observations = expenseObservations({
      transactions: [
        { kind: 'expense', amountSatang: -250_000, occurredAt: '2026-10-05T03:00:00Z', linkedSnapshotId: null },
        { kind: 'income', amountSatang: 3_000_000, occurredAt: '2026-10-05T03:00:00Z', linkedSnapshotId: null },
      ],
      snapshots: [],
      fromKey: '2026-10-01',
      toKey: '2026-10-31',
      dateKeyOf,
    });

    expect(observations).toEqual([{ dateKey: '2026-10-05', amountSatang: 250_000 }]);
  });

  it('counts an unlinked classified expense delta', () => {
    const observations = expenseObservations({
      transactions: [],
      snapshots: [
        {
          id: 1,
          derivedDeltaSatang: -80_000,
          effectiveAt: '2026-10-07T03:00:00Z',
          updateType: 'expense',
          isClassified: true,
        },
      ],
      fromKey: '2026-10-01',
      toKey: '2026-10-31',
      dateKeyOf,
    });

    expect(observations).toEqual([{ dateKey: '2026-10-07', amountSatang: 80_000 }]);
  });

  it('skips a delta a transaction already links to, matching the report rule', () => {
    const observations = expenseObservations({
      transactions: [
        { kind: 'expense', amountSatang: -80_000, occurredAt: '2026-10-07T03:00:00Z', linkedSnapshotId: 1 },
      ],
      snapshots: [
        {
          id: 1,
          derivedDeltaSatang: -80_000,
          effectiveAt: '2026-10-07T03:00:00Z',
          updateType: 'expense',
          isClassified: true,
        },
      ],
      fromKey: '2026-10-01',
      toKey: '2026-10-31',
      dateKeyOf,
    });

    expect(observations).toHaveLength(1);
  });

  it('skips an unclassified delta', () => {
    const observations = expenseObservations({
      transactions: [],
      snapshots: [
        {
          id: 1,
          derivedDeltaSatang: -80_000,
          effectiveAt: '2026-10-07T03:00:00Z',
          updateType: 'unknown',
          isClassified: false,
        },
      ],
      fromKey: '2026-10-01',
      toKey: '2026-10-31',
      dateKeyOf,
    });

    expect(observations).toEqual([]);
  });

  it('skips an income delta', () => {
    const observations = expenseObservations({
      transactions: [],
      snapshots: [
        {
          id: 1,
          derivedDeltaSatang: 80_000,
          effectiveAt: '2026-10-07T03:00:00Z',
          updateType: 'income',
          isClassified: true,
        },
      ],
      fromKey: '2026-10-01',
      toKey: '2026-10-31',
      dateKeyOf,
    });

    expect(observations).toEqual([]);
  });

  it('excludes records outside the history window', () => {
    const observations = expenseObservations({
      transactions: [
        { kind: 'expense', amountSatang: -10_000, occurredAt: '2026-09-30T03:00:00Z', linkedSnapshotId: null },
        { kind: 'expense', amountSatang: -10_000, occurredAt: '2026-11-01T03:00:00Z', linkedSnapshotId: null },
      ],
      snapshots: [],
      fromKey: '2026-10-01',
      toKey: '2026-10-31',
      dateKeyOf,
    });

    expect(observations).toEqual([]);
  });

  it('returns observations in date order', () => {
    const observations = expenseObservations({
      transactions: [
        { kind: 'expense', amountSatang: -10_000, occurredAt: '2026-10-20T03:00:00Z', linkedSnapshotId: null },
        { kind: 'expense', amountSatang: -10_000, occurredAt: '2026-10-05T03:00:00Z', linkedSnapshotId: null },
      ],
      snapshots: [],
      fromKey: '2026-10-01',
      toKey: '2026-10-31',
      dateKeyOf,
    });

    expect(observations.map((o) => o.dateKey)).toEqual(['2026-10-05', '2026-10-20']);
  });
});
