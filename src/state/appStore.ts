// Application state.
//
// One small store rather than a query library. The data is a single local
// SQLite file, every page reads most of it, and the volumes are personal-scale
// (thousands of rows, not millions) — so loading it all once and re-reading
// after a mutation is both simpler and faster than per-page caching.
//
// Mutations go through `src/lib/commands.ts` where they must be atomic, and
// every mutating action here ends with a reload of the affected slice. Nothing
// is optimistically patched: the delta recalculation is authoritative and lives
// in Rust, so guessing its result in the UI would mean two sources of truth for
// the app's most important number.

import { create } from 'zustand';
import * as accountsRepo from '../db/repositories/accounts';
import * as categoriesRepo from '../db/repositories/categories';
import * as snapshotsRepo from '../db/repositories/snapshots';
import * as transactionsRepo from '../db/repositories/transactions';
import * as budgetsRepo from '../db/repositories/budgets';
import * as settingsRepo from '../db/repositories/settings';
import type { Account, Budget, Category, Transaction } from '../db/types';
import type { TimelineEntry } from '../db/repositories/snapshots';
import type { RecalculatedSnapshot } from '../domain/snapshots';
import { todayKey } from '../domain/dates';
import { t } from '../i18n/th';

export interface AppData {
  accounts: Account[];
  categories: Category[];
  snapshots: TimelineEntry[];
  transactions: Transaction[];
  budgets: Budget[];
  settings: settingsRepo.Settings;
  /** Snapshot count per account, so an empty state can tell "no history" apart. */
  snapshotCounts: Map<number, number>;
  /** Bangkok date keys that carry a transaction, per account — the double-count guard. */
  transactionDates: Map<number, Set<string>>;
  /** Snapshot ids a transaction names as its explanation. */
  linkedSnapshotIds: Set<number>;
}

interface AppState extends AppData {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  errorDetail: string | null;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  setError: (message: string, detail?: string) => void;
  clearError: () => void;
  saveSetting: <K extends keyof settingsRepo.Settings>(
    key: K,
    value: settingsRepo.Settings[K],
  ) => Promise<void>;
}

const EMPTY: AppData = {
  accounts: [],
  categories: [],
  snapshots: [],
  transactions: [],
  budgets: [],
  settings: settingsRepo.DEFAULT_SETTINGS,
  snapshotCounts: new Map(),
  transactionDates: new Map(),
  linkedSnapshotIds: new Set(),
};

/** Reads every table the app displays, in parallel. */
async function readAll(): Promise<AppData> {
  const [
    accounts,
    categories,
    snapshots,
    transactions,
    budgets,
    settings,
    snapshotCounts,
    transactionDates,
    linkedSnapshotIds,
  ] = await Promise.all([
    accountsRepo.listAccounts(),
    categoriesRepo.listCategories(true),
    snapshotsRepo.listSnapshots(),
    transactionsRepo.listTransactions(),
    budgetsRepo.listBudgets(),
    settingsRepo.readAllSettings(),
    snapshotsRepo.snapshotCounts(),
    transactionsRepo.transactionDatesByAccount(),
    transactionsRepo.linkedSnapshotIds(),
  ]);

  return {
    accounts,
    categories,
    snapshots,
    transactions,
    budgets,
    settings,
    snapshotCounts,
    transactionDates,
    linkedSnapshotIds,
  };
}

/**
 * Describes a failure for the error banner.
 *
 * A `CommandError` from Rust already carries a Thai sentence written for the
 * user; anything else is an unexpected JavaScript failure and gets the generic
 * Thai text, with the real message kept as technical detail so it is not lost.
 */
function describeError(error: unknown): { message: string; detail: string } {
  if (error instanceof Error && error.name === 'CommandError') {
    const detail = (error as Error & { detail?: unknown }).detail;
    return {
      message: error.message,
      detail: typeof detail === 'string' ? detail : error.message,
    };
  }

  // A database that cannot be opened is the one failure worth naming
  // specifically, because the user's next step is different from a retry.
  const text = error instanceof Error ? error.message : String(error);
  return { message: t('errors.loadFailed'), detail: text };
}

export const useAppStore = create<AppState>((set, get) => ({
  ...EMPTY,
  status: 'idle',
  error: null,
  errorDetail: null,

  async load() {
    set({ status: 'loading', error: null, errorDetail: null });
    try {
      set({ ...(await readAll()), status: 'ready' });
    } catch (error) {
      const { message, detail } = describeError(error);
      set({ status: 'error', error: message, errorDetail: detail });
    }
  },

  async reload() {
    try {
      set({ ...(await readAll()), error: null, errorDetail: null });
    } catch (error) {
      const { message, detail } = describeError(error);
      set({ error: message, errorDetail: detail });
    }
  },

  setError(message, detail) {
    set({ error: message, errorDetail: detail ?? null });
  },

  clearError() {
    set({ error: null, errorDetail: null });
  },

  async saveSetting(key, value) {
    await settingsRepo.writeSetting(key, value);
    set({ settings: { ...get().settings, [key]: value } });
  },
}));

// ── selectors ───────────────────────────────────────────────────────────────
//
// Kept as plain functions over the state rather than hooks that build new
// objects, so a component re-renders only when the data it actually reads
// changes.

export function activeAccounts(state: AppData): Account[] {
  return state.accounts.filter((account) => !account.isArchived);
}

export function archivedAccounts(state: AppData): Account[] {
  return state.accounts.filter((account) => account.isArchived);
}

export function expenseCategories(state: AppData): Category[] {
  return state.categories.filter((category) => category.kind === 'expense' && !category.isArchived);
}

export function incomeCategories(state: AppData): Category[] {
  return state.categories.filter((category) => category.kind === 'income' && !category.isArchived);
}

export function accountById(state: AppData, id: number): Account | undefined {
  return state.accounts.find((account) => account.id === id);
}

export function categoryById(state: AppData, id: number | null): Category | undefined {
  return id === null ? undefined : state.categories.find((category) => category.id === id);
}

/** The account's snapshots as the domain layer wants them. */
export function snapshotsFor(state: AppData, accountId: number): RecalculatedSnapshot[] {
  return snapshotsRepo.toRecalculated(
    state.snapshots.filter((snapshot) => snapshot.accountId === accountId),
  );
}

export function allSnapshotsAsDomain(state: AppData): RecalculatedSnapshot[] {
  return snapshotsRepo.toRecalculated(state.snapshots);
}

/** The current Bangkok month key, which is the default period everywhere. */
export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}

/** Accounts whose currency is not THB, so the UI can warn about the sum. */
export function foreignCurrencyAccounts(state: AppData): Account[] {
  return activeAccounts(state).filter((account) => account.currency !== 'THB');
}
