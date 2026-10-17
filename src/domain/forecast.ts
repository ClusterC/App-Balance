// Expense forecasting.
//
// Deliberately simple, deterministic and *disclosed*. The spec's requirements
// shape the whole design:
//
//   * At least 4 comparable periods of history, or the app says so instead of
//     guessing. An extrapolation from two data points is a made-up number.
//   * Outliers are detected and **excluded from the fit**, but kept visible in
//     the output and reported in a count. Silently dropping a huge week would
//     hide exactly the event the user most needs to see.
//   * Every field the UI must disclose — method, periods used, history range,
//     whether it was sufficient, the excluded-outlier count — is on the result.
//     The disclosure block is generated from this object, not reconstructed.
//
// No randomness and no clock reads: `today` and `horizon` come from the caller,
// so the same input always produces the same output and the tests are exact.
//
// This is not a financial model. It is an honest summary of what has been
// happening, and the UI says so in Thai next to every figure.

import { addMonthsKey, addWeeksKey, weekRange, type DateRange } from './dates';
import type { Satang } from './money';

// ── tunables, each with the reason it has the value it has ──────────────────

/**
 * Periods required before any forecast is produced.
 *
 * Three points can always be joined by a trend; four is the smallest count
 * where "this is a pattern" starts to be defensible.
 */
export const MIN_PERIODS = 4;

/**
 * Periods required before a confidence band is shown.
 *
 * A band derived from five residuals would be so wide as to be meaningless, and
 * so narrow as to be falsely reassuring, depending on the sample.
 */
export const MIN_PERIODS_FOR_BAND = 6;

/**
 * Periods required before a trend term is added to the weighted average.
 *
 * Below this, a least-squares slope is mostly fitting noise.
 */
export const MIN_PERIODS_FOR_TREND = 8;

/**
 * R² below which the linear fit is treated as not describing the data, and the
 * slope is ignored in favour of the plain weighted average.
 */
export const R_SQUARED_THRESHOLD = 0.5;

/**
 * Modified z-score cut-off. The conventional 3.5 for this statistic, which
 * uses the median and MAD so a single extreme value cannot inflate the
 * threshold that is supposed to catch it.
 */
export const OUTLIER_Z_THRESHOLD = 3.5;

/** z for an 80% two-sided interval. */
export const Z_80_PERCENT = 1.282;

/** 1.4826 = 1 / Φ⁻¹(0.75), scaling MAD to a standard-deviation estimate. */
const MAD_TO_SIGMA = 1.4826;

/** sqrt(2/π): the mean absolute deviation of a standard normal. */
const MEAN_ABS_DEV_TO_SIGMA = 0.7979;

// ── input ───────────────────────────────────────────────────────────────────

export type Grain = 'week' | 'month';

export type HorizonKind = '7d' | '30d' | '3mo';

export interface ForecastHorizon {
  readonly kind: HorizonKind;
  /** Human-readable Thai label for the disclosure block. */
  readonly label: string;
}

export const HORIZONS: readonly ForecastHorizon[] = [
  { kind: '7d', label: '7 วัน' },
  { kind: '30d', label: '30 วัน' },
  { kind: '3mo', label: '3 เดือน' },
];

/**
 * The grain a horizon implies, and how many periods it spans.
 *
 * A 7-day horizon over weekly buckets is one period. A 30-day horizon is
 * 30/7 ≈ 4.29 weekly periods — kept fractional rather than rounded, because
 * rounding it to 4 would quietly under-report by a day's worth of spending.
 */
export function horizonPlan(horizon: ForecastHorizon): { grain: Grain; periods: number } {
  switch (horizon.kind) {
    case '7d':
      return { grain: 'week', periods: 1 };
    case '30d':
      return { grain: 'week', periods: 30 / 7 };
    case '3mo':
      return { grain: 'month', periods: 3 };
  }
}

/** One dated spending event, in Bangkok local days. */
export interface Observation {
  /** `YYYY-MM-DD`, Bangkok. */
  readonly dateKey: string;
  /** Always a positive magnitude — this is spending, not a signed movement. */
  readonly amountSatang: Satang;
}

export interface ForecastInput {
  readonly observations: readonly Observation[];
  readonly horizon: ForecastHorizon;
  /** Bangkok `YYYY-MM-DD`. Passed in so the function stays deterministic. */
  readonly today: string;
}

// ── output ──────────────────────────────────────────────────────────────────

export type ForecastMethod = 'wma' | 'wma_trend';

