// Typed wrappers around the Rust commands.
//
// These are the *only* place the frontend calls `invoke`, so the argument names
// and result shapes are declared once. Tauri serialises command arguments by
// name, and a struct's field names come through as written in Rust — the `db`
// commands use `#[serde(rename_all = "camelCase")]` while `backup`, `csv` and
// `app_info` do not, so the types below deliberately mix conventions to match
// what each command actually sends.
//
// Why these commands exist at all, rather than SQL from the frontend: the SQL
// plugin exposes a connection *pool* with no transaction API, and the spec
// requires multi-record writes to be atomic. Anything that writes more than one
// row — a transfer's two legs, a snapshot plus the delta recalculation it
// triggers — is a command here that owns a real `sqlx` transaction.

import { invoke } from '@tauri-apps/api/core';
import type { UpdateType } from '../domain/snapshots';

// ── errors ──────────────────────────────────────────────────────────────────

/**
 * A failed command, as the Rust `AppError` serialiser sends it.
 *
 * `message` is the Thai sentence meant for the user; `detail` is the technical
 * form, logged and shown behind a "รายละเอียดทางเทคนิค" disclosure rather than
 * in the snackbar.
 */
export class CommandError extends Error {
  readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.name = 'CommandError';
    this.detail = detail;
  }
}

/**
 * Turns anything `invoke` rejected with into a `CommandError`.
 *
 * Tauri rejects with the serialised payload, but a failure before the command
 * runs (a missing capability, a panic) rejects with a plain string, so both
 * shapes are handled rather than letting an untyped value reach a component.
 */
function toCommandError(error: unknown): CommandError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    const { message, detail } = error as { message: string; detail?: unknown };
    return new CommandError(message, typeof detail === 'string' ? detail : message);
  }

  const text = typeof error === 'string' ? error : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  return new CommandError(text, text);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toCommandError(error);
  }
}

// ── app info ────────────────────────────────────────────────────────────────

/** Matches `AppInfo` in `commands/mod.rs`, which does not rename its fields. */
export interface AppInfo {
  name: string;
  version: string;
  schema_version: number;
  repository_url: string;
  database_path: string;
}

export function appInfo(): Promise<AppInfo> {
  return call<AppInfo>('app_info');
}

/** Restarts the process. Required after a restore; see `lib/backup.ts`. */
export function restartApp(): Promise<null> {
  return call<null>('restart_app');
}

// ── snapshots ───────────────────────────────────────────────────────────────

export interface SnapshotInput {
  /** Omitted to insert; present to update. */
  id?: number;
  accountId: number;
  balanceSatang: number;
  effectiveAt: string;
  updateType: UpdateType;
  categoryId: number | null;
  note: string | null;
}

/** Matches `SnapshotRow` — camelCase, because that struct renames its fields. */
export interface SnapshotMutationRow {
  id: number;
  accountId: number;
  balanceSatang: number;
  effectiveAt: string;
  updateType: UpdateType;
  categoryId: number | null;
  note: string | null;
  derivedDeltaSatang: number;
  prevSnapshotId: number | null;
  isClassified: boolean;
}

export interface SnapshotMutationResult {
  snapshotId: number;
  /** How many rows had their derived columns rewritten. */
  recalculated: number;
  /** The account's full timeline, already recalculated. */
  snapshots: SnapshotMutationRow[];
}

export function saveSnapshot(snapshot: SnapshotInput): Promise<SnapshotMutationResult> {
  return call<SnapshotMutationResult>('save_snapshot', { snapshot });
}

export function deleteSnapshot(
  accountId: number,
  snapshotId: number,
): Promise<SnapshotMutationResult> {
  return call<SnapshotMutationResult>('delete_snapshot', {
    accountId,
    snapshotId,
  });
}

export function classifySnapshot(
  accountId: number,
  snapshotId: number,
  updateType: UpdateType,
  categoryId: number | null,
  note: string | null,
): Promise<SnapshotMutationResult> {
  return call<SnapshotMutationResult>('classify_snapshot', {
    accountId,
    snapshotId,
    updateType,
    categoryId,
    note,
  });
}

// ── transfers ───────────────────────────────────────────────────────────────

