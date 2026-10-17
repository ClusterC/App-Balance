// Snapshot form validation.
//
// The same Zod patterns as `accountSchema`, with one deliberate difference:
// a snapshot's *balance* may be zero — an empty wallet is a real balance —
// where a transaction's amount may not be. Everything else follows the shared
// money/date rules, and the Thai messages come from the central dictionary.

import { z } from 'zod';
import { parseAmount } from '../../domain/money';
import { bangkokLocalToUtc, toIsoUtc } from '../../domain/dates';
import { t } from '../../i18n/th';
import type { UpdateType } from '../../domain/snapshots';

/** `HH:mm`, the granularity of `<input type="time">` and of the form. */
const timeSchema = z
  .string()
  .min(1, t('validation.timeRequired'))
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, t('validation.timeRequired'));

/**
 * A recorded balance, unlike a transaction amount, may be zero.
 * Only the non-numeric and overflow checks apply.
 */
export const balanceToSatang = z
  .string()
  .trim()
  .min(1, t('validation.amountRequired'))
  .transform((value, ctx) => {
    let parsed: number | null;
    try {
      parsed = parseAmount(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('validation.amountTooLarge') });
      return z.NEVER;
    }
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('validation.amountInvalid') });
      return z.NEVER;
    }
    return parsed;
  });

export const snapshotFormSchema = z.object({
  /** A `<select>` value, hence a string here and a number after the transform. */
  accountId: z
    .string()
    .min(1, t('validation.accountRequired'))
    .transform((value) => Number(value)),
  balance: balanceToSatang,
  date: z
    .string()
    .min(1, t('validation.dateRequired'))
    .regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.dateInvalid')),
  time: timeSchema,
  updateType: z.enum(['income', 'expense', 'transfer_in', 'transfer_out', 'adjustment', 'unknown']),
  /** `''` when the user picks none; becomes `null` in the draft. */
  categoryId: z.string(),
  note: z
    .string()
    .trim()
    .max(500, t('validation.noteTooLong'))
    .transform((v) => (v === '' ? null : v)),
});

export type SnapshotFormValues = z.infer<typeof snapshotFormSchema>;
/** The form's raw input shape, before the schemas' transforms run. */
export type SnapshotFormInput = z.input<typeof snapshotFormSchema>;

export interface SnapshotDraft {
  accountId: number;
  balanceSatang: number;
  effectiveAt: string;
  updateType: UpdateType;
  categoryId: number | null;
  note: string | null;
}

/** Maps validated form values to a `SnapshotInput`-shaped draft. */
export function toSnapshotDraft(values: SnapshotFormValues): SnapshotDraft {
  return {
    accountId: values.accountId,
    balanceSatang: values.balance,
    effectiveAt: toIsoUtc(bangkokLocalToUtc(values.date, values.time)),
    updateType: values.updateType,
    categoryId: values.categoryId === '' ? null : Number(values.categoryId),
    note: values.note,
  };
}

/** The classify dialog reuses only the classification fields. */
export const classifyFormSchema = z.object({
  updateType: z.enum(['income', 'expense', 'transfer_in', 'transfer_out', 'adjustment', 'unknown']),
  categoryId: z.string(),
  note: z
    .string()
    .trim()
    .max(500, t('validation.noteTooLong'))
    .transform((v) => (v === '' ? null : v)),
});

export type ClassifyFormValues = z.infer<typeof classifyFormSchema>;
export type ClassifyFormInput = z.input<typeof classifyFormSchema>;
