// The budgets page.
//
// One budget row per category per month. Spending comes from the same
// `aggregatePeriod` the reports use, so the budget's "spent" can never
// disagree with the reports' numbers — both derive from the identical call.

import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useAppStore, expenseCategories } from '../../state/appStore';
import { deleteBudget } from '../../db/repositories/budgets';
import { saveBudget } from '../../lib/commands';
import type { Budget } from '../../db/types';
import { formatAmount, parseAmount, formatPercent } from '../../domain/money';
import { aggregatePeriod } from '../../domain/cashflow';
import { monthRange, formatThaiMonth } from '../../domain/dates';
import { previousMonthKey, currentMonthKeyOf } from './budgetPeriods';
import { t } from '../../i18n/th';
import { ConfirmDialog, EmptyState, useUndoSnackbar } from '../../components';

export function BudgetsPage(): ReactNode {
  const state = useAppStore();
  const { notify, element: snackbar } = useUndoSnackbar();

  // The month being viewed, `YYYY-MM`. Defaults to the current Bangkok month.
  const [monthKey, setMonthKey] = useState(() => currentMonthKeyOf());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const expenses = expenseCategories(state);

  // Spending per category for the viewed month, via the reports' aggregator.
  const spentByCategory = useMemo(() => {
    const range = monthRange(monthKey);
    const summary = aggregatePeriod({
      transactions: state.transactions,
      snapshots: state.snapshots,
      range,
      categories: state.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
      accounts: state.accounts.map((a) => ({ id: a.id, name: a.name })),
    });
    return new Map(summary.byCategoryExpense.map((rollup) => [rollup.id, rollup.amountSatang]));
  }, [state, monthKey]);

  const monthBudgets = state.budgets.filter((budget) => budget.periodStart.slice(0, 7) === monthKey);
  const prevKey = previousMonthKey(monthKey);

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    setDeleting(true);
    try {
      await deleteBudget(deleteTarget.id);
      await useAppStore.getState().reload();
      setDeleteTarget(null);
      notify(t('app.delete'));
    } catch {
      notify(t('errors.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            {t('budgets.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('budgets.subtitle')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {t('budgets.add')}
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
        <TextField
          select
          size="small"
          sx={{ minWidth: 220 }}
          label={t('budgets.month')}
          value={monthKey}
          onChange={(event) => {
            setMonthKey(event.target.value);
          }}
        >
          {/* The last twelve months, newest first — enough history to review
              without an unbounded list. */}
          {lastTwelveMonths().map((key) => (
            <MenuItem key={key} value={key}>
              {formatThaiMonth(key)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {monthBudgets.length === 0 ? (
        <EmptyState
          title={t('budgets.noBudgets')}
          hint={t('budgets.noBudgetsHint')}
          action={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              {t('budgets.add')}
            </Button>
          }
        />
      ) : (
        <Stack spacing={1.5}>
          {monthBudgets.map((budget) => {
            const category = state.categories.find((c) => c.id === budget.categoryId);
            const spent = spentByCategory.get(budget.categoryId) ?? 0;
            const ratio = budget.amountSatang === 0 ? 0 : spent / budget.amountSatang;
            const over = spent > budget.amountSatang;
            const remaining = budget.amountSatang - spent;
            return (
              <Card key={budget.id} variant="outlined" sx={over ? { borderColor: 'error.main' } : undefined}>
                <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {category?.name ?? `#${budget.categoryId}`}
                      </Typography>
                      {over && (
                        <Tooltip title={t('budgets.overBy')}>
                          <WarningAmberIcon color="error" fontSize="small" />
                        </Tooltip>
                      )}
                    </Stack>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title={t('budgets.edit')}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEditing(budget);
                            setDialogOpen(true);
                          }}
                          aria-label={t('budgets.edit')}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('app.delete')}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            setDeleteTarget(budget);
                          }}
                          aria-label={t('app.delete')}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(ratio * 100, 100)}
                    color={over ? 'error' : ratio > 0.8 ? 'warning' : 'primary'}
                    sx={{ height: 8, borderRadius: 4, mb: 1 }}
                    aria-label={`${t('budgets.progress')} ${formatPercent(ratio)}`}
                  />
                  <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                    <BudgetFigure label={t('budgets.amount')} value={formatAmount(budget.amountSatang)} />
                    <BudgetFigure label={t('budgets.spent')} value={formatAmount(spent)} />
                    <BudgetFigure
                      label={over ? t('budgets.over') : t('budgets.remaining')}
                      value={formatAmount(Math.abs(remaining))}
                      color={over ? 'error' : 'default'}
                    />
                    <BudgetFigure label={t('budgets.progress')} value={formatPercent(ratio)} />
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      <BudgetDialog
        open={dialogOpen}
        categories={expenses}
        monthKey={monthKey}
        prevKey={prevKey}
        editing={editing}
        existing={monthBudgets}
        onClose={() => {
          setDialogOpen(false);
        }}
        onSaved={async () => {
          await useAppStore.getState().reload();
          notify(t('app.save'));
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('app.delete')}
        body={`${t('budgets.edit')} — ${formatAmount(deleteTarget?.amountSatang ?? 0)}`}
        danger
        busy={deleting}
        onConfirm={() => {
          void handleDelete();
        }}
        onClose={() => {
          setDeleteTarget(null);
        }}
      />
      {snackbar}
    </Box>
  );
}

function BudgetFigure({
  label,
  value,
  color = 'default',
}: {
  label: string;
  value: string;
  color?: 'default' | 'error';
}): ReactNode {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, color: color === 'error' ? 'error.main' : undefined }}>
        {value}
      </Typography>
    </Box>
  );
}

/** The viewed month and the twelve before it, `YYYY-MM` keys. */
function lastTwelveMonths(): string[] {
  const keys: string[] = [];
  let key = currentMonthKeyOf();
  for (let i = 0; i < 12; i += 1) {
    keys.push(key);
    key = previousMonthKey(key);
  }
  return keys;
}

import { Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@mui/material';

const budgetFormSchema = z.object({
  categoryId: z.string().min(1, t('validation.categoryRequired')),
  amount: z
    .string()
    .trim()
    .min(1, t('validation.amountRequired'))
    .refine(
      (value) => {
        try {
          const parsed = parseAmount(value);
          return parsed !== null && parsed > 0;
        } catch {
          return false;
        }
      },
      { message: t('validation.budgetAmountPositive') },
    ),
});


function BudgetDialog({
  open,
  categories,
  monthKey,
  prevKey,
  editing,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  categories: ReturnType<typeof expenseCategories>;
  monthKey: string;
  prevKey: string;
  editing: Budget | null;
  existing: readonly Budget[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [serverError, setServerError] = useState<string | null>(null);
  const state = useAppStore();

  const form = useForm<{ categoryId: string; amount: string }>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      categoryId: editing !== null ? String(editing.categoryId) : '',
      amount: editing !== null ? formatAmount(editing.amountSatang) : '',
    },
    mode: 'onSubmit',
  });

  // See SnapshotDialog: the documented RHF pattern.
  // eslint-disable-next-line react-hooks/incompatible-library
  const formCategory = form.watch('categoryId');

  // The form defaults above cannot depend on `watch` values, so last month's
  // amount is a hint line the user can copy, not an auto-filled value.
  const prevForPicked = useMemo(() => {
    if (formCategory === '') return null;
    const prev = state.budgets.find(
      (b) => b.categoryId === Number(formCategory) && b.periodStart.slice(0, 7) === prevKey,
    );
    return prev?.amountSatang ?? null;
  }, [formCategory, state.budgets, prevKey]);

  const submit = form.handleSubmit(async (values) => {
    try {
      let parsed: number | null;
      try {
        parsed = parseAmount(values.amount);
      } catch {
        parsed = null;
      }
      if (parsed === null || parsed <= 0) return;
      await saveBudget({
        id: editing?.id,
        categoryId: Number(values.categoryId),
        periodStart: `${monthKey}-01`,
        amountSatang: parsed,
      });
      await onSaved();
      onClose();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : t('errors.saveFailed'));
    }
  });

  const takenBy = existing.find(
    (budget) =>
      budget.categoryId === Number(formCategory) &&
      (editing?.id !== budget.id),
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{editing !== null ? t('budgets.edit') : t('budgets.add')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            fullWidth
            label={t('budgets.category')}
            error={form.formState.errors.categoryId !== undefined}
            helperText={form.formState.errors.categoryId?.message}
            {...form.register('categoryId')}
          >
            {categories.map((category) => (
              <MenuItem key={category.id} value={String(category.id)}>
                {category.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            label={t('budgets.amount')}
            placeholder={t('money.amountPlaceholder')}
            error={form.formState.errors.amount !== undefined}
            helperText={form.formState.errors.amount?.message}
            {...form.register('amount')}
          />
          {prevForPicked !== null && editing === null && (
            <Alert severity="info">
              {t('budgets.comparePrevMonth')}: {formatAmount(prevForPicked)}
            </Alert>
          )}
          {takenBy !== undefined && (
            <Alert severity="warning">
              {t('budgets.category')}: {takenBy.periodStart.slice(0, 7)}
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
