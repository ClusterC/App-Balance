// The transaction add dialog.
//
// One dialog covers income, expense and adjustment in a single row, and the
// transfer as a mode switch: a transfer writes two linked legs through one
// Rust command in one database transaction, so both exist or neither does.
// That atomicity is why this dialog never writes rows itself — it calls the
// command layer and reports the result.

import { useEffect, useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Account, Category, Transaction } from '../../db/types';
import { t } from '../../i18n/th';
import { satangToDecimalString } from '../../domain/money';
import { bangkokDateKey, bangkokTimeOfDay, todayKey } from '../../domain/dates';
import { expenseCategories, incomeCategories } from '../../state/appStore';
import { createTransaction, updateTransaction } from '../../db/repositories/transactions';
import {
  transactionFormSchema,
  transferFormSchema,
  toTransactionDraft,
  toTransferDraft,
  type TransactionFormInput,
  type TransactionFormValues,
  type TransferFormInput,
  type TransferFormValues,
} from './transactionSchema';

export interface TransactionDialogProps {
  open: boolean;
  accounts: readonly Account[];
  categories: readonly Category[];
  /** The account a page pre-selected. */
  defaultAccountId?: number | 'all' | 'transfer';
  /** Present in edit mode; transfers are edited by deleting and re-entering. */
  transaction: Transaction | null;
  /** Snapshots of the chosen account, for the optional link. */
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function TransactionDialog({
  open,
  accounts,
  categories,
  defaultAccountId,
  transaction,
  onClose,
  onSaved,
}: TransactionDialogProps): ReactNode {
  // A transfer reuses the same dialog shell with its own form.
  const [transferMode, setTransferMode] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const single = useForm<TransactionFormInput, unknown, TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: defaults(transaction, defaultAccountId),
    mode: 'onSubmit',
  });
  const transfer = useForm<TransferFormInput, unknown, TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: transferDefaults(),
    mode: 'onSubmit',
  });

  useEffect(() => {
    if (open) {
      single.reset(defaults(transaction, defaultAccountId));
      transfer.reset(transferDefaults());
      setTransferMode(transaction === null && defaultAccountId === 'transfer');
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction, defaultAccountId]);

  // See SnapshotDialog: the documented RHF pattern; the compiler skip is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const kind = single.watch('kind');
  const categoryOptions =
    kind === 'income' ? incomeCategories({ categories } as never) : expenseCategories({ categories } as never);

  const submitSingle = single.handleSubmit(async (values) => {
    try {
      const draft = toTransactionDraft(values);
      if (transaction !== null) {
        await updateTransaction(transaction.id, draft);
      } else {
        await createTransaction(draft);
      }
      await onSaved();
      onClose();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('errors.saveFailed'));
    }
  });

  const submitTransfer = transfer.handleSubmit(async (values) => {
    const draft = toTransferDraft(values);
    if (draft.fromAccountId === draft.toAccountId) {
      transfer.setError('toAccountId', { message: t('transactions.transferSameAccount') });
      return;
    }
    try {
      const { createTransfer } = await import('../../lib/commands');
      await createTransfer({
        fromAccountId: draft.fromAccountId,
        toAccountId: draft.toAccountId,
        amountSatang: draft.amountSatang,
        occurredAt: draft.occurredAt,
        note: draft.note,
        mirrorSnapshots: draft.mirrorSnapshots,
        fromBalanceSatang: null,
        toBalanceSatang: null,
      });
      await onSaved();
      onClose();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('errors.saveFailed'));
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {transaction !== null
          ? t('transactions.edit')
          : transferMode
            ? t('transactions.addTransfer')
            : t('transactions.add')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {transferMode ? (
            <>
              <Stack direction="row" spacing={2}>
                <TextField
                  select
                  fullWidth
                  label={t('transactions.fromAccount')}
                  error={transfer.formState.errors.fromAccountId !== undefined}
                  helperText={transfer.formState.errors.fromAccountId?.message}
                  {...transfer.register('fromAccountId')}
                >
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={String(account.id)}>
                      {account.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  label={t('transactions.toAccount')}
                  error={transfer.formState.errors.toAccountId !== undefined}
                  helperText={transfer.formState.errors.toAccountId?.message}
                  {...transfer.register('toAccountId')}
                >
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={String(account.id)}>
                      {account.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <TextField
                fullWidth
                label={t('transactions.amount')}
                placeholder={t('money.amountPlaceholder')}
                error={transfer.formState.errors.amount !== undefined}
                helperText={transfer.formState.errors.amount?.message}
                {...transfer.register('amount')}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  fullWidth
                  type="date"
                  label={t('transactions.occurredAt')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  {...transfer.register('date')}
                />
                <TextField
                  fullWidth
                  type="time"
                  label={t('timeline.effectiveAtTime')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  {...transfer.register('time')}
                />
              </Stack>
              <TextField
                label={t('transactions.note')}
                placeholder={t('timeline.notePlaceholder')}
                multiline
                minRows={2}
                {...transfer.register('note')}
              />
              <FormControlLabel
                control={<Switch {...transfer.register('mirrorSnapshots')} />}
                label={t('transactions.mirrorSnapshotsLabel')}
              />
              <Typography variant="caption" color="text.secondary">
                {t('transactions.transferCreatesTwo')}
              </Typography>
            </>
          ) : (
            <>
              <Stack direction="row" spacing={2}>
                <TextField
                  select
                  fullWidth
                  label={t('transactions.kind')}
                  {...single.register('kind')}
                >
                  <MenuItem value="income">{t('transactions.addIncome')}</MenuItem>
                  <MenuItem value="expense">{t('transactions.addExpense')}</MenuItem>
                  <MenuItem value="adjustment">{t('transactionKind.adjustment')}</MenuItem>
                </TextField>
                <TextField
                  select
                  fullWidth
                  label={t('transactions.account')}
                  error={single.formState.errors.accountId !== undefined}
                  helperText={single.formState.errors.accountId?.message}
                  {...single.register('accountId')}
                >
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={String(account.id)}>
                      {account.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField
                  fullWidth
                  label={t('transactions.amount')}
                  placeholder={t('money.amountPlaceholder')}
                  helperText={t('transactions.signNote')}
                  error={single.formState.errors.amount !== undefined}
                  {...single.register('amount')}
                />
                <TextField
                  select
                  fullWidth
                  label={t('transactions.category')}
                  defaultValue=""
                  {...single.register('categoryId')}
                >
                  <MenuItem value="">{t('app.none')}</MenuItem>
                  {categoryOptions.map((category) => (
                    <MenuItem key={category.id} value={String(category.id)}>
                      {category.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField
                  fullWidth
                  type="date"
                  label={t('transactions.occurredAt')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  error={single.formState.errors.date !== undefined}
                  {...single.register('date')}
                />
                <TextField
                  fullWidth
                  type="time"
                  label={t('timeline.effectiveAtTime')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  error={single.formState.errors.time !== undefined}
                  {...single.register('time')}
                />
              </Stack>
              <TextField
                label={t('transactions.note')}
                placeholder={t('timeline.notePlaceholder')}
                multiline
                minRows={2}
                error={single.formState.errors.note !== undefined}
                {...single.register('note')}
              />
              {transaction?.linkedSnapshotId != null && (
                <Alert severity="info">{t('transactions.linkedToSnapshot')}</Alert>
              )}
            </>
          )}
          {serverError !== null && (
            <TextField
              error
              fullWidth
              label={t('errors.saveFailed')}
              value={serverError}
              slotProps={{ input: { readOnly: true } }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('app.cancel')}</Button>
        <Button
          onClick={() => {
            void (transferMode ? submitTransfer() : submitSingle());
          }}
          variant="contained"
          disabled={single.formState.isSubmitting || transfer.formState.isSubmitting}
        >
          {single.formState.isSubmitting || transfer.formState.isSubmitting
            ? t('app.saving')
            : t('app.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function defaults(
  transaction: Transaction | null,
  defaultAccountId: number | 'all' | 'transfer' | undefined,
): TransactionFormInput {
  if (transaction === null) {
    return {
      kind: 'expense',
      accountId:
        defaultAccountId !== undefined && defaultAccountId !== 'all' && defaultAccountId !== 'transfer'
          ? String(defaultAccountId)
          : '',
      amount: '',
      date: todayKey(),
      time: bangkokTimeOfDay(new Date()),
      categoryId: '',
      note: '',
      linkedSnapshotId: '',
    };
  }
  return {
    kind: transaction.kind === 'income' ? 'income' : transaction.kind === 'expense' ? 'expense' : 'adjustment',
    accountId: String(transaction.accountId),
    amount: satangToDecimalString(Math.abs(transaction.amountSatang)),
    date: bangkokDateKey(transaction.occurredAt),
    time: bangkokTimeOfDay(transaction.occurredAt),
    categoryId: transaction.categoryId === null ? '' : String(transaction.categoryId),
    note: transaction.note ?? '',
    linkedSnapshotId:
      transaction.linkedSnapshotId === null ? '' : String(transaction.linkedSnapshotId),
  };
}

function transferDefaults(): TransferFormInput {
  return {
    fromAccountId: '',
    toAccountId: '',
    amount: '',
    date: todayKey(),
    time: bangkokTimeOfDay(new Date()),
    note: '',
    mirrorSnapshots: false,
  };
}
