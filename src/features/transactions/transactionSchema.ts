// Transaction form validation.
//
// Same pattern as the other schemas. The amount may not be zero, and its sign
// is fixed by the kind — the database's CHECK enforces that too, so the form
// asserts it before the row ever reaches SQLite.

import { z } from 'zod';
import { parseAmount } from '../../domain/money';
import { bangkokLocalToUtc, toIsoUtc } from '../../domain/dates';
import { t } from '../../i18n/th';
import type { TransactionKind } from '../../db/types';

/** Kinds a single-row form can produce; transfers are their own dialog. */
export const SINGLE_KINDS = ['income', 'expense', 'adjustment'] as const;
export type SingleKind = (typeof SINGLE_KINDS)[number];

export const transactionFormSchema = z.object({
  kind: z.enum(SINGLE_KINDS),
  accountId: z
    .string()
    .min(1, t('validation.accountRequired'))
    .transform((value) => Number(value)),
  amount: z
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
      if (parsed === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('validation.amountZero') });
        return z.NEVER;
      }
      // Income and adjustment are positive, expense negative — matching the
      // schema's sign CHECK and the reports' conventions.
      const signed = value.trim().startsWith('-')
        ? -Math.abs(parsed)
        : parsed;
      return signed;
    }),
  date: z
    .string()
    .min(1, t('validation.dateRequired'))
    .regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.dateInvalid')),
  time: z
    .string()
    .min(1, t('validation.timeRequired'))
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, t('validation.timeRequired')),
  categoryId: z.string(),
  note: z
    .string()
    .trim()
    .max(500, t('validation.noteTooLong'))
    .transform((v) => (v === '' ? null : v)),
  /** Optional: ties this row to the snapshot that explains it. */
  linkedSnapshotId: z.string(),
});

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
export type TransactionFormInput = z.input<typeof transactionFormSchema>;

export interface TransactionFormDraft {
  accountId: number;
  kind: TransactionKind;
  amountSatang: number;
  occurredAt: string;
  categoryId: number | null;
  note: string | null;
  linkedSnapshotId: number | null;
}

export function toTransactionDraft(values: TransactionFormValues): TransactionFormDraft {
  const kind: TransactionKind =
    values.kind === 'income'
      ? 'income'
      : values.kind === 'expense'
        ? 'expense'
        : 'adjustment';
  return {
    accountId: values.accountId,
    kind,
    // Expenses are stored negative; the schema's CHECK and the reports both
    // rely on the sign, so it is fixed here rather than in every reader.
    amountSatang: values.kind === 'expense' ? -Math.abs(values.amount) : Math.abs(values.amount),
    occurredAt: toIsoUtc(bangkokLocalToUtc(values.date, values.time)),
    categoryId: values.categoryId === '' ? null : Number(values.categoryId),
    note: values.note,
    linkedSnapshotId: values.linkedSnapshotId === '' ? null : Number(values.linkedSnapshotId),
  };
}

export const transferFormSchema = z.object({
  fromAccountId: z
    .string()
    .min(1, t('validation.accountRequired'))
    .transform((value) => Number(value)),
  toAccountId: z
    .string()
    .min(1, t('validation.accountRequired'))
    .transform((value) => Number(value)),
  amount: z
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
      if (parsed === null || parsed <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('validation.amountZero') });
        return z.NEVER;
      }
      return parsed;
    }),
  date: z
    .string()
    .min(1, t('validation.dateRequired'))
    .regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.dateInvalid')),
  time: z
    .string()
    .min(1, t('validation.timeRequired'))
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, t('validation.timeRequired')),
  note: z
    .string()
    .trim()
    .max(500, t('validation.noteTooLong'))
    .transform((v) => (v === '' ? null : v)),
  mirrorSnapshots: z.boolean(),
});

export type TransferFormValues = z.infer<typeof transferFormSchema>;
export type TransferFormInput = z.input<typeof transferFormSchema>;

export interface TransferFormDraft {
  fromAccountId: number;
  toAccountId: number;
  amountSatang: number;
  occurredAt: string;
  note: string | null;
  mirrorSnapshots: boolean;
}

export function toTransferDraft(values: TransferFormValues): TransferFormDraft {
  return {
    fromAccountId: values.fromAccountId,
    toAccountId: values.toAccountId,
    amountSatang: values.amount,
    occurredAt: toIsoUtc(bangkokLocalToUtc(values.date, values.time)),
    note: values.note,
    mirrorSnapshots: values.mirrorSnapshots,
  };
}
