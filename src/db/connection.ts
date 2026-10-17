// The single SQLite connection.
//
// `tauri-plugin-sql` keeps a connection *pool* on the Rust side and exposes no
// transaction API, so this module is for reads only. Anything that must write
// more than one row atomically — a transfer's two legs, a snapshot insert plus
// the delta recalculation it triggers — goes through a Rust command instead,
// which owns a real `sqlx` transaction. See `src/lib/commands.ts`.
//
// `Database.load` is also what applies the migrations: the Rust side registers
// them with `add_migrations`, and they run as a side effect of the first load.

import Database from '@tauri-apps/plugin-sql';

/**
 * Must match `DB_URL` in `src-tauri/src/lib.rs`. The path is relative to the
 * app data directory (`%APPDATA%\com.personal.balanceapp\`), which the plugin
 * resolves on the Rust side.
 */
export const DB_URL = 'sqlite:balance.db';

let connection: Promise<Database> | null = null;

/**
 * The database handle, loading it on first use.
 *
 * The promise — not the resolved instance — is cached, so two components
 * mounting at once cannot both trigger a load. A failed load is not cached, so
 * a transient failure can be retried rather than poisoning every later call.
 */
export function getDb(): Promise<Database> {
  connection ??= Database.load(DB_URL).catch((error: unknown) => {
    // A failed load must not be cached, or a transient failure would poison
    // every later call for the rest of the session.
    connection = null;
    throw error;
  });
  return connection;
}

/** Reads rows. `T` is the row shape, so pass an array type: `select<Row[]>`. */
export async function select<T>(query: string, params: unknown[] = []): Promise<T> {
  const db = await getDb();
  return db.select<T>(query, params);
}

/**
 * Runs a single statement.
 *
 * Only ever for a lone row. Multi-row atomicity is a Rust command's job — see
 * the module comment above.
 */
export async function execute(
  query: string,
  params: unknown[] = [],
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const db = await getDb();
  return db.execute(query, params);
}

/** Closes the pool. Used by the restore flow before the database file is swapped. */
export async function closeDb(): Promise<void> {
  const db = await getDb();
  await db.close(DB_URL);
  connection = null;
}
