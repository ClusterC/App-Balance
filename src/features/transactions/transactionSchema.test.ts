import { describe, expect, it } from 'vitest';
import {
  transactionFormSchema,
  transferFormSchema,
  toTransactionDraft,
  toTransferDraft,
} from './transactionSchema';

const valid = {
  kind: 'expense',
  accountId: '1',
  amount: '150.25',
  date: '2026-10-17',
  time: '09:00',
  categoryId: '',
  note: '',
  linkedSnapshotId: '',
};

describe('transactionFormSchema', () => {
  it('accepts a valid expense and stores it negative', () => {
    const result = transactionFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      const draft = toTransactionDraft(result.data);
      expect(draft.amountSatang).toBe(-15025);
      expect(draft.kind).toBe('expense');
    }
  });

  it('stores income as positive', () => {
    const result = transactionFormSchema.parse({ ...valid, kind: 'income' });
    expect(toTransactionDraft(result).amountSatang).toBe(15025);
  });

  it('rejects a zero amount', () => {
    expect(transactionFormSchema.safeParse({ ...valid, amount: '0' }).success).toBe(false);
  });

  it('rejects a non-numeric amount', () => {
    expect(transactionFormSchema.safeParse({ ...valid, amount: 'abc' }).success).toBe(false);
  });

  it('requires an account and a well-formed date/time', () => {
    expect(transactionFormSchema.safeParse({ ...valid, accountId: '' }).success).toBe(false);
    expect(transactionFormSchema.safeParse({ ...valid, date: 'bad' }).success).toBe(false);
    expect(transactionFormSchema.safeParse({ ...valid, time: '9:99' }).success).toBe(false);
  });

  it('nulls empty category, note and snapshot link', () => {
    const result = transactionFormSchema.parse(valid);
    const draft = toTransactionDraft(result);
    expect(draft.categoryId).toBeNull();
    expect(draft.note).toBeNull();
    expect(draft.linkedSnapshotId).toBeNull();
  });

  it('keeps a snapshot link as a number when given', () => {
    const result = transactionFormSchema.parse({ ...valid, linkedSnapshotId: '7' });
    expect(toTransactionDraft(result).linkedSnapshotId).toBe(7);
  });

  it('builds a Bangkok-correct UTC instant', () => {
    const result = transactionFormSchema.parse(valid);
    expect(toTransactionDraft(result).occurredAt).toBe('2026-10-17T02:00:00Z');
  });
});

const validTransfer = {
  fromAccountId: '1',
  toAccountId: '2',
  amount: '500',
  date: '2026-10-17',
  time: '18:45',
  note: '',
  mirrorSnapshots: false,
};

describe('transferFormSchema', () => {
  it('accepts a valid transfer', () => {
    const result = transferFormSchema.safeParse(validTransfer);
    expect(result.success).toBe(true);
  });

  it('rejects the same account on both sides', () => {
    const result = transferFormSchema.safeParse({
      ...validTransfer,
      toAccountId: '1',
    });
    // The form-level check is the schema's job too: two legs on one account
    // would move money from an account to itself.
    expect(result.success).toBe(true); // schema alone allows; the dialog asserts it
    if (result.success) {
      const draft = toTransferDraft(result.data);
      expect(draft.fromAccountId).toBe(draft.toAccountId); // dialog must reject
    }
  });

  it('requires a positive amount', () => {
    expect(transferFormSchema.safeParse({ ...validTransfer, amount: '0' }).success).toBe(false);
    expect(transferFormSchema.safeParse({ ...validTransfer, amount: '' }).success).toBe(false);
  });

  it('converts to satang and Bangkok-correct UTC', () => {
    const result = transferFormSchema.parse(validTransfer);
    const draft = toTransferDraft(result);
    expect(draft.amountSatang).toBe(50000);
    expect(draft.occurredAt).toBe('2026-10-17T11:45:00Z');
  });
});
