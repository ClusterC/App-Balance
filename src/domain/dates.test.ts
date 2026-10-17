import { describe, expect, it } from 'vitest';
import {
  addMonthsKey,
  addWeeksKey,
  bangkokDateKey,
  bangkokDayStart,
  bangkokLocalToUtc,
  bangkokMonthKey,
  bangkokTimeOfDay,
  daysSince,
  differenceInCalendarDaysBangkok,
  formatRelativeThai,
  formatThaiDate,
  formatThaiDateTime,
  formatThaiMonth,
  isWithin,
  monthRange,
  monthsBetween,
  parseIsoUtc,
  previousMonthKey,
  previousRange,
  toIsoUtc,
  weekRange,
} from './dates';

describe('Bangkok conversion', () => {
  it('reads the Bangkok calendar day from a UTC instant', () => {
    // 18:00Z is 01:00 the next day in Bangkok.
    expect(bangkokDateKey('2026-10-16T18:00:00Z')).toBe('2026-10-17');
    expect(bangkokDateKey('2026-10-16T16:59:59Z')).toBe('2026-10-16');
    expect(bangkokDateKey('2026-10-16T17:00:00Z')).toBe('2026-10-17');
  });

  it('derives the Bangkok month, which is what reports bucket by', () => {
    // The last evening of October UTC is already November in Bangkok — the
    // case that makes month-end reporting wrong if you bucket by UTC.
    expect(bangkokMonthKey('2026-10-31T18:30:00Z')).toBe('2026-11');
    expect(bangkokMonthKey('2026-10-31T10:00:00Z')).toBe('2026-10');
  });

  it('round-trips a Bangkok wall-clock time through UTC', () => {
    const utc = bangkokLocalToUtc('2026-10-16', '14:30');
    expect(toIsoUtc(utc)).toBe('2026-10-16T07:30:00Z');
    expect(bangkokTimeOfDay(utc)).toBe('14:30');
    expect(bangkokDateKey(utc)).toBe('2026-10-16');
  });

  it('treats midnight Bangkok as 17:00 the previous day UTC', () => {
    expect(bangkokDayStart('2026-10-16').toISOString()).toBe('2026-10-15T17:00:00.000Z');
  });

  it('defaults the time of day to midnight', () => {
    expect(toIsoUtc(bangkokLocalToUtc('2026-10-16'))).toBe('2026-10-15T17:00:00Z');
  });

  it('returns null for an unparseable timestamp', () => {
    expect(parseIsoUtc('not a date')).toBeNull();
    expect(bangkokDateKey('not a date')).toBe('');
    expect(formatThaiDate('not a date')).toBe('—');
  });
});

describe('display formatting', () => {
  it('renders dates in the Thai Buddhist era', () => {
    // 2026 CE is 2569 BE.
    expect(formatThaiDate('2026-10-16T03:00:00Z')).toBe('16 ต.ค. 2569');
  });

  it('renders date and Bangkok time together', () => {
    expect(formatThaiDateTime('2026-10-16T07:30:00Z')).toBe('16 ต.ค. 2569 14:30');
  });

  it('renders a month heading in the Buddhist era', () => {
    expect(formatThaiMonth('2026-10')).toBe('ตุลาคม 2569');
  });

  it('phrases recent dates relatively', () => {
    const now = new Date('2026-10-16T05:00:00Z'); // 12:00 Bangkok
    expect(formatRelativeThai('2026-10-16T01:00:00Z', now)).toBe('วันนี้');
    expect(formatRelativeThai('2026-10-15T01:00:00Z', now)).toBe('เมื่อวาน');
    expect(formatRelativeThai('2026-10-13T01:00:00Z', now)).toBe('3 วันที่แล้ว');
  });

  it('counts whole Bangkok calendar days, not 24-hour blocks', () => {
    const from = new Date('2026-10-16T16:00:00Z'); // 23:00 Bangkok on the 16th
    const to = new Date('2026-10-15T18:00:00Z'); // 01:00 Bangkok on the 16th
    expect(differenceInCalendarDaysBangkok(from, to)).toBe(0);
  });

  it('reports infinity for a missing timestamp, so staleness never reads as fresh', () => {
    expect(daysSince('not a date')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('periods', () => {
  it('builds an inclusive month range, handling month lengths', () => {
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthRange('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });

  it('builds a Monday-start week', () => {
    // 2026-10-16 is a Friday.
    expect(weekRange('2026-10-16')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    // A Monday is its own week start.
    expect(weekRange('2026-10-12')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    // A Sunday belongs to the week that began six days earlier.
    expect(weekRange('2026-10-18')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
  });

  it('walks back to the equally long previous window', () => {
    expect(previousRange({ start: '2026-10-01', end: '2026-10-31' })).toEqual({
      start: '2026-08-31',
      end: '2026-09-30',
    });
    expect(previousRange({ start: '2026-10-12', end: '2026-10-18' })).toEqual({
      start: '2026-10-05',
      end: '2026-10-11',
    });
  });

  it('steps months and weeks', () => {
    expect(previousMonthKey('2026-10')).toBe('2026-09');
    expect(previousMonthKey('2026-01')).toBe('2025-12');
    expect(addMonthsKey('2026-12', 1)).toBe('2027-01');
    expect(addWeeksKey('2026-10-12', 2)).toBe('2026-10-26');
  });

  it('enumerates months inclusively', () => {
    expect(monthsBetween('2026-01-01', '2026-04-30')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(monthsBetween('2026-10-01', '2026-10-31')).toEqual(['2026-10']);
  });

  it('returns an empty list for a reversed month range instead of looping', () => {
    expect(monthsBetween('2026-10-01', '2026-01-01')).toEqual([]);
  });

  it('tests range membership inclusively at both ends', () => {
    const range = { start: '2026-10-01', end: '2026-10-31' };
    expect(isWithin('2026-10-01', range)).toBe(true);
    expect(isWithin('2026-10-31', range)).toBe(true);
    expect(isWithin('2026-09-30', range)).toBe(false);
    expect(isWithin('2026-11-01', range)).toBe(false);
  });
});
