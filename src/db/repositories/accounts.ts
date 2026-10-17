// Accounts.
//
// Every statement is parameterised. The only strings interpolated into SQL
// anywhere in this file are column names from a fixed `const` list, never
// anything that came from a user.

import { execute, select } from '../connection';
import { toAccount, type Account, type AccountRow, type AccountType } from '../types';

const COLUMNS =
  'id, name, institution, account_type, number_suffix, color, icon, currency, ' +
  'opening_balance_satang, opening_date, credit_limit_satang, is_liability, ' +
  'is_archived, archived_at, position, created_at, updated_at';

export interface AccountDraft {
  name: string;
  institution: string | null;
  accountType: AccountType;
  numberSuffix: string | null;
  color: string | null;
  icon: string | null;
  currency: string;
  openingBalanceSatang: number;
  openingDate: string;
  creditLimitSatang: number | null;
  isLiability: boolean;
}

/** Active accounts first, then archived, each in the user's chosen order. */
export async function listAccounts(): Promise<Account[]> {
  const rows = await select<AccountRow[]>(
    `SELECT ${COLUMNS} FROM accounts ORDER BY is_archived ASC, position ASC, id ASC`,
  );
  return rows.map(toAccount);
}

export async function getAccount(id: number): Promise<Account | null> {
  const rows = await select<AccountRow[]>(`SELECT ${COLUMNS} FROM accounts WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? toAccount(row) : null;
}

export async function createAccount(draft: AccountDraft): Promise<number> {
  const position = await nextPosition();
  const result = await execute(
    `INSERT INTO accounts
       (name, institution, account_type, number_suffix, color, icon, currency,
        opening_balance_satang, opening_date, credit_limit_satang, is_liability,
        is_archived, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12)`,
    [
      draft.name,
      draft.institution,
      draft.accountType,
      draft.numberSuffix,
      draft.color,
      draft.icon,
      draft.currency,
      draft.openingBalanceSatang,
      draft.openingDate,
      draft.creditLimitSatang,
      draft.isLiability ? 1 : 0,
      position,
    ],
  );
  return result.lastInsertId ?? 0;
}

/**
 * Updates an account's editable fields.
 *
 * The opening balance and opening date are deliberately included: they seed the
 * delta chain, and a user who mistyped the starting balance needs to fix it.
 * The Rust recalculation runs after any snapshot change, so the next read of
 * the timeline reflects the new seed.
 */
export async function updateAccount(id: number, draft: AccountDraft): Promise<void> {
  await execute(
    `UPDATE accounts SET
       name = $1, institution = $2, account_type = $3, number_suffix = $4,
       color = $5, icon = $6, currency = $7, opening_balance_satang = $8,
       opening_date = $9, credit_limit_satang = $10, is_liability = $11,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $12`,
    [
      draft.name,
      draft.institution,
      draft.accountType,
      draft.numberSuffix,
      draft.color,
      draft.icon,
      draft.currency,
      draft.openingBalanceSatang,
      draft.openingDate,
      draft.creditLimitSatang,
      draft.isLiability ? 1 : 0,
      id,
    ],
  );
}

/** Archives rather than deletes: history referencing the account stays readable. */
export async function archiveAccount(id: number): Promise<void> {
  await execute(
    `UPDATE accounts SET is_archived = 1, archived_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $1`,
    [id],
  );
}

export async function restoreAccount(id: number): Promise<void> {
  await execute(
    `UPDATE accounts SET is_archived = 0, archived_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $1`,
    [id],
  );
}

export async function reorderAccount(id: number, position: number): Promise<void> {
  await execute(
    `UPDATE accounts SET position = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = $2`,
    [position, id],
  );
}

async function nextPosition(): Promise<number> {
  const rows = await select<{ next: number }[]>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM accounts',
  );
  return rows[0]?.next ?? 0;
}
