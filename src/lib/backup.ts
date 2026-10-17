// Backup and restore.
//
// Both operations are Rust commands: they need the app data directory, the
// `dialog` plugin's native file picker, and — for a restore — the ability to
// close the SQL plugin's connection pool before the database file is replaced.
//
// The one thing this module adds is *ordering*. A restore is destructive, so
// the sequence is fixed here rather than left to a component:
//
//   1. inspect the archive and refuse early if this build cannot read it
//   2. let the Rust command write an automatic safety backup of the live file
//   3. only then swap, and restart
//
// Any failure before step 3 leaves the existing database untouched, and step 2
// means a user who restores the wrong file still has their data.

import { open, save } from '@tauri-apps/plugin-dialog';
import { closeDb } from '../db/connection';
import { recordBackup, recentBackups, type BackupRecord } from '../db/repositories/settings';
import {
  createBackup,
  inspectBackup,
  restartApp as restart,
  restoreBackup,
  type BackupInspection,
} from './commands';
import { todayKey } from '../domain/dates';
import { t } from '../i18n/th';

/** Default backup filename, e.g. `balance-backup-2026-10-16.zip`. */
export function defaultBackupName(dateKey: string): string {
  return `balance-backup-${dateKey}.zip`;
}

/**
 * Asks where to put a backup, then creates it.
 *
 * Returns the path written, or `null` when the user cancelled — a cancelled
 * save dialog is not a failure and must not surface as one.
 */
export async function backupToFile(): Promise<string | null> {
  const path = await save({
    title: t('settings.backupNow'),
    defaultPath: defaultBackupName(todayKey()),
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });

  if (path === null) return null;

  const manifest = await createBackup(path);

  // The manifest is authoritative for what went into the archive; the row is
  // written after the command reports success, so it describes a file that
  // demonstrably exists.
  await recordBackup({
    kind: 'manual_backup',
    filePath: path,
    sizeBytes: 0,
    schemaVersion: manifest.schema_version,
    appVersion: manifest.app_version,
    snapshotCount: manifest.counts.snapshots,
  });

  return path;
}

/** Asks for a backup file and inspects it. Returns `null` when cancelled. */
export async function chooseAndInspect(): Promise<{
  path: string;
  inspection: BackupInspection;
} | null> {
  const path = await open({
    title: t('settings.restoreChoose'),
    multiple: false,
    directory: false,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });

  // With `multiple: false` the plugin resolves to a string, but its type allows
  // an array, so both shapes are handled rather than asserting one.
  if (path === null || Array.isArray(path)) return null;

  const inspection = await inspectBackup(path);
  return { path, inspection };
}

/**
 * Replaces the live database with an archive.
 *
 * Order matters and is fixed here rather than left to a component:
 *
 *   1. the pool is closed, so the plugin is not holding the file being swapped
 *   2. the Rust command writes an automatic safety backup of the live database
 *   3. only then does it swap, and any failure rolls the original back
 *
 * Returns the safety backup's path, or `null` if there was nothing to back up.
 */
export async function restoreFromFile(path: string, appVersion: string): Promise<string | null> {
  await closeDb();

  const outcome = await restoreBackup(path, null);

  // Best-effort bookkeeping: the swap has already happened, so failing to
  // record it must not be reported to the user as a failed restore.
  try {
    await recordBackup({
      kind: 'restore',
      filePath: path,
      sizeBytes: 0,
      schemaVersion: outcome.manifest.schema_version,
      appVersion,
      snapshotCount: outcome.manifest.counts.snapshots,
    });
  } catch {
    // Deliberately ignored — see above.
  }

  return outcome.safety_backup_path;
}

/** Restarts the app, which the restore path requires to reopen the database. */
export async function restartApp(): Promise<void> {
  await restart();
}

export { recentBackups, type BackupRecord };
