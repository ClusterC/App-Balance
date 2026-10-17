// Account form validation, per the spec's test matrix.
//
// The Thai Zod messages, the 4-character suffix cap and the credit-card
// liability rule are asserted here once; the dialog just renders what this
// schema decides.

import { describe, expect, it } from 'vitest';
import { accountFormSchema, toAccountDraft } from './accountSchema';
import { t } from '../../i18n/th';

function baseInput() {
  return {
    name: 'ออมทรัพย์ กสิกร',
    institution: '',
    accountType: 'bank' as const,
    numberSuffix: '1234',
    color: null,
    currency: 'THB',
    openingBalance: '1,000.50',
    openingDate: '2026-01-15',
    creditLimit: '',
    isLiability: false,
  };
}

describe('accountFormSchema', () => {
  it('accepts a valid account and converts the opening balance to satang', () => {
    const result = accountFormSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openingBalance).toBe(100_050);
      expect(result.data.institution).toBeNull();
      expect(result.data.numberSuffix).toBe('1234');
    }
  });

  it('requires a name', () => {
    const result = accountFormSchema.safeParse({ ...baseInput(), name: '  ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(t('validation.accountNameRequired'));
    }
  });

  it('caps the number suffix at 4 characters', () => {
    const result = accountFormSchema.safeParse({ ...baseInput(), numberSuffix: '12345' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(t('validation.numberSuffixLength'));
    }
  });

  it('parses Thai digits and separators in the opening balance', () => {
    const result = accountFormSchema.safeParse({ ...baseInput(), openingBalance: '๑,๒๓๔.๕๖' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.openingBalance).toBe(123_456);
  });

  it('rejects a non-numeric opening balance with the Thai message', () => {
    const result = accountFormSchema.safeParse({ ...baseInput(), openingBalance: 'abc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(t('validation.amountInvalid'));
    }
  });

  it('accepts a zero opening balance — accounts can legitimately start empty', () => {
    const result = accountFormSchema.safeParse({ ...baseInput(), openingBalance: '0.00' });
    expect(result.success).toBe(true);
  });

  it('requires a positive credit limit when given', () => {
    const result = accountFormSchema.safeParse({ ...baseInput(), creditLimit: '-5' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(t('validation.creditLimitPositive'));
    }
  });

  it('marks a credit card as a liability automatically is not done — the user must confirm', () => {
    const result = accountFormSchema.safeParse({
      ...baseInput(),
      accountType: 'credit_card' as const,
      isLiability: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('isLiability'))).toBe(true);
    }
  });

  it('requires an opening date', () => {
    const result = accountFormSchema.safeParse({ ...baseInput(), openingDate: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(t('validation.openingDateRequired'));
    }
  });
});

describe('toAccountDraft', () => {
  it('maps validated values to the repository draft', () => {
    const parsed = accountFormSchema.parse({
      ...baseInput(),
      creditLimit: '50,000',
      isLiability: true,
    });
    const draft = toAccountDraft(parsed);
    expect(draft).toMatchObject({
      name: 'ออมทรัพย์ กสิกร',
      institution: null,
      numberSuffix: '1234',
      openingBalanceSatang: 100_050,
      creditLimitSatang: 5_000_000,
      isLiability: true,
    });
  });
});
