// Account form validation.
//
// Zod schemas with Thai messages, one per field group. Shared by the account
// dialog and its tests so the validation matrix is asserted once.

import { z } from 'zod';
import { parseAmount } from '../../domain/money';
import { t } from '../../i18n/th';

/** At most 4 characters, matching the DB `CHECK` — privacy, not format. */
export const numberSuffixSchema = z
  .string()
  .max(4, t('validation.numberSuffixLength'))
  .regex(/^[0-9xX*]*$/, t('validation.numberSuffixLength'))
  .nullable()
  .transform((v) => (v === null || v === '' ? null : v));

export const accountNameSchema = z
  .string()
  .trim()
  .min(1, t('validation.accountNameRequired'))
  .max(100, t('validation.accountNameTooLong'));

export const amountToSatang = z
  .string()
  .trim()
  .min(1, t('validation.amountRequired'))
  .transform((value, ctx) => {
    let parsed: number | null;
    try {
      parsed = refineAmount(value);
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
    return parsed;
  });

/**
 * The opening balance, unlike a transaction amount, may be zero: an account can
 * legitimately start empty. Only the non-numeric and overflow checks apply.
 */
export const openingBalanceToSatang = z
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

function refineAmount(value: string): number | null {
  return parseAmount(value);
}

export const accountFormSchema = z
  .object({
    name: accountNameSchema,
    institution: z
      .string()
      .trim()
      .max(100, t('validation.nameTooLong'))
      .transform((v) => (v === '' ? null : v)),
    accountType: z.enum(['bank', 'cash', 'ewallet', 'credit_card', 'other']),
    numberSuffix: numberSuffixSchema,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, t('validation.required'))
      .nullable()
      .transform((v) => (v === null || v === '' ? null : v)),
    currency: z.string().min(1),
    openingBalance: openingBalanceToSatang,
    openingDate: z
      .string()
      .min(1, t('validation.openingDateRequired'))
      .regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.dateInvalid')),
    creditLimit: z
      .string()
      .trim()
      .transform((value, ctx) => {
        if (value === '') return null;
        let parsed: number | null;
        try {
          parsed = parseAmount(value);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('validation.amountTooLarge') });
          return z.NEVER;
        }
        if (parsed === null || parsed <= 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('validation.creditLimitPositive') });
          return z.NEVER;
        }
        return parsed;
      }),
    isLiability: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.accountType === 'credit_card' && !data.isLiability) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isLiability'],
        message: t('accounts.isLiabilityHint'),
      }
      );
    }
  });

export type AccountFormValues = z.infer<typeof accountFormSchema>;
/** The form's raw input shape, before the schemas' transforms run. */
export type AccountFormInput = z.input<typeof accountFormSchema>;

/** Maps validated form values to the repository draft. */
export function toAccountDraft(
  values: AccountFormValues,
): import('../../db/repositories/accounts').AccountDraft {
  return {
    name: values.name,
    institution: values.institution,
    accountType: values.accountType,
    numberSuffix: values.numberSuffix,
    color: values.color,
    icon: null,
    currency: values.currency,
    openingBalanceSatang: values.openingBalance,
    openingDate: values.openingDate,
    creditLimitSatang: values.creditLimit,
    isLiability: values.isLiability,
  };
}
