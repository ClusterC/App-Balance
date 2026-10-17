// The snapshot add/edit dialog.
//
// One dialog for both modes, following `AccountDialog`. The balance the user
// types is the source of truth and is never rewritten; the delta shown next to
// it is derived and may be recalculated by Rust when this row lands out of
// chronological order. The dialog says so up front rather than surprising the
// user after the save.

import { useEffect, useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { TimelineEntry } from '../../db/repositories/snapshots';
import type { Account, Category } from '../../db/types';
import { t } from '../../i18n/th';
import { satangToDecimalString } from '../../domain/money';
import { bangkokDateKey, bangkokTimeOfDay, todayKey } from '../../domain/dates';
import { expenseCategories, incomeCategories } from '../../state/appStore';
import {
  snapshotFormSchema,
  toSnapshotDraft,
  type SnapshotFormInput,
  type SnapshotFormValues,
} from './snapshotSchema';

export interface SnapshotDialogProps {
  open: boolean;
  accounts: readonly Account[];
  categories: readonly Category[];
  /** Present in edit mode. */
  snapshot: TimelineEntry | null;
  /** The account a header FAB pre-selected, in add mode. */
  defaultAccountId?: number | 'all';
  onClose: () => void;
  /** Receives the mutation result so the page can show the recalculated count. */
  onSaved: (recalculated: number) => void | Promise<void>;
  /** The store's save command; injected so the dialog stays presentation-only. */
  onSave: (draft: ReturnType<typeof toSnapshotDraft>, id: number | null) => Promise<void>;
}

export function SnapshotDialog({
  open,
  accounts,
  categories,
  snapshot,
  defaultAccountId,
  onClose,
  onSaved,
  onSave,
}: SnapshotDialogProps): ReactNode {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SnapshotFormInput, unknown, SnapshotFormValues>({
    resolver: zodResolver(snapshotFormSchema),
    defaultValues: defaults(snapshot, defaultAccountId),
    mode: 'onSubmit',
  });

  // Re-default when the dialog opens for a different snapshot, so editing one
  // entry after another cannot inherit the previous one's values.
  useEffect(() => {
    if (open) {
      form.reset(defaults(snapshot, defaultAccountId));
    }
    // `snapshot` and `defaultAccountId` are the only inputs that change defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot, defaultAccountId]);

  // RHF's `watch` is the documented way to react to field changes; the compiler
  // skips memoising this component for it, which is fine here. One disable
  // covers the whole component's skip, so it sits on the first `watch` call.
  // eslint-disable-next-line react-hooks/incompatible-library
  const updateType = form.watch('updateType');
  const accountId = form.watch('accountId');

  // Categories follow the chosen update type: income kinds list income
  // categories, everything else lists expense ones, matching the reports.
  const categoryOptions =
    updateType === 'income' || updateType === 'transfer_in'
      ? incomeCategories({ categories } as never)
      : expenseCategories({ categories } as never);

  const submit = form.handleSubmit(async (values) => {
    try {
      const draft = toSnapshotDraft(values);
      await onSave(draft, snapshot?.id ?? null);
      await onSaved(0);
      onClose();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('errors.saveFailed'));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {snapshot !== null ? t('timeline.editSnapshot') : t('timeline.addSnapshot')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            fullWidth
            label={t('timeline.account')}
            error={form.formState.errors.accountId !== undefined}
            helperText={form.formState.errors.accountId?.message}
            {...form.register('accountId')}
          >
            {accounts.map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {account.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={2}>
            <TextField
              fullWidth
              label={t('timeline.balanceAtTime')}
              placeholder={t('money.amountPlaceholder')}
              error={form.formState.errors.balance !== undefined}
              helperText={form.formState.errors.balance?.message}
              {...form.register('balance')}
            />
            <TextField
              fullWidth
              type="date"
              label={t('timeline.effectiveAt')}
              slotProps={{ inputLabel: { shrink: true } }}
              error={form.formState.errors.date !== undefined}
              helperText={form.formState.errors.date?.message}
              {...form.register('date')}
            />
            <TextField
              fullWidth
              type="time"
              label={t('timeline.effectiveAtTime')}
              slotProps={{ inputLabel: { shrink: true } }}
              error={form.formState.errors.time !== undefined}
              helperText={form.formState.errors.time?.message}
              {...form.register('time')}
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              select
              fullWidth
              label={t('timeline.updateType')}
              helperText={
                updateType === 'unknown' ? t('updateType.unknownHint') : undefined
              }
              {...form.register('updateType')}
            >
              <MenuItem value="income">{t('updateType.income')}</MenuItem>
              <MenuItem value="expense">{t('updateType.expense')}</MenuItem>
              <MenuItem value="transfer_in">{t('updateType.transfer_in')}</MenuItem>
              <MenuItem value="transfer_out">{t('updateType.transfer_out')}</MenuItem>
              <MenuItem value="adjustment">{t('updateType.adjustment')}</MenuItem>
              <MenuItem value="unknown">{t('updateType.unknown')}</MenuItem>
            </TextField>
            <TextField
              select
              fullWidth
              label={t('timeline.category')}
              defaultValue=""
              {...form.register('categoryId')}
            >
              <MenuItem value="">{t('app.none')}</MenuItem>
              {categoryOptions.map((category) => (
                <MenuItem key={category.id} value={String(category.id)}>
                  {category.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label={t('timeline.note')}
            placeholder={t('timeline.notePlaceholder')}
            multiline
            minRows={2}
            error={form.formState.errors.note !== undefined}
            helperText={form.formState.errors.note?.message}
            {...form.register('note')}
          />
          {snapshot !== null && (
            <Alert severity="info">
              {t('timeline.currentBalance')}: {satangToDecimalString(snapshot.balanceSatang)} ·{' '}
              {t('timeline.derivedDelta')}:{' '}
              {satangToDecimalString(snapshot.derivedDeltaSatang)}
            </Alert>
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
          {accountId === '' && accounts.length > 0 && (
            <Alert severity="warning">{t('validation.accountRequired')}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('app.cancel')}</Button>
        <Button
          onClick={() => {
            void submit();
          }}
          variant="contained"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? t('app.saving') : t('app.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function defaults(snapshot: TimelineEntry | null, defaultAccountId: number | 'all' | undefined): SnapshotFormInput {
  if (snapshot === null) {
    return {
      accountId: defaultAccountId !== undefined && defaultAccountId !== 'all'
        ? String(defaultAccountId)
        : '',
      balance: '',
      date: todayKey(),
      time: bangkokTimeOfDay(new Date()),
      updateType: 'unknown',
      categoryId: '',
      note: '',
    };
  }
  return {
    accountId: String(snapshot.accountId),
    balance: satangToDecimalString(snapshot.balanceSatang),
    date: bangkokDateKey(snapshot.effectiveAt),
    time: bangkokTimeOfDay(snapshot.effectiveAt),
    updateType: snapshot.updateType,
    categoryId: snapshot.categoryId === null ? '' : String(snapshot.categoryId),
    note: snapshot.note ?? '',
  };
}
