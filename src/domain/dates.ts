// Dates and periods.
//
// Two representations, and the distinction matters:
//
//   * **Stored** — ISO 8601 UTC text, `2026-10-16T08:30:00Z`. This is what the
//     database holds and what the Rust side parses.
//   * **Displayed** — Asia/Bangkok, always UTC+7 with no daylight saving. Thai
//     users think in local calendar days, and "which month is this in?" must
//     never depend on the machine's timezone setting.
//
// Bangkok has had a fixed +07:00 offset since 1920, so a constant offset is
// correct here and avoids pulling a timezone database into a desktop app.
//
// Pure module: no React, no database, no clock reads. Functions that need "now"
// take it as a parameter so they stay deterministic and testable.

import { addMonths, addWeeks, format, parse, startOfWeek } from 'date-fns';
import { th } from 'date-fns/locale';

/** Bangkok is UTC+7 year-round. */
export const BANGKOK_OFFSET_MINUTES = 7 * 60;

const BANGKOK_OFFSET_MS = BANGKOK_OFFSET_MINUTES * 60 * 1000;

/** ISO 8601 UTC with second precision, matching what the Rust side writes. */
export function toIsoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parses a stored timestamp. Returns `null` for anything unparseable. */
export function parseIsoUtc(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ── Bangkok-local calendar views ────────────────────────────────────────────

/**
 * A calendar day in Bangkok, `YYYY-MM-DD`. The basis for every period bucket.
 *
 * Shifting the instant by the offset and then reading the UTC fields yields the
 * Bangkok wall-clock reading without a timezone library.
 */
export function bangkokDateKey(instant: Date | string): string {
  const date = typeof instant === 'string' ? parseIsoUtc(instant) : instant;
  if (!date) return '';
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The Bangkok calendar month a timestamp falls in, `YYYY-MM`. */
export function bangkokMonthKey(instant: Date | string): string {
  return bangkokDateKey(instant).slice(0, 7);
}

/** Midnight Bangkok on a `YYYY-MM-DD` key, expressed as a real UTC instant. */
export function bangkokDayStart(dateKey: string): Date {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - BANGKOK_OFFSET_MS);
}

/**
 * Builds a UTC instant from a Bangkok-local date and time, which is what a form
 * collects. `2026-10-16` + `14:30` → `2026-10-16T07:30:00Z`.
 */
export function bangkokLocalToUtc(dateKey: string, time = '00:00'): Date {
  const [hours = '0', minutes = '0'] = time.split(':');
  const base = new Date(`${dateKey}T00:00:00Z`);
  const utcMs =
    base.getTime() + Number(hours) * 3_600_000 + Number(minutes) * 60_000 - BANGKOK_OFFSET_MS;
  return new Date(utcMs);
}

/** The `HH:mm` Bangkok wall-clock time of an instant, for form defaults. */
export function bangkokTimeOfDay(instant: Date | string): string {
  const date = typeof instant === 'string' ? parseIsoUtc(instant) : instant;
  if (!date) return '00:00';
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

/** Today's Bangkok date key. Takes `now` so callers and tests stay explicit. */
export function todayKey(now: Date = new Date()): string {
  return bangkokDateKey(now);
}

// ── display formatting ──────────────────────────────────────────────────────

/** Buddhist era year, which is what Thai documents and apps use. */
export const BUDDHIST_ERA_OFFSET = 543;

/** `16 ต.ค. 2569` — Thai Buddhist era, the form Thai users expect. */
export function formatThaiDate(instant: Date | string): string {
  const date = typeof instant === 'string' ? parseIsoUtc(instant) : instant;
  if (!date) return '—';
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const year = shifted.getUTCFullYear() + BUDDHIST_ERA_OFFSET;
  return `${format(shifted, 'd MMM', { locale: th })} ${year}`;
}

/** `16 ต.ค. 2569 14:30` — for timeline rows, where the time of day matters. */
export function formatThaiDateTime(instant: Date | string): string {
  const date = typeof instant === 'string' ? parseIsoUtc(instant) : instant;
  if (!date) return '—';
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const year = shifted.getUTCFullYear() + BUDDHIST_ERA_OFFSET;
  const time = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
  return `${format(shifted, 'd MMM', { locale: th })} ${year} ${time}`;
}

/** `ตุลาคม 2569` — month headings in reports. */
export function formatThaiMonth(monthKey: string): string {
  const parsed = parse(`${monthKey}-01`, 'yyyy-MM-dd', new Date());
  if (Number.isNaN(parsed.getTime())) return monthKey;
  const year = parsed.getFullYear() + BUDDHIST_ERA_OFFSET;
  return `${format(parsed, 'MMMM', { locale: th })} ${year}`;
}

/** `16 ต.ค.` — compact axis labels on charts. */
export function formatThaiDayShort(instant: Date | string): string {
  const date = typeof instant === 'string' ? parseIsoUtc(instant) : instant;
  if (!date) return '—';
  return format(new Date(date.getTime() + BANGKOK_OFFSET_MS), 'd MMM', { locale: th });
}

/**
 * `3 วันที่แล้ว`, `เมื่อวาน`, `วันนี้` — relative phrasing for the staleness
 * warning and the dashboard's recent-updates list. Deliberately not
 * `formatDistanceToNow`: Thai relative-time wording is clearer written out.
 */
export function formatRelativeThai(instant: Date | string, now: Date = new Date()): string {
  const date = typeof instant === 'string' ? parseIsoUtc(instant) : instant;
  if (!date) return '—';

  const days = differenceInCalendarDaysBangkok(now, date);
  if (days <= 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  if (days < 30) return `${days} วันที่แล้ว`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;
  return `${Math.floor(months / 12)} ปีที่แล้ว`;
}

/** Whole Bangkok calendar days from `from` to `to`; negative when `to` is later. */
export function differenceInCalendarDaysBangkok(from: Date, to: Date): number {
  const a = Date.parse(`${bangkokDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${bangkokDateKey(to)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** Age in days of the newest snapshot, for the "ข้อมูลเก่า" warning. */
export function daysSince(instant: Date | string, now: Date = new Date()): number {
  const date = typeof instant === 'string' ? parseIsoUtc(instant) : instant;
  if (!date) return Number.POSITIVE_INFINITY;
  return differenceInCalendarDaysBangkok(now, date);
}

// ── periods ─────────────────────────────────────────────────────────────────

export type PeriodKind = 'week' | 'month' | 'custom';

/**
 * A reporting window as Bangkok date keys, inclusive at both ends.
 *
 * `start` and `end` are `YYYY-MM-DD`, so string comparison orders them
 * correctly and a SQL `BETWEEN` on a derived date column matches.
 */
export interface DateRange {
  start: string;
  end: string;
}

/** The Bangkok month containing `now`, as an inclusive range. */
export function monthRange(monthKey: string): DateRange {
  const first = `${monthKey}-01`;
  const next = addMonths(parse(first, 'yyyy-MM-dd', new Date()), 1);
  const lastDay = new Date(next.getTime() - 86_400_000);
  return { start: first, end: format(lastDay, 'yyyy-MM-dd') };
}

/** The Monday-start Bangkok week containing `dateKey`. */
export function weekRange(dateKey: string): DateRange {
  const date = parse(dateKey, 'yyyy-MM-dd', new Date());
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') };
}

/** The window immediately before `range`, of the same length. */
export function previousRange(range: DateRange): DateRange {
  const start = parse(range.start, 'yyyy-MM-dd', new Date());
  const end = parse(range.end, 'yyyy-MM-dd', new Date());
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  return { start: format(prevStart, 'yyyy-MM-dd'), end: format(prevEnd, 'yyyy-MM-dd') };
}

/** The month before `monthKey`. */
export function previousMonthKey(monthKey: string): string {
  const date = parse(`${monthKey}-01`, 'yyyy-MM-dd', new Date());
  return format(addMonths(date, -1), 'yyyy-MM');
}

/** Every month key in `[start, end]`, oldest first. */
export function monthsBetween(startKey: string, endKey: string): string[] {
  const months: string[] = [];
  let cursor = startKey.slice(0, 7);
  const last = endKey.slice(0, 7);
  // A hard bound prevents an unbounded loop if a caller passes a reversed range.
  for (let i = 0; i < 1200 && cursor <= last; i += 1) {
    months.push(cursor);
    cursor = format(addMonths(parse(`${cursor}-01`, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM');
  }
  return months;
}

/** The Monday-start week after `dateKey`, for stepping a forecast horizon. */
export function addWeeksKey(dateKey: string, count: number): string {
  return format(addWeeks(parse(dateKey, 'yyyy-MM-dd', new Date()), count), 'yyyy-MM-dd');
}

/** The month after `monthKey`, `count` times. */
export function addMonthsKey(monthKey: string, count: number): string {
  return format(addMonths(parse(`${monthKey}-01`, 'yyyy-MM-dd', new Date()), count), 'yyyy-MM');
}

/** True when `dateKey` falls inside `range`, both ends inclusive. */
export function isWithin(dateKey: string, range: DateRange): boolean {
  return dateKey >= range.start && dateKey <= range.end;
}
