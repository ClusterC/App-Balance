// CSV export.
//
// The file itself is written by a Rust command, for one reason: it must begin
// with a UTF-8 BOM, or Excel on Windows decodes it with the system ANSI
// codepage and renders every Thai character as mojibake. This module decides
// *what* to export, formats the cells, asks the user where to put it, and
// records nothing — an export is a read of the database, not a change to it.

import { save } from '@tauri-apps/plugin-dialog';
import { exportCsv, type CsvCell } from './commands';
import { satangToDecimalString } from '../domain/money';
import { bangkokDateKey, bangkokTimeOfDay, formatThaiDate } from '../domain/dates';
import { t } from '../i18n/th';
import type { Account, Category, Transaction } from '../db/types';
import type { SnapshotDetail } from '../db/repositories/snapshots';

/** One exportable dataset, as a table plus a default filename. */
export interface CsvTable {
  headers: string[];
  rows: CsvCell[][];
}

export type ExportKind = 'accounts' | 'snapshots' | 'transactions' | 'categories' | 'period';

/** Default filename, e.g. `balance-snapshots-2026-10-16.csv`. */
export function defaultFilename(kind: ExportKind, dateKey: string): string {
  return `balance-${kind}-${dateKey}.csv`;
}

/**
 * Asks for a destination and writes the table.
 *
 * Returns the path written, or `null` when the user cancelled the dialog —
 * a cancellation is not an error and must not surface as one.
 */
export async function exportTable(
  kind: ExportKind,
  table: CsvTable,
  todayKey: string,
): Promise<string | null> {
  const path = await save({
    title: t('export.saveTitle'),
    defaultPath: defaultFilename(kind, todayKey),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (path === null) return null;
  return exportCsv({ path, headers: table.headers, rows: table.rows });
}

// ── cell formatting ─────────────────────────────────────────────────────────
//
// Money is written as a plain decimal string with no thousands separator and no
// currency symbol, so a spreadsheet treats it as a number rather than as text.
// `satangToDecimalString` is exact — the value never passes through a float.

/** `123456` → `1234.56`, as a number so Excel right-aligns and can sum it. */
export function moneyCell(satang: number): string {
  return satangToDecimalString(satang);
}

/** An ISO timestamp rendered as a Bangkok date and time, for a human reader. */
export function dateCell(isoUtc: string): string {
  return formatThaiDate(isoUtc);
}

export function timeCell(isoUtc: string): string {
  return bangkokTimeOfDay(new Date(isoUtc));
}

/** `YYYY-MM-DD` in Bangkok, which is the form a spreadsheet can sort. */
export function dateKeyCell(isoUtc: string): string {
  return bangkokDateKey(isoUtc);
}

// ── table builders ──────────────────────────────────────────────────────────

export function accountsTable(accounts: readonly Account[]): CsvTable {
  return {
    headers: [
      'ชื่อบัญชี',
      'สถาบัน',
      'ประเภท',
      'เลขท้าย',
      'สกุลเงิน',
      'ยอดยกมา',
      'วันที่ยกมา',
      'วงเงินบัตร',
      'เป็นหนี้สิน',
      'เก็บเข้าคลัง',
    ],
    rows: accounts.map((account) => [
      account.name,
      account.institution,
      t(`accountType.${account.accountType}`),
      account.numberSuffix,
      account.currency,
      moneyCell(account.openingBalanceSatang),
      account.openingDate,
      account.creditLimitSatang === null ? null : moneyCell(account.creditLimitSatang),
      account.isLiability ? 'ใช่' : 'ไม่',
      account.isArchived ? 'ใช่' : 'ไม่',
    ]),
  };
}

export function snapshotsTable(snapshots: readonly SnapshotDetail[]): CsvTable {
  return {
    headers: [
      'วันที่',
      'เวลา',
      'บัญชี',
      'ยอดคงเหลือ',
      'ส่วนต่าง',
      'ประเภท',
      'หมวดหมู่',
      'จัดหมวดแล้ว',
      'บันทึก',
    ],
    rows: snapshots.map((snapshot) => [
      dateKeyCell(snapshot.effectiveAt),
      timeCell(snapshot.effectiveAt),
      snapshot.accountName,
      moneyCell(snapshot.balanceSatang),
      moneyCell(snapshot.derivedDeltaSatang),
      t(`updateType.${snapshot.updateType}`),
      snapshot.categoryName,
      snapshot.isClassified ? 'ใช่' : 'ไม่',
      snapshot.note,
    ]),
  };
}

export function transactionsTable(transactions: readonly Transaction[]): CsvTable {
  return {
    headers: ['วันที่', 'เวลา', 'บัญชี', 'ประเภท', 'จำนวนเงิน', 'สกุลเงิน', 'บันทึก'],
    rows: transactions.map((transaction) => [
      dateKeyCell(transaction.occurredAt),
      timeCell(transaction.occurredAt),
      String(transaction.accountId),
      t(`transactionKind.${transaction.kind}`),
      moneyCell(transaction.amountSatang),
      transaction.currency,
      transaction.note,
    ]),
  };
}

export function categoriesTable(categories: readonly Category[]): CsvTable {
  return {
    headers: ['ชื่อหมวดหมู่', 'ประเภท', 'เก็บเข้าคลัง', 'ลำดับ'],
    rows: categories.map((category) => [
      category.name,
      t(`categoryKind.${category.kind}`),
      category.isArchived ? 'ใช่' : 'ไม่',
      String(category.position),
    ]),
  };
}

/** A period report: one labelled row per figure, so Excel needs no reshaping. */
export function periodTable(rows: readonly (readonly [string, CsvCell])[]): CsvTable {
  return {
    headers: ['รายการ', 'จำนวนเงิน'],
    rows: rows.map(([label, value]) => [label, value]),
  };
}
