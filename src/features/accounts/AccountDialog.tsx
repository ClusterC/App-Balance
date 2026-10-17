// The account add/edit dialog.
//
// One dialog for both modes: an existing account's id switches it to edit.
// The opening balance and opening date stay editable after creation because
// they seed the delta chain and a mistyped seed is a real mistake worth fixing.

import { useEffect, useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Stack from '@mui/material/Stack';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Account } from '../../db/types';
import { createAccount, updateAccount } from '../../db/repositories/accounts';
import { t } from '../../i18n/th';
import { satangToDecimalString } from '../../domain/money';
import { todayKey } from '../../domain/dates';
import {
  accountFormSchema,
  toAccountDraft,
  type AccountFormInput,
  type AccountFormValues,
} from './accountSchema';

export interface AccountDialogProps {
  open: boolean;
  /** Present in edit mode. */
  account: Account | null;
  onClose: () => void;
  onSaved: (id: number) => void | Promise<void>;
}

const CURRENCY_OPTIONS = ['THB'] as const;

export function AccountDialog({ open, account, onClose, onSaved }: AccountDialogProps): ReactNode {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AccountFormInput, unknown, AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: defaults(account),
    mode: 'onSubmit',
  });

  // Reset the form when the dialog opens for a different account, so editing
  // one account after another cannot inherit the previous one's values. The
  // server error clears on the next submit, so it needs no reset here.
  useEffect(() => {
    if (open) {
      form.reset(defaults(account));
    }
    // `account` is the only input that changes the defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const draft = toAccountDraft(values);
      const id = account !== null ? (await updateAccount(account.id, draft), account.id) : await createAccount(draft);
      await onSaved(id);
      onClose();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('errors.saveFailed'));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{account !== null ? t('accounts.edit') : t('accounts.add')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('accounts.name')}
            placeholder={t('accounts.namePlaceholder')}
            error={form.formState.errors.name !== undefined}
            helperText={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <TextField
            label={t('accounts.institution')}
            placeholder={t('accounts.institutionPlaceholder')}
            error={form.formState.errors.institution !== undefined}
            helperText={form.formState.errors.institution?.message}
            {...form.register('institution')}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              select
              fullWidth
              label={t('accounts.type')}
              defaultValue="bank"
              {...form.register('accountType')}
            >
              <MenuItem value="bank">{t('accountType.bank')}</MenuItem>
              <MenuItem value="cash">{t('accountType.cash')}</MenuItem>
              <MenuItem value="ewallet">{t('accountType.ewallet')}</MenuItem>
              <MenuItem value="credit_card">{t('accountType.credit_card')}</MenuItem>
              <MenuItem value="other">{t('accountType.other')}</MenuItem>
            </TextField>
            <TextField
              fullWidth
              label={t('accounts.numberSuffix')}
              slotProps={{ htmlInput: { maxLength: 4 } }}
              error={form.formState.errors.numberSuffix !== undefined}
              helperText={
                form.formState.errors.numberSuffix?.message ?? t('accounts.numberSuffixHint')
              }
              {...form.register('numberSuffix')}
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              fullWidth
              label={t('money.openingBalance')}
              placeholder={t('money.amountPlaceholder')}
              error={form.formState.errors.openingBalance !== undefined}
              helperText={form.formState.errors.openingBalance?.message}
              {...form.register('openingBalance')}
            />
            <TextField
              fullWidth
              type="date"
              label={t('accounts.openingDate')}
              slotProps={{ inputLabel: { shrink: true } }}
              error={form.formState.errors.openingDate !== undefined}
              helperText={form.formState.errors.openingDate?.message}
              {...form.register('openingDate')}
            />
          </Stack>
          <TextField
            label={t('accounts.creditLimit')}
            placeholder={t('money.amountPlaceholder')}
            error={form.formState.errors.creditLimit !== undefined}
            helperText={form.formState.errors.creditLimit?.message}
            {...form.register('creditLimit')}
          />
          <FormControlLabel
            control={<Switch {...form.register('isLiability')} />}
            label={t('accounts.isLiability')}
          />
          <TextField
            select
            label={t('accounts.currency')}
            defaultValue="THB"
            {...form.register('currency')}
          >
            {CURRENCY_OPTIONS.map((code) => (
              <MenuItem key={code} value={code}>
                {code}
              </MenuItem>
            ))}
          </TextField>
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
        <Button onClick={() => { void submit(); }} variant="contained" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('app.saving') : t('app.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function defaults(account: Account | null): AccountFormInput {
  if (account === null) {
    return {
      name: '',
      institution: '',
      accountType: 'bank',
      numberSuffix: '',
      color: null,
      currency: 'THB',
      openingBalance: '',
      openingDate: todayKey(),
      creditLimit: '',
      isLiability: false,
    };
  }
  return {
    name: account.name,
    institution: account.institution ?? '',
    accountType: account.accountType,
    numberSuffix: account.numberSuffix ?? '',
    color: account.color,
    currency: account.currency,
    openingBalance: satangToDecimalString(account.openingBalanceSatang),
    openingDate: account.openingDate,
    creditLimit:
      account.creditLimitSatang !== null ? satangToDecimalString(account.creditLimitSatang) : '',
    isLiability: account.isLiability,
  };
}
