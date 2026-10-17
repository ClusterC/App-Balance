import { describe, expect, it } from 'vitest';
import { snapshotFormSchema, classifyFormSchema, toSnapshotDraft } from './snapshotSchema';

/** A baseline of valid raw form values to mutate per case. */
const valid = {
  accountId: '1',
  balance: '1,234.56',
  date: '2026-10-17',
  time: '14:30',
  updateType: 'expense',
  categoryId: '',
  note: '',
};

describe('snapshotFormSchema', () => {
  it('accepts valid Thai-style amounts and converts to satang', () => {
    const result = snapshotFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.balance).toBe(123456);
  });

  it('accepts a zero balance — an empty wallet is a real balance', () => {
    const result = snapshotFormSchema.safeParse({ ...valid, balance: '0' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.balance).toBe(0);
  });

  it('rejects a non-numeric balance', () => {
    const result = snapshotFormSchema.safeParse({ ...valid, balance: 'abc' });
    expect(result.success).toBe(false);
  });

  it('requires an account', () => {
    const result = snapshotFormSchema.safeParse({ ...valid, accountId: '' });
    expect(result.success).toBe(false);
  });

  it('requires a well-formed date', () => {
    expect(snapshotFormSchema.safeParse({ ...valid, date: '' }).success).toBe(false);
    expect(snapshotFormSchema.safeParse({ ...valid, date: '17/10/2026' }).success).toBe(false);
  });

  it('requires a well-formed time', () => {
    expect(snapshotFormSchema.safeParse({ ...valid, time: '' }).success).toBe(false);
    expect(snapshotFormSchema.safeParse({ ...valid, time: '25:00' }).success).toBe(false);
  });

  it('rejects an unknown update type', () => {
    const result = snapshotFormSchema.safeParse({ ...valid, updateType: 'maybe' });
    expect(result.success).toBe(false);
  });

  it('trims and nulls an empty note, caps a long one', () => {
    const ok = snapshotFormSchema.safeParse({ ...valid, note: '  ' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.note).toBeNull();

    const long = snapshotFormSchema.safeParse({ ...valid, note: 'x'.repeat(501) });
    expect(long.success).toBe(false);
  });
});

describe('toSnapshotDraft', () => {
  it('builds a Bangkok-correct UTC timestamp from the local fields', () => {
    const parsed = snapshotFormSchema.parse(valid);
    const draft = toSnapshotDraft(parsed);
    expect(draft.effectiveAt).toBe('2026-10-17T07:30:00Z');
    expect(draft.balanceSatang).toBe(123456);
    expect(draft.categoryId).toBeNull();
    expect(draft.note).toBeNull();
  });

  it('maps a chosen category id to a number', () => {
    const parsed = snapshotFormSchema.parse({ ...valid, categoryId: '3' });
    expect(toSnapshotDraft(parsed).categoryId).toBe(3);
  });
});

describe('classifyFormSchema', () => {
  it('accepts a classification and nulls an empty note', () => {
    const result = classifyFormSchema.safeParse({
      updateType: 'income',
      categoryId: '',
      note: '',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBeNull();
  });

  it('rejects a missing update type', () => {
    const result = classifyFormSchema.safeParse({
      updateType: undefined,
      categoryId: '',
      note: '',
    });
    expect(result.success).toBe(false);
  });
});
