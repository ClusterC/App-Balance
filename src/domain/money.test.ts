import { describe, expect, it } from 'vitest';
import {
  MAX_SATANG,
  MoneyOverflowError,
  addSatang,
  amountParts,
  formatAmount,
  formatPercent,
  formatTHB,
  isSatang,
  negateSatang,
  parseAmount,
  satangToDecimalString,
  subSatang,
  sumSatang,
} from './money';

describe('parseAmount', () => {
  it('parses a plain integer as whole baht', () => {
    expect(parseAmount('1234')).toBe(123_400);
  });

  it('parses a decimal amount', () => {
    expect(parseAmount('1234.56')).toBe(123_456);
    expect(parseAmount('0.01')).toBe(1);
    expect(parseAmount('.5')).toBeNull();
  });

  it('accepts comma separators', () => {
    expect(parseAmount('1,234.56')).toBe(123_456);
    expect(parseAmount('1,234,567')).toBe(123_456_700);
  });

  it('accepts space separators, including non-breaking ones', () => {
    expect(parseAmount('1 234.56')).toBe(123_456);
    expect(parseAmount('1 234.56')).toBe(123_456);
    expect(parseAmount('1 234')).toBe(123_400);
  });

  it('accepts Thai digits', () => {
    expect(parseAmount('๑,๒๓๔.๕๖')).toBe(123_456);
    expect(parseAmount('๑๒๓๔')).toBe(123_400);
  });

  it('accepts a baht sign prefix', () => {
    expect(parseAmount('฿1,234.56')).toBe(123_456);
    expect(parseAmount('฿99')).toBe(9_900);
  });

  it('parses negatives', () => {
    expect(parseAmount('-99')).toBe(-9_900);
    expect(parseAmount('-1,234.56')).toBe(-123_456);
  });

  it('parses an explicit positive sign', () => {
    expect(parseAmount('+42')).toBe(4_200);
  });

  it('rounds half-up at the third decimal place', () => {
    expect(parseAmount('1.005')).toBe(101);
    expect(parseAmount('1.004')).toBe(100);
    expect(parseAmount('1.0051')).toBe(101);
    expect(parseAmount('0.005')).toBe(1);
    expect(parseAmount('0.004')).toBe(0);
    // The classic float trap: 2.675 is 2.6749999... as a float. Integer
    // parsing gets this right where `Math.round(x * 100)` would not.
    expect(parseAmount('2.675')).toBe(268);
  });

  it('treats a trailing decimal point as whole baht', () => {
    expect(parseAmount('12.')).toBe(1_200);
  });

  it('rejects junk', () => {
    for (const input of ['', '   ', 'abc', '1.2.3', '1,2,3.4.5', '--5', '12x', '1e5', '๑๒๓abc']) {
      expect(parseAmount(input), input).toBeNull();
    }
  });

  it('rejects a lone sign or separator', () => {
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount(',')).toBeNull();
    expect(parseAmount('฿')).toBeNull();
  });

  it('throws on an amount beyond the safe integer range', () => {
    expect(() => parseAmount('99999999999999999999')).toThrow(MoneyOverflowError);
  });

  it('accepts the largest representable amount', () => {
    // MAX_SATANG is 90,071,992,547,409.91 THB.
    expect(parseAmount('90071992547409.91')).toBe(MAX_SATANG);
  });
});

