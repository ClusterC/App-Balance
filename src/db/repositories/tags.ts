// Tags, and the transaction ↔ tag join.
//
// Tags are a light labelling layer over transactions only; snapshots and
// budgets carry no tags, so nothing here touches them.

import { execute, select } from '../connection';
import { toTag, type Tag, type TagRow } from '../types';

const COLUMNS = 'id, name, color, created_at, updated_at';

export async function listTags(): Promise<Tag[]> {
  const rows = await select<TagRow[]>(`SELECT ${COLUMNS} FROM tags ORDER BY name ASC`);
  return rows.map(toTag);
}

export async function createTag(name: string, color: string | null): Promise<number> {
  const result = await execute('INSERT INTO tags (name, color) VALUES ($1, $2)', [name, color]);
  return result.lastInsertId ?? 0;
}

export async function renameTag(id: number, name: string, color: string | null): Promise<void> {
  await execute(
    `UPDATE tags SET name = $1, color = $2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $3`,
    [name, color, id],
  );
}

/** Deleting a tag drops its links via `ON DELETE CASCADE`; the transactions stay. */
export async function deleteTag(id: number): Promise<void> {
  await execute('DELETE FROM tags WHERE id = $1', [id]);
}

export async function tagsForTransaction(transactionId: number): Promise<Tag[]> {
  const rows = await select<TagRow[]>(
    `SELECT t.id, t.name, t.color, t.created_at, t.updated_at
     FROM tags t
     JOIN transaction_tags tt ON tt.tag_id = t.id
     WHERE tt.transaction_id = $1
     ORDER BY t.name ASC`,
    [transactionId],
  );
  return rows.map(toTag);
}

export async function attachTag(transactionId: number, tagId: number): Promise<void> {
  await execute(
    'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES ($1, $2)',
    [transactionId, tagId],
  );
}

export async function detachTag(transactionId: number, tagId: number): Promise<void> {
  await execute('DELETE FROM transaction_tags WHERE transaction_id = $1 AND tag_id = $2', [
    transactionId,
    tagId,
  ]);
}

/** Tag ids per transaction, for the list view's chips. */
export async function tagIdsByTransaction(): Promise<Map<number, number[]>> {
  const rows = await select<{ transaction_id: number; tag_id: number }[]>(
    'SELECT transaction_id, tag_id FROM transaction_tags ORDER BY tag_id ASC',
  );
  const byTransaction = new Map<number, number[]>();
  for (const row of rows) {
    const list = byTransaction.get(row.transaction_id) ?? [];
    list.push(row.tag_id);
    byTransaction.set(row.transaction_id, list);
  }
  return byTransaction;
}
