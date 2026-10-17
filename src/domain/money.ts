// Money, in satang.
//
// Every amount in this application is an integer number of satang (1 THB = 100
// satang). Floating point is never the source of truth: a JS float cannot
// represent 0.1 exactly, and a finance app that drifts by a satang per
// operation is worse than useless. Floats appear only when a value is handed to
// `Intl.NumberFormat` for display, and only after being split into whole baht
// and remainder digits — never as an intermediate result.
//
// This module has no React, database or Tauri import. It is pure, and it is
// unit-tested directly.

/** An integer number of satang. */
export type Satang = number;

/**
 * The largest amount this app will represent: `Number.MAX_SAFE_INTEGER` satang,
 * about 90 trillion THB. Beyond this, integer arithmetic in JS silently loses
 * precision, so the limit is enforced rather than trusted.
 */
export const MAX_SATANG = 9_007_199_254_740_991;

export const SATANG_PER_BAHT = 100;

/** Thrown when an arithmetic operation would leave the safe integer range. */
export class MoneyOverflowError extends Error {
  constructor(message = 'จำนวนเงินเกินขอบเขตที่ระบบรองรับ') {
    super(message);
    this.name = 'MoneyOverflowError';
  }
}

// ── parsing ─────────────────────────────────────────────────────────────────

/** Thai digits ๐–๙ (U+0E50–U+0E59) mapped to ASCII. */
const THAI_DIGITS = /[๐-๙]/g;

/**
 * Characters users type or paste as thousands separators: ordinary spaces, a
 * comma, a non-breaking space, a narrow non-breaking space (both common when
 * copying from a bank statement or a spreadsheet) and the Arabic thousands
 * separator.
 */
const SEPARATORS = /[\s,\u00A0\u202F\u066C]/g;

/** The baht sign, plus the yen and dollar signs people paste by habit. */
const BAHT_SIGNS = /[\u0E3F\u00A5$]/g;

const NUMERIC_SHAPE = /^([+-])?(\d+)(?:\.(\d*))?$/;

/**
 * Parses user input into satang, or returns `null` if it is not a number.
 *
 * Accepts `1,234.56`, `1234`, `1 234.56`, `-99`, `+42`, Thai digits
 * (`๑,๒๓๔.๕๖`) and an optional `฿` prefix. A third decimal place rounds
 * half-up, so `1.005` is 101 satang, not 100.
 *
 * Returns `null` rather than throwing for malformed input, because this is fed
 * straight from a form field where "not a number yet" is a normal state.
 * Throws {@link MoneyOverflowError} only for a well-formed number too large to
 * represent.
 */
export function parseAmount(input: string): Satang | null {
  if (typeof input !== 'string') return null;

  const cleaned = input
    .replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(BAHT_SIGNS, '')
    .replace(SEPARATORS, '');

  if (cleaned === '') return null;

  const match = NUMERIC_SHAPE.exec(cleaned);
  if (!match) return null;

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';

  // Pad to three places so the third is always the rounding digit.
  const padded = `${fraction}000`;
  const satangDigits = `${whole}${padded.slice(0, 2)}`;

  let satang = BigInt(satangDigits);
  if (Number(padded.charAt(2)) >= 5) satang += 1n;
  satang *= sign;

  const limit = BigInt(MAX_SATANG);
  if (satang > limit || satang < -limit) {
    throw new MoneyOverflowError();
  }

  return Number(satang);
}

/** Formats satang as plain decimal text with no separators: `1234.56`. */
export function satangToDecimalString(satang: Satang): string {
  assertSatang(satang);
  const negative = satang < 0;
  const abs = Math.abs(satang);
  const whole = Math.floor(abs / SATANG_PER_BAHT);
  const fraction = abs % SATANG_PER_BAHT;
  return `${negative ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`;
}

// ── formatting ──────────────────────────────────────────────────────────────

const GROUPING = new Intl.NumberFormat('th-TH', {
  useGrouping: true,
  maximumFractionDigits: 0,
});

export interface FormatOptions {
  /** Prefix a `+` on positive amounts. Negative amounts always carry `-`. */
  showSign?: boolean;
  /** Emit `1,234.56` without the baht sign, for table columns with a header. */
  hideSymbol?: boolean;
}

/**
 * Renders satang as Thai baht text: `฿1,234.56`.
 *
 * The integer part is grouped by `Intl.NumberFormat` but the decimal part is
 * produced by integer arithmetic, so the result never depends on float
 * rounding.
 */
export function formatTHB(satang: Satang, options: FormatOptions = {}): string {
  assertSatang(satang);

  const { showSign = false, hideSymbol = false } = options;
  const negative = satang < 0;
  const abs = Math.abs(satang);
  const whole = Math.floor(abs / SATANG_PER_BAHT);
  const fraction = abs % SATANG_PER_BAHT;

  const sign = negative ? '-' : showSign ? '+' : '';
  const symbol = hideSymbol ? '' : '฿';
  const body = `${GROUPING.format(whole)}.${String(fraction).padStart(2, '0')}`;

  return `${sign}${symbol}${body}`;
}

/** Renders satang without a currency symbol: `1,234.56`. */
export function formatAmount(satang: Satang, options: Omit<FormatOptions, 'hideSymbol'> = {}): string {
  return formatTHB(satang, { ...options, hideSymbol: true });
}

/**
 * Splits satang into grouped text parts so a component can style the sign,
 * symbol and digits separately without re-parsing a formatted string.
 */
export interface AmountParts {
  sign: '' | '+' | '-';
  symbol: string;
  whole: string;
  fraction: string;
}

export function amountParts(satang: Satang, options: FormatOptions = {}): AmountParts {
  assertSatang(satang);

  const { showSign = false, hideSymbol = false } = options;
  const abs = Math.abs(satang);
  return {
    sign: satang < 0 ? '-' : showSign ? '+' : '',
    symbol: hideSymbol ? '' : '฿',
    whole: GROUPING.format(Math.floor(abs / SATANG_PER_BAHT)),
    fraction: String(abs % SATANG_PER_BAHT).padStart(2, '0'),
  };
}

// ── arithmetic ──────────────────────────────────────────────────────────────

function assertSatang(value: Satang): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyOverflowError(`ค่าที่ไม่ใช่จำนวนเต็มของสตางค์: ${String(value)}`);
  }
}

function assertResult(value: bigint): Satang {
  const limit = BigInt(MAX_SATANG);
  if (value > limit || value < -limit) {
    throw new MoneyOverflowError();
  }
  return Number(value);
}

export function addSatang(a: Satang, b: Satang): Satang {
  assertSatang(a);
  assertSatang(b);
  return assertResult(BigInt(a) + BigInt(b));
}

export function subSatang(a: Satang, b: Satang): Satang {
  assertSatang(a);
  assertSatang(b);
  return assertResult(BigInt(a) - BigInt(b));
}

/** Sums a list of amounts. An empty list is zero, not `NaN`. */
export function sumSatang(values: readonly Satang[]): Satang {
  let total = 0n;
  for (const value of values) {
    assertSatang(value);
    total += BigInt(value);
  }
  return assertResult(total);
}

export function negateSatang(value: Satang): Satang {
  assertSatang(value);
  return assertResult(-BigInt(value));
}

/** True when the value is a safe integer usable as satang. */
export function isSatang(value: unknown): value is Satang {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** `0.25` → `'25%'`. Used by budget progress; kept here so rounding is shared. */
export function formatPercent(ratio: number, fractionDigits = 0): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}
