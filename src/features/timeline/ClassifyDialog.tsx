// The classify dialog: names an already-recorded delta without touching the
// balance. Deliberately narrower than `SnapshotDialog` — only the update type,
// category and note are editable here, because the recorded balance is the
// user's observation and the delta is derived from it; neither is a field a
// classification pass should be able to change.

import { useEffect, useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Category } from '../../db/types';
import { ChangeText } from '../../components';
import { t } from '../../i18n/th';
import { expenseCategories, incomeCategories } from '../../state/appStore';
import {
  classifyFormSchema,
  type ClassifyFormInput,
  type ClassifyFormValues,
} from './snapshotSchema';

export interface ClassifyDialogProps {
  open: boolean;
  categories: readonly Category[];
  snapshotId: number;
  /** The delta being classified, for the header line. */
  deltaSatang: number;
  /** The update type currently on the row (usually `unknown`). */
  currentType: ClassifyFormInput['updateType'];
  currentCategoryId: number | null;
  currentNote: string | null;
  onClose: () => void;
  onSave: (values: {
    updateType: ClassifyFormValues['updateType'];
    categoryId: number | null;
    note: string | null;
  }) => Promise<void>;
}

export function ClassifyDialog({
  open,
  categories,
  deltaSatang,
  currentType,
  currentCategoryId,
  currentNote,
  onClose,
  onSave,
}: ClassifyDialogProps): ReactNode {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ClassifyFormInput, unknown, ClassifyFormValues>({
    resolver: zodResolver(classifyFormSchema),
    defaultValues: {
      updateType: currentType,
      categoryId: currentCategoryId === null ? '' : String(currentCategoryId),
      note: currentNote ?? '',
    },
    mode: 'onSubmit',
  });

  useEffect(() => {
    if (open) {
      form.reset({
        updateType: currentType,
        categoryId: currentCategoryId === null ? '' : String(currentCategoryId),
        note: currentNote ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentType, currentCategoryId, currentNote]);

  // See SnapshotDialog: `watch` is the documented RHF pattern.
  // eslint-disable-next-line react-hooks/incompatible-library
  const updateType = form.watch('updateType');
  const categoryOptions =
    updateType === 'income' || updateType === 'transfer_in'
      ? incomeCategories({ categories } as never)
      : expenseCategories({ categories } as never);

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSave({
        updateType: values.updateType,
        categoryId: values.categoryId === '' ? null : Number(values.categoryId),
        note: values.note,
      });
      onClose();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('errors.saveFailed'));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('timeline.classifyTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ChangeText satang={deltaSatang} />
          <Typography variant="body2" color="text.secondary">
            {t('timeline.classifyHint')}
          </Typography>
          <TextField
            select
            fullWidth
            label={t('timeline.updateType')}
            helperText={updateType === 'unknown' ? t('updateType.unknownHint') : undefined}
            error={form.formState.errors.updateType !== undefined}
            {...form.register('updateType')}
          >
            <MenuItem value="income">{t('updateType.income')}</MenuItem>
            <MenuItem value="expense">{t('updateType.expense')}</MenuItem>
            <MenuItem value="transfer_in">{t('updateType.transfer_in')}</MenuItem>
            <MenuItem value="transfer_out">{t('updateType.transfer_out')}</MenuItem>
            <MenuItem value="adjustment">{t('updateType.adjustment')}</MenuItem>
            <MenuItem value="unknown">{t('updateType.unknown')}</MenuItem>
          </TextField>
          <TextField select fullWidth label={t('timeline.category')} {...form.register('categoryId')}>
            <MenuItem value="">{t('app.none')}</MenuItem>
            {categoryOptions.map((category) => (
              <MenuItem key={category.id} value={String(category.id)}>
                {category.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('timeline.note')}
            placeholder={t('timeline.notePlaceholder')}
            multiline
            minRows={2}
            error={form.formState.errors.note !== undefined}
            helperText={form.formState.errors.note?.message}
            {...form.register('note')}
          />
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
