// Categories.
//
// Categories are never deleted while anything references them — the UI archives
// instead, which is what the spec's "blocked while referenced" rule means in
// practice. `deleteCategory` below is therefore only reachable for a category
// nothing points at, and the caller is expected to have checked.

import { execute, select } from '../connection';
import { toCategory, type Category, type CategoryKind, type CategoryRow } from '../types';

const COLUMNS = 'id, name, kind, icon, color, is_archived, position, created_at, updated_at';

export interface CategoryDraft {
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
}

export async function listCategories(includeArchived = false): Promise<Category[]> {
  const rows = await select<CategoryRow[]>(
    `SELECT ${COLUMNS} FROM categories
     WHERE ($1 = 1 OR is_archived = 0)
     ORDER BY kind ASC, position ASC, id ASC`,
    [includeArchived ? 1 : 0],
  );
  return rows.map(toCategory);
}

export async function getCategory(id: number): Promise<Category | null> {
  const rows = await select<CategoryRow[]>(`SELECT ${COLUMNS} FROM categories WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? toCategory(row) : null;
}

export async function createCategory(draft: CategoryDraft): Promise<number> {
  const position = await nextPosition(draft.kind);
  const result = await execute(
    `INSERT INTO categories (name, kind, icon, color, is_archived, position)
     VALUES ($1, $2, $3, $4, 0, $5)`,
    [draft.name, draft.kind, draft.icon, draft.color, position],
  );
  return result.lastInsertId ?? 0;
}

export async function updateCategory(id: number, draft: CategoryDraft): Promise<void> {
  await execute(
    `UPDATE categories SET name = $1, kind = $2, icon = $3, color = $4,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $5`,
    [draft.name, draft.kind, draft.icon, draft.color, id],
  );
}

export async function archiveCategory(id: number): Promise<void> {
  await execute(
    `UPDATE categories SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $1`,
    [id],
  );
}

export async function restoreCategory(id: number): Promise<void> {
  await execute(
    `UPDATE categories SET is_archived = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $1`,
    [id],
  );
}

/** How many snapshots, transactions and budgets point at this category. */
export interface CategoryUsage {
  snapshots: number;
  transactions: number;
  budgets: number;
}

/**
 * Counts what references a category.
 *
 * The UI calls this before offering deletion, and shows the counts in the Thai
 * explanation of why archiving is the only option when any is non-zero.
 */
export async function categoryUsage(id: number): Promise<CategoryUsage> {
  const rows = await select<{ snapshots: number; transactions: number; budgets: number }[]>(
    `SELECT
       (SELECT count(*) FROM balance_snapshots WHERE category_id = $1) AS snapshots,
       (SELECT count(*) FROM transactions      WHERE category_id = $1) AS transactions,
       (SELECT count(*) FROM budgets           WHERE category_id = $1) AS budgets`,
    [id],
  );
  return rows[0] ?? { snapshots: 0, transactions: 0, budgets: 0 };
}

/**
 * Deletes a category outright.
 *
 * Callers must have checked `categoryUsage` first. The schema's foreign keys
 * are `ON DELETE SET NULL` for snapshots and transactions and `ON DELETE
 * CASCADE` for budgets, so a mistaken call would quietly orphan history rather
 * than fail — which is exactly why the UI only ever archives.
 */
export async function deleteCategory(id: number): Promise<void> {
  await execute('DELETE FROM categories WHERE id = $1', [id]);
}

async function nextPosition(kind: CategoryKind): Promise<number> {
  const rows = await select<{ next: number }[]>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM categories WHERE kind = $1',
    [kind],
  );
  return rows[0]?.next ?? 0;
}
