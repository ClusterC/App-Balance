// Application settings.
//
// Values are stored as JSON text in `app_settings`, one row per key. This module
// is the only place that knows how each value is encoded, so a caller deals in
// real types and never in a JSON string. A value that fails to parse is treated
// as absent and the default is returned — a corrupt setting must not stop the
// app from starting.

import { execute, select } from '../connection';
import type { SettingRow } from '../types';

/**
 * The settings the app actually reads.
 *
 * A key is added here only when something consumes it; a settings table full of
 * keys nothing reads is a maintenance cost with no user benefit.
 */
export interface Settings {
  /** Days after which an account's balance is called stale. */
  stalenessThresholdDays: number;
  /** The colour-scheme preference, persisted so it survives a restart. */
  themeMode: 'light' | 'dark' | 'system';
  /** Whether the "possible double count" banner has been dismissed. */
  doubleCountBannerDismissed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  stalenessThresholdDays: 30,
  themeMode: 'system',
  doubleCountBannerDismissed: false,
};

export async function readSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const rows = await select<SettingRow[]>('SELECT key, value, updated_at FROM app_settings WHERE key = $1', [
    key,
  ]);
  const raw = rows[0]?.value;
  if (raw === undefined) return DEFAULT_SETTINGS[key];

  try {
    const parsed: unknown = JSON.parse(raw);
    return coerce(key, parsed) ?? DEFAULT_SETTINGS[key];
  } catch {
    // Not valid JSON: fall back rather than propagating a parse error into a
    // component that only wanted a number.
    return DEFAULT_SETTINGS[key];
  }
}

export async function writeSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  await execute(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value)],
  );
}

export async function readAllSettings(): Promise<Settings> {
  const rows = await select<SettingRow[]>('SELECT key, value, updated_at FROM app_settings');
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const result: Settings = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const raw = stored.get(key);
    if (raw === undefined) continue;
    try {
      const coerced = coerce(key, JSON.parse(raw) as unknown);
      if (coerced !== null) {
        // The cast is sound because `coerce` only returns a value when it
        // matched the type that key declares, and both are driven by `key`.
        Object.assign(result, { [key]: coerced });
      }
    } catch {
      // Keep the default for this key only.
    }
  }

  return result;
}

/**
 * Validates a parsed JSON value against the type its key declares.
 *
 * Returns `null` for anything that does not match, so `readAllSettings` can
 * keep the default. Unknown keys are ignored: a value written by a newer build
 * is not this build's business.
 */
function coerce<K extends keyof Settings>(key: K, value: unknown): Settings[K] | null {
  switch (key) {
    case 'stalenessThresholdDays':
      return (
        typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
          ? value
          : null
      ) as Settings[K] | null;
    case 'themeMode':
      return (
        value === 'light' || value === 'dark' || value === 'system' ? value : null
      ) as Settings[K] | null;
    case 'doubleCountBannerDismissed':
      return (typeof value === 'boolean' ? value : null) as Settings[K] | null;
    default:
      return null;
  }
}

// ── backup bookkeeping ──────────────────────────────────────────────────────

export interface BackupRecord {
  id: number;
  kind: string;
  filePath: string;
  sizeBytes: number;
  schemaVersion: number;
  appVersion: string;
  snapshotCount: number;
  createdAt: string;
}

/** Recent backups, newest first, for the backup page's history list. */
export async function recentBackups(limit = 20): Promise<BackupRecord[]> {
  const rows = await select<
    {
      id: number;
      kind: string;
      file_path: string;
      size_bytes: number;
      schema_version: number;
      app_version: string;
      snapshot_count: number;
      created_at: string;
    }[]
  >(
    `SELECT id, kind, file_path, size_bytes, schema_version, app_version, snapshot_count, created_at
     FROM import_export_metadata ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    schemaVersion: row.schema_version,
    appVersion: row.app_version,
    snapshotCount: row.snapshot_count,
    createdAt: row.created_at,
  }));
}

/**
 * Records a backup or restore in the history table.
 *
 * `created_at` is left to the column default, so the row is stamped by the
 * database at insert time. Written after the Rust command reports success, so
 * the row describes a file that demonstrably exists on disk.
 */
export async function recordBackup(
  record: Omit<BackupRecord, 'id' | 'createdAt'>,
): Promise<void> {
  await execute(
    `INSERT INTO import_export_metadata
       (kind, file_path, size_bytes, schema_version, app_version, snapshot_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      record.kind,
      record.filePath,
      record.sizeBytes,
      record.schemaVersion,
      record.appVersion,
      record.snapshotCount,
    ],
  );
}