export interface TransferRequest {
  fromAccountId: number;
  toAccountId: number;
  /** Always a positive magnitude; the sign comes from each leg's kind. */
  amountSatang: number;
  occurredAt: string;
  note: string | null;
  /** When true, a matching pair of snapshots is written and linked. */
  mirrorSnapshots: boolean;
  fromBalanceSatang: number | null;
  toBalanceSatang: number | null;
}

export interface TransferResult {
  transferGroupId: string;
  outTransactionId: number;
  inTransactionId: number;
  createdSnapshots: number;
}

export function createTransfer(request: TransferRequest): Promise<TransferResult> {
  return call<TransferResult>('create_transfer', { request });
}

export function deleteTransfer(transferGroupId: string): Promise<number> {
  return call<number>('delete_transfer', { transferGroupId });
}

// ── destructive maintenance ─────────────────────────────────────────────────
//
// The Rust commands below return `()`, which serialises to `null`. They are
// typed as `Promise<null>` rather than `Promise<void>` so the resolved value is
// described honestly; callers ignore it either way.

/** Fails while transactions reference the account; archive instead. */
export function purgeAccount(accountId: number): Promise<null> {
  return call<null>('purge_account', { accountId });
}

/** Wipes every user table and restores the default categories. */
export function purgeAllData(): Promise<null> {
  return call<null>('purge_all_data');
}

// ── budgets and categories ──────────────────────────────────────────────────

export interface BudgetRequest {
  id?: number;
  categoryId: number;
  /** `YYYY-MM-01`. */
  periodStart: string;
  amountSatang: number;
}

export function saveBudget(budget: BudgetRequest): Promise<number> {
  return call<number>('save_budget', { budget });
}

export function reorderCategory(categoryId: number, direction: 'up' | 'down'): Promise<null> {
  return call<null>('reorder_category', { categoryId, direction });
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * A CSV cell.
 *
 * The Rust side tags these by shape, so a number is written unquoted and a
 * string is RFC-4180 escaped. `null` becomes an empty field.
 */
export type CsvCell = string | number | null;

export interface CsvPayload {
  path: string;
  headers: string[];
  rows: CsvCell[][];
}

/** Writes UTF-8-with-BOM CSV and returns the path written. */
export function exportCsv(payload: CsvPayload): Promise<string> {
  return call<string>('export_csv', { payload });
}

// ── backup and restore ──────────────────────────────────────────────────────

/** Matches `TableCounts` — snake_case, as that struct does not rename. */
export interface TableCounts {
  accounts: number;
  categories: number;
  snapshots: number;
  transactions: number;
  budgets: number;
}

export interface BackupManifest {
  app_name: string;
  app_version: string;
  schema_version: number;
  created_at: string;
  counts: TableCounts;
  checksum: string;
}

export interface BackupInspection {
  manifest: BackupManifest;
  /** False when this build cannot restore the archive. */
  compatible: boolean;
  /** Thai explanation, present when `compatible` is false. */
  reason: string | null;
}

export interface RestoreOutcome {
  safety_backup_path: string | null;
  manifest: BackupManifest;
}

export function createBackup(path: string): Promise<BackupManifest> {
  return call<BackupManifest>('create_backup', { path });
}

export function inspectBackup(path: string): Promise<BackupInspection> {
  return call<BackupInspection>('inspect_backup', { path });
}

/**
 * Replaces the live database with an archive's contents.
 *
 * The command writes a safety backup of the current database first, and any
 * failure before the swap leaves the existing file untouched. The app must be
 * restarted afterwards, because the SQL plugin's pool still points at the old
 * file handle.
 */
export function restoreBackup(path: string, safetyPath: string | null): Promise<RestoreOutcome> {
  return call<RestoreOutcome>('restore_backup', { path, safetyPath });
}

// ── development seed ────────────────────────────────────────────────────────

export interface SeedResult {
  accounts: number;
  snapshots: number;
  transactions: number;
  budgets: number;
}

/** Refused in a release build, and refused when any account already exists. */
export function seedDevData(): Promise<SeedResult> {
  return call<SeedResult>('seed_dev_data');
}
