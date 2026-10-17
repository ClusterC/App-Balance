// Row shapes and row → domain mappers.
//
// Every table stores money as an INTEGER count of satang and timestamps as ISO
// 8601 UTC text, so the mappers here are mostly about turning SQLite's `0`/`1`
// integers into booleans and narrowing `TEXT` into the union types the domain
// layer expects. Nothing else is transformed: a mapper must never do maths on a
// balance or reinterpret a timestamp, because that is where a silent money bug
// would live.

import type { Satang } from '../domain/money';
import type { UpdateType } from '../domain/snapshots';

/** SQLite has no boolean type; every flag column is a 0/1 INTEGER. */
export type SqlFlag = 0 | 1;

export type AccountType = 'bank' | 'cash' | 'ewallet' | 'credit_card' | 'other';

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'bank',
  'cash',
  'ewallet',
  'credit_card',
  'other',
];

export type CategoryKind = 'income' | 'expense';

export type TransactionKind = 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'adjustment';

export type BackupKind = 'manual_backup' | 'auto_safety' | 'restore';

// ── rows as they come back from SQLite ──────────────────────────────────────

export interface AccountRow {
  id: number;
  name: string;
  institution: string | null;
  account_type: string;
  number_suffix: string | null;
  color: string | null;
  icon: string | null;
  currency: string;
  opening_balance_satang: number;
  opening_date: string;
  credit_limit_satang: number | null;
  is_liability: SqlFlag;
  is_archived: SqlFlag;
  archived_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: number;
  name: string;
  kind: string;
  icon: string | null;
  color: string | null;
  is_archived: SqlFlag;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SnapshotRow {
  id: number;
  account_id: number;
  balance_satang: number;
  effective_at: string;
  update_type: string;
  category_id: number | null;
  note: string | null;
  derived_delta_satang: number | null;
  prev_snapshot_id: number | null;
  is_classified: SqlFlag;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: number;
  account_id: number;
  kind: string;
  amount_satang: number;
  currency: string;
  category_id: number | null;
  occurred_at: string;
  note: string | null;
  transfer_group_id: string | null;
  linked_snapshot_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetRow {
  id: number;
  category_id: number;
  period_start: string;
  amount_satang: number;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: number;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface ImportExportRow {
  id: number;
  kind: string;
  file_path: string;
  size_bytes: number;
  schema_version: number;
  app_version: string;
  snapshot_count: number;
  created_at: string;
}

// ── domain shapes ───────────────────────────────────────────────────────────

export interface Account {
  id: number;
  name: string;
  institution: string | null;
  accountType: AccountType;
  numberSuffix: string | null;
  color: string | null;
  icon: string | null;
  currency: string;
  openingBalanceSatang: Satang;
  openingDate: string;
  creditLimitSatang: Satang | null;
  isLiability: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
  isArchived: boolean;
  position: number;
}

export interface Transaction {
  id: number;
  accountId: number;
  kind: TransactionKind;
  amountSatang: Satang;
  currency: string;
  categoryId: number | null;
  occurredAt: string;
  note: string | null;
  transferGroupId: string | null;
  linkedSnapshotId: number | null;
}

export interface Budget {
  id: number;
  categoryId: number;
  periodStart: string;
  amountSatang: Satang;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
}

// ── mappers ─────────────────────────────────────────────────────────────────

/** Narrows an unknown `TEXT` into a union, falling back rather than throwing. */
function asUnion<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const ACCOUNT_TYPE_VALUES = ACCOUNT_TYPES;
const CATEGORY_KIND_VALUES = ['income', 'expense'] as const;
const TRANSACTION_KIND_VALUES = [
  'income',
  'expense',
  'transfer_in',
  'transfer_out',
  'adjustment',
] as const;
const UPDATE_TYPE_VALUES = [
  'income',
  'expense',
  'transfer_in',
  'transfer_out',
  'adjustment',
  'unknown',
] as const;

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    accountType: asUnion(row.account_type, ACCOUNT_TYPE_VALUES, 'other'),
    numberSuffix: row.number_suffix,
    color: row.color,
    icon: row.icon,
    currency: row.currency,
    openingBalanceSatang: row.opening_balance_satang,
    openingDate: row.opening_date,
    creditLimitSatang: row.credit_limit_satang,
    isLiability: row.is_liability === 1,
    isArchived: row.is_archived === 1,
    archivedAt: row.archived_at,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    kind: asUnion(row.kind, CATEGORY_KIND_VALUES, 'expense'),
    icon: row.icon,
    color: row.color,
    isArchived: row.is_archived === 1,
    position: row.position,
  };
}

/**
 * Maps a snapshot row into the shape `src/domain/snapshots.ts` works with.
 *
 * A `NULL` derived delta becomes `0` rather than `null`: the column is only
 * ever null on a row written outside a recalculation, and the domain's
 * arithmetic would rather see a zero than propagate a null through a total.
 */
export function toSnapshot(row: SnapshotRow): {
  id: number;
  accountId: number;
  balanceSatang: Satang;
  effectiveAt: string;
  updateType: UpdateType;
  categoryId: number | null;
  note: string | null;
  derivedDeltaSatang: Satang;
  prevSnapshotId: number | null;
  isClassified: boolean;
} {
  return {
    id: row.id,
    accountId: row.account_id,
    balanceSatang: row.balance_satang,
    effectiveAt: row.effective_at,
    updateType: asUnion(row.update_type, UPDATE_TYPE_VALUES, 'unknown'),
    categoryId: row.category_id,
    note: row.note,
    derivedDeltaSatang: row.derived_delta_satang ?? 0,
    prevSnapshotId: row.prev_snapshot_id,
    isClassified: row.is_classified === 1,
  };
}

export function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: asUnion(row.kind, TRANSACTION_KIND_VALUES, 'adjustment'),
    amountSatang: row.amount_satang,
    currency: row.currency,
    categoryId: row.category_id,
    occurredAt: row.occurred_at,
    note: row.note,
    transferGroupId: row.transfer_group_id,
    linkedSnapshotId: row.linked_snapshot_id,
  };
}

export function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    categoryId: row.category_id,
    periodStart: row.period_start,
    amountSatang: row.amount_satang,
  };
}

export function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color };
}

export { asUnion };
