// Month-key helpers for the budgets page.
//
// Thin wrappers over the domain date functions, kept separate so the page file
// stays about rendering; the underlying arithmetic is tested in `dates.test.ts`.

import { currentMonthKey } from '../../state/appStore';
import { addMonthsKey } from '../../domain/dates';

export function currentMonthKeyOf(): string {
  return currentMonthKey();
}

export function previousMonthKey(monthKey: string): string {
  return addMonthsKey(monthKey, -1);
}