describe('formatTHB', () => {
  it('formats with a baht sign and two decimals', () => {
    expect(formatTHB(123_456)).toBe('฿1,234.56');
  });

  it('pads the satang to two digits', () => {
    expect(formatTHB(123_400)).toBe('฿1,234.00');
    expect(formatTHB(5)).toBe('฿0.05');
    expect(formatTHB(0)).toBe('฿0.00');
  });

  it('formats negatives with a minus sign', () => {
    expect(formatTHB(-123_456)).toBe('-฿1,234.56');
    expect(formatTHB(-1)).toBe('-฿0.01');
  });

  it('omits the sign on positives unless asked', () => {
    expect(formatTHB(123_456, { showSign: true })).toBe('+฿1,234.56');
    expect(formatTHB(-123_456, { showSign: true })).toBe('-฿1,234.56');
  });

  it('can hide the currency symbol', () => {
    expect(formatTHB(123_456, { hideSymbol: true })).toBe('1,234.56');
  });

  it('groups millions', () => {
    expect(formatTHB(1_234_567_890)).toBe('฿12,345,678.90');
  });

  it('refuses a non-integer', () => {
    expect(() => formatTHB(12.5)).toThrow(MoneyOverflowError);
  });
});

describe('formatAmount', () => {
  it('drops the symbol', () => {
    expect(formatAmount(123_456)).toBe('1,234.56');
    expect(formatAmount(-123_456)).toBe('-1,234.56');
  });
});

describe('amountParts', () => {
  it('splits a negative amount so the sign can be styled', () => {
    expect(amountParts(-123_456)).toEqual({
      sign: '-',
      symbol: '฿',
      whole: '1,234',
      fraction: '56',
    });
  });

  it('reports an empty sign for a positive amount by default', () => {
    expect(amountParts(123_456).sign).toBe('');
    expect(amountParts(123_456, { showSign: true }).sign).toBe('+');
  });
});

describe('satangToDecimalString', () => {
  it('produces plain decimal text with no grouping', () => {
    expect(satangToDecimalString(123_456)).toBe('1234.56');
    expect(satangToDecimalString(-5)).toBe('-0.05');
    expect(satangToDecimalString(0)).toBe('0.00');
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addSatang(123_456, 87_654)).toBe(211_110);
    expect(subSatang(123_456, 87_654)).toBe(35_802);
  });

  it('avoids the float error a naive implementation would hit', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; in satang it is exact.
    expect(addSatang(10, 20)).toBe(30);
    expect(sumSatang([10, 20, 30])).toBe(60);
  });

  it('sums an empty list to zero, not NaN', () => {
    expect(sumSatang([])).toBe(0);
  });

  it('negates', () => {
    expect(negateSatang(123_456)).toBe(-123_456);
    expect(negateSatang(-123_456)).toBe(123_456);
  });

  it('throws rather than losing precision on overflow', () => {
    expect(() => addSatang(MAX_SATANG, 1)).toThrow(MoneyOverflowError);
    expect(() => subSatang(-MAX_SATANG, 1)).toThrow(MoneyOverflowError);
    expect(() => sumSatang([MAX_SATANG, MAX_SATANG])).toThrow(MoneyOverflowError);
  });

  it('rejects a non-integer operand', () => {
    expect(() => addSatang(1.5, 2)).toThrow(MoneyOverflowError);
    expect(() => sumSatang([1, Number.NaN])).toThrow(MoneyOverflowError);
    expect(() => negateSatang(Number.POSITIVE_INFINITY)).toThrow(MoneyOverflowError);
  });

  it('accepts the maximum on both sides without throwing', () => {
    expect(addSatang(MAX_SATANG, -MAX_SATANG)).toBe(0);
  });
});

describe('isSatang', () => {
  it('accepts safe integers only', () => {
    expect(isSatang(0)).toBe(true);
    expect(isSatang(-123_456)).toBe(true);
    expect(isSatang(1.5)).toBe(false);
    expect(isSatang(Number.NaN)).toBe(false);
    expect(isSatang('123')).toBe(false);
    expect(isSatang(null)).toBe(false);
  });
});

describe('formatPercent', () => {
  it('formats a ratio', () => {
    expect(formatPercent(0.25)).toBe('25%');
    expect(formatPercent(1.5)).toBe('150%');
    expect(formatPercent(0.1234, 1)).toBe('12.3%');
  });

  it('returns a dash for a non-finite ratio, so a divide-by-zero cannot leak NaN into the UI', () => {
    expect(formatPercent(Number.NaN)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
