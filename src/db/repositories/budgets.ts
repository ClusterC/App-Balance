// Budgets.
//
// Writes go through the Rust `save_budget` command, which validates that the
// category is an *expense* category — a budget on "เงินเดือน" is meaningless,
// and the check belongs next to the write rather than in a form.

import { execute, select } from '../connection';
import { toBudget, type Budget, type BudgetRow } from '../types';

const COLUMNS = 'id, category_id, period_start, amount_satang, created_at, updated_at';

export async function listBudgets(periodStart?: string): Promise<Budget[]> {
  const rows =
    periodStart === undefined
      ? await select<BudgetRow[]>(
          `SELECT ${COLUMNS} FROM budgets ORDER BY period_start DESC, category_id ASC`,
        )
      : await select<BudgetRow[]>(
          `SELECT ${COLUMNS} FROM budgets WHERE period_start = $1 ORDER BY category_id ASC`,
          [periodStart],
        );
  return rows.map(toBudget);
}

export async function getBudget(id: number): Promise<Budget | null> {
  const rows = await select<BudgetRow[]>(`SELECT ${COLUMNS} FROM budgets WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? toBudget(row) : null;
}

export async function deleteBudget(id: number): Promise<void> {
  await execute('DELETE FROM budgets WHERE id = $1', [id]);
}

/** Every budget that ever existed, keyed by `period_start`, for the trend view. */
export async function budgetsByPeriod(): Promise<Map<string, Budget[]>> {
  const rows = await select<BudgetRow[]>(
    `SELECT ${COLUMNS} FROM budgets ORDER BY period_start ASC, category_id ASC`,
  );
  const byPeriod = new Map<string, Budget[]>();
  for (const row of rows) {
    const budget = toBudget(row);
    const list = byPeriod.get(budget.periodStart) ?? [];
    list.push(budget);
    byPeriod.set(budget.periodStart, list);
  }
  return byPeriod;
}