export interface ForecastPeriod {
  /** `YYYY-MM` for months, or the week's Monday `YYYY-MM-DD` for weeks. */
  readonly key: string;
  readonly range: DateRange;
  /** Actual spend. `null` when the period had no data at all. */
  readonly actualSatang: Satang | null;
  /** True when this period was excluded from the fit as an outlier. */
  readonly excluded: boolean;
  /** Modified z-score, or `null` when not computed. */
  readonly modifiedZ: number | null;
  /** The fitted value, so a chart can draw actual against model. */
  readonly fittedSatang: Satang;
}

export interface ForecastResult {
  readonly sufficient: boolean;
  /** Why not, when `sufficient` is false. */
  readonly reason: 'no_data' | 'insufficient_periods' | null;
  readonly method: ForecastMethod | null;
  /** Total expected spend over the horizon. */
  readonly amountSatang: Satang | null;
  /** Expected spend in one bucket, which is what the chart's line shows. */
  readonly perPeriodSatang: Satang | null;
  readonly lowerSatang: Satang | null;
  readonly upperSatang: Satang | null;
  readonly hasConfidenceBand: boolean;
  readonly horizon: ForecastHorizon;
  readonly grain: Grain;
  /** Periods the fit actually used, after exclusions. */
  readonly periodsUsed: number;
  /** Periods that existed in the history, before exclusions. */
  readonly periodsAvailable: number;
  readonly excludedOutliers: number;
  readonly historyRange: DateRange | null;
  readonly periods: readonly ForecastPeriod[];
  readonly rSquared: number;
  readonly slopePerPeriod: number;
  readonly sigma: number;
  /**
   * True when at least one period in the history had no observations and was
   * filled with zero. The zero may be real (the user spent nothing) or missing
   * data, and the app cannot tell the two apart — so it says so.
   */
  readonly sparse: boolean;
  /** Periods needed before a forecast is possible, for the Thai message. */
  readonly minPeriodsRequired: number;
}

// ── statistics ──────────────────────────────────────────────────────────────

/** Median of a non-empty list. Mutates nothing. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Modified z-scores: `|x − median| / (1.4826 · MAD)`.
 *
 * Median and MAD rather than mean and standard deviation, because the whole
 * point is to find the extreme value — and a single extreme value drags the
 * mean and inflates the standard deviation enough to hide itself.
 *
 * When MAD is zero (more than half the values identical, which is common with
 * a run of equal amounts), it falls back to the mean absolute deviation
 * rescaled to a standard-deviation estimate. Without that fallback every
 * z-score would be 0 or infinite and no outlier would ever be found.
 */
export function modifiedZScores(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const centre = median(values);
  const deviations = values.map((value) => Math.abs(value - centre));

  let scale = MAD_TO_SIGMA * median(deviations);
  if (scale === 0) {
    const meanAbsoluteDeviation =
      deviations.reduce((total, value) => total + value, 0) / deviations.length;
    scale = meanAbsoluteDeviation / MEAN_ABS_DEV_TO_SIGMA;
  }
  if (scale === 0) return values.map(() => 0);

  return deviations.map((deviation) => deviation / scale);
}

interface Regression {
  readonly slope: number;
  readonly intercept: number;
  readonly rSquared: number;
}

/** Least-squares fit of `values` against their index. */
export function linearRegression(values: readonly number[]): Regression {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, rSquared: 0 };

  const meanX = (n - 1) / 2;
  const meanY = values.reduce((total, value) => total + value, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    covariance += dx * ((values[i] ?? 0) - meanY);
    varianceX += dx * dx;
  }

  const slope = varianceX === 0 ? 0 : covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residualSum = 0;
  let totalSum = 0;
  for (let i = 0; i < n; i += 1) {
    const actual = values[i] ?? 0;
    const fitted = intercept + slope * i;
    residualSum += (actual - fitted) ** 2;
    totalSum += (actual - meanY) ** 2;
  }

  // A constant series has no variance to explain; the fit is trivially exact.
  const rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum;
  return { slope, intercept, rSquared };
}

/**
 * Weighted moving average with linear decay by recency.
 *
 * Weight `i` for the `i`-th of `n` periods, so the newest period counts `n`
 * times as much as the oldest. That is the baseline the spec asks for, and it
 * is what makes the result respond to a recent change without discarding
 * history entirely.
 */
export function weightedMovingAverage(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;

  let weightedTotal = 0;
  let weightSum = 0;
  for (let i = 0; i < n; i += 1) {
    const weight = i + 1;
    weightedTotal += weight * (values[i] ?? 0);
    weightSum += weight;
  }
  return weightSum === 0 ? 0 : weightedTotal / weightSum;
}

/** Sample standard deviation, `n − 1` denominator. */
export function standardDeviation(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / n;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// ── bucketing ───────────────────────────────────────────────────────────────

/** The bucket key a date belongs to, for a given grain. */
export function bucketKey(dateKey: string, grain: Grain): string {
  return grain === 'month' ? dateKey.slice(0, 7) : weekRange(dateKey).start;
}

function bucketRange(key: string, grain: Grain): DateRange {
  return grain === 'month'
    ? { start: `${key}-01`, end: `${key}-31` }
    : weekRange(key);
}

function nextBucketKey(key: string, grain: Grain): string {
  return grain === 'month' ? addMonthsKey(key, 1) : addWeeksKey(key, 1);
}

interface Bucket {
  readonly key: string;
  readonly range: DateRange;
  readonly actualSatang: Satang;
  readonly hasData: boolean;
}

/**
 * Groups observations into contiguous buckets, oldest first.
 *
 * Empty buckets are included with a zero rather than skipped, because the
 * forecast assumes evenly spaced periods — dropping a quiet week would make two
 * months of history look like two consecutive weeks and inflate the result.
 * `sparse` on the result flags that this happened.
 */
function bucketise(observations: readonly Observation[], grain: Grain): Bucket[] {
  const totals = new Map<string, number>();
  for (const observation of observations) {
    if (observation.amountSatang <= 0) continue;
    const key = bucketKey(observation.dateKey, grain);
    totals.set(key, (totals.get(key) ?? 0) + observation.amountSatang);
  }

  if (totals.size === 0) return [];

  const keys = [...totals.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return [];

  const buckets: Bucket[] = [];
  let cursor = first;
  // Bounded: a corrupt date should not spin. Ten years of weeks is ~520.
  for (let i = 0; i < 1_200 && cursor <= last; i += 1) {
    const amount = totals.get(cursor);
    buckets.push({
      key: cursor,
      range: bucketRange(cursor, grain),
      actualSatang: amount ?? 0,
      hasData: amount !== undefined,
    });
    cursor = nextBucketKey(cursor, grain);
  }

  return buckets;
}

// ── the forecast ────────────────────────────────────────────────────────────

/** Rounds to the nearest satang and never below zero. */
function clampAmount(value: number): Satang {
  return Math.max(0, Math.round(value));
}

export function forecastExpenses(input: ForecastInput): ForecastResult {
  const { grain, periods: periodsInHorizon } = horizonPlan(input.horizon);

  const buckets = bucketise(input.observations, grain);

  const base: ForecastResult = {
    sufficient: false,
    reason: null,
    method: null,
    amountSatang: null,
    perPeriodSatang: null,
    lowerSatang: null,
    upperSatang: null,
    hasConfidenceBand: false,
    horizon: input.horizon,
    grain,
    periodsUsed: 0,
    periodsAvailable: buckets.length,
    excludedOutliers: 0,
    historyRange: null,
    periods: buckets.map((bucket) => ({
      key: bucket.key,
      range: bucket.range,
      actualSatang: bucket.hasData ? bucket.actualSatang : null,
      excluded: false,
      modifiedZ: null,
      fittedSatang: 0,
    })),
    rSquared: 0,
    slopePerPeriod: 0,
    sigma: 0,
    sparse: buckets.some((bucket) => !bucket.hasData),
    minPeriodsRequired: MIN_PERIODS,
  };

  if (buckets.length === 0) {
    return { ...base, reason: 'no_data' };
  }

  const historyRange: DateRange = {
    start: buckets[0]?.range.start ?? input.today,
    end: buckets[buckets.length - 1]?.range.end ?? input.today,
  };

  // ── outlier detection ────────────────────────────────────────────────────
  const amounts = buckets.map((bucket) => bucket.actualSatang);
  const zScores = modifiedZScores(amounts);
  const excludedFlags = zScores.map((z) => z > OUTLIER_Z_THRESHOLD);

  const keptIndices: number[] = [];
  for (let i = 0; i < buckets.length; i += 1) {
    if (!excludedFlags[i]) keptIndices.push(i);
  }
  const keptValues = keptIndices.map((index) => amounts[index] ?? 0);
  const excludedOutliers = buckets.length - keptIndices.length;

  // ── sufficiency, judged after exclusions ─────────────────────────────────
  if (keptValues.length < MIN_PERIODS) {
    return {
      ...base,
      reason: 'insufficient_periods',
      historyRange,
      periodsUsed: keptValues.length,
      excludedOutliers,
      periods: base.periods.map((period, index) => ({
        ...period,
        excluded: excludedFlags[index] ?? false,
        modifiedZ: zScores[index] ?? null,
      })),
    };
  }

  // ── fit ──────────────────────────────────────────────────────────────────
  const wma = weightedMovingAverage(keptValues);
  const regression = linearRegression(keptValues);
  const useTrend =
    keptValues.length >= MIN_PERIODS_FOR_TREND && regression.rSquared >= R_SQUARED_THRESHOLD;

  const perPeriod = clampAmount(useTrend ? wma + regression.slope : wma);
  const method: ForecastMethod = useTrend ? 'wma_trend' : 'wma';

  // ── confidence band ──────────────────────────────────────────────────────
  // Residuals are measured against the model actually chosen, so a band around
  // a trend-adjusted forecast is not accidentally computed from a flat one.
  const residuals = keptValues.map((value, index) =>
    useTrend ? value - (regression.intercept + regression.slope * index) : value - wma,
  );
  const sigma = standardDeviation(residuals);
  const hasConfidenceBand = keptValues.length >= MIN_PERIODS_FOR_BAND;

  const periods: ForecastPeriod[] = buckets.map((bucket, index) => ({
    key: bucket.key,
    range: bucket.range,
    actualSatang: bucket.hasData ? bucket.actualSatang : null,
    excluded: excludedFlags[index] ?? false,
    modifiedZ: zScores[index] ?? null,
    // The in-sample line a chart draws over history: the same value the
    // forecast predicts, so actual-vs-model is a fair comparison.
    fittedSatang: perPeriod,
  }));

  const spread = hasConfidenceBand ? Z_80_PERCENT * sigma : 0;

  return {
    ...base,
    sufficient: true,
    reason: null,
    method,
    amountSatang: clampAmount(perPeriod * periodsInHorizon),
    perPeriodSatang: perPeriod,
    lowerSatang: clampAmount((perPeriod - spread) * periodsInHorizon),
    upperSatang: clampAmount((perPeriod + spread) * periodsInHorizon),
    hasConfidenceBand,
    periodsUsed: keptValues.length,
    periodsAvailable: buckets.length,
    excludedOutliers,
    historyRange,
    periods,
    rSquared: regression.rSquared,
    slopePerPeriod: Math.round(regression.slope),
    sigma: Math.round(sigma),
    sparse: buckets.some((bucket) => !bucket.hasData),
  };
}

/**
 * Builds the observations the forecast consumes, from the same records the
 * rest of the app uses.
 *
 * Spending is counted from transactions and from snapshot deltas that carry an
 * expense classification and are **not** linked to a transaction — the same
 * double-counting rule as `cashflow.ts`, applied here so the forecast and the
 * reports cannot disagree about what was spent.
 */
export function expenseObservations(input: {
  readonly transactions: readonly {
    kind: string;
    amountSatang: Satang;
    occurredAt: string;
    linkedSnapshotId: number | null;
  }[];
  readonly snapshots: readonly {
    id: number;
    derivedDeltaSatang: Satang;
    effectiveAt: string;
    updateType: string;
    isClassified: boolean;
  }[];
  readonly fromKey: string;
  readonly toKey: string;
  readonly dateKeyOf: (instant: string) => string;
}): Observation[] {
  const linked = new Set(
    input.transactions
      .map((transaction) => transaction.linkedSnapshotId)
      .filter((id): id is number => id !== null),
  );

  const observations: Observation[] = [];

  for (const transaction of input.transactions) {
    if (transaction.kind !== 'expense') continue;
    const dateKey = input.dateKeyOf(transaction.occurredAt);
    if (dateKey < input.fromKey || dateKey > input.toKey) continue;
    observations.push({ dateKey, amountSatang: Math.abs(transaction.amountSatang) });
  }

  for (const snapshot of input.snapshots) {
    if (!snapshot.isClassified) continue;
    if (snapshot.updateType !== 'expense') continue;
    if (linked.has(snapshot.id)) continue;
    const dateKey = input.dateKeyOf(snapshot.effectiveAt);
    if (dateKey < input.fromKey || dateKey > input.toKey) continue;
    observations.push({ dateKey, amountSatang: Math.abs(snapshot.derivedDeltaSatang) });
  }

  return observations.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
}
