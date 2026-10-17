// The transactions page.
//
// Lists explicit income, expense, adjustment and transfer rows, newest first,
// with the same filter set as the timeline. Transfers show both legs joined by
// their group id and delete as a pair through one command.

import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useAppStore, accountById, categoryById } from '../../state/appStore';
import type { Transaction, TransactionKind } from '../../db/types';
import { deleteTransaction } from '../../db/repositories/transactions';
import { deleteTransfer, CommandError } from '../../lib/commands';
import { formatThaiDateTime, bangkokDateKey } from '../../domain/dates';
import { t } from '../../i18n/th';
import { AmountText, ConfirmDialog, EmptyState, useUndoSnackbar } from '../../components';
import { TransactionDialog } from './TransactionDialog';

const KINDS: readonly (TransactionKind | 'all')[] = [
  'all',
  'income',
  'expense',
  'transfer_in',
  'transfer_out',
  'adjustment',
];

interface Filters {
  search: string;
  accountId: number | 'all';
  range: { start: string; end: string } | null;
  kind: TransactionKind | 'all';
}

const NO_FILTERS: Filters = { search: '', accountId: 'all', range: null, kind: 'all' };

export function TransactionsPage(): ReactNode {
  const state = useAppStore();
  const { notify, element: snackbar } = useUndoSnackbar();

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAccount, setDialogAccount] = useState<number | 'all' | 'transfer'>('all');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hasFilter =
    filters.search !== '' ||
    filters.accountId !== 'all' ||
    filters.range !== null ||
    filters.kind !== 'all';

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const matching = state.transactions.filter((tx) => {
      if (filters.accountId !== 'all' && tx.accountId !== filters.accountId) return false;
      if (filters.kind !== 'all' && tx.kind !== filters.kind) return false;
      if (filters.range !== null) {
        const dateKey = bangkokDateKey(tx.occurredAt);
        if (dateKey < filters.range.start || dateKey > filters.range.end) return false;
      }
      if (search !== '') {
        const account = accountById(state, tx.accountId);
        const category = categoryById(state, tx.categoryId);
        const haystack = [account?.name, category?.name, tx.note]
          .filter((part): part is string => part !== undefined && part !== null)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    return [...matching].sort((a, b) =>
      a.occurredAt === b.occurredAt ? b.id - a.id : a.occurredAt < b.occurredAt ? 1 : -1,
    );
  }, [state, filters]);

  const openAdd = (account: number | 'all' | 'transfer') => {
    setEditing(null);
    setDialogAccount(account);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    setDeleting(true);
    try {
      if (deleteTarget.transferGroupId !== null) {
        await deleteTransfer(deleteTarget.transferGroupId);
        notify(t('app.delete'));
      } else {
        await deleteTransaction(deleteTarget.id);
        notify(t('app.delete'));
      }
      await useAppStore.getState().reload();
      setDeleteTarget(null);
    } catch (error) {
      notify(error instanceof CommandError ? error.message : t('errors.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            {t('transactions.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('transactions.subtitle')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<SwapHorizIcon />}
            onClick={() => {
              openAdd('transfer');
            }}
          >
            {t('transactions.addTransfer')}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              openAdd('all');
            }}
          >
            {t('transactions.add')}
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1.5, mb: 2 }}>
        <TextField
          size="small"
          sx={{ minWidth: 280, flexGrow: 1, maxWidth: 420 }}
          label={t('search.placeholder')}
          value={filters.search}
          onChange={(event) => {
            setFilters((f) => ({ ...f, search: event.target.value }));
          }}
        />
        <TextField
          select
          size="small"
          sx={{ minWidth: 180 }}
          label={t('timeline.account')}
          value={filters.accountId === 'all' ? 'all' : String(filters.accountId)}
          onChange={(event) => {
            const value = event.target.value;
            setFilters((f) => ({ ...f, accountId: value === 'all' ? 'all' : Number(value) }));
          }}
        >
          <MenuItem value="all">{t('app.all')}</MenuItem>
          {state.accounts
            .filter((a) => !a.isArchived)
            .map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {account.name}
              </MenuItem>
            ))}
        </TextField>
        <TextField
          select
          size="small"
          sx={{ minWidth: 160 }}
          label={t('transactions.kind')}
          value={filters.kind}
          onChange={(event) => {
            const value = event.target.value;
            setFilters((f) => ({
              ...f,
              kind: value === 'all' ? 'all' : (value as TransactionKind),
            }));
          }}
        >
          {KINDS.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {kind === 'all' ? t('app.all') : t(`transactionKind.${kind}`)}
            </MenuItem>
          ))}
        </TextField>
        {hasFilter && (
          <Button
            size="small"
            onClick={() => {
              setFilters(NO_FILTERS);
            }}
          >
            {t('app.clearFilter')}
          </Button>
        )}
      </Stack>

      {state.transactions.length === 0 ? (
        <EmptyState
          title={t('transactions.noTransactions')}
          hint={t('transactions.noTransactionsHint')}
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { openAdd('all'); }}>
              {t('transactions.add')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title={t('transactions.noTransactionsForFilter')} />
      ) : (
        <Stack spacing={1.5}>
          {filtered.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              onEdit={() => {
                setEditing(tx);
                setDialogAccount('all');
                setDialogOpen(true);
              }}
              onDelete={() => {
                setDeleteTarget(tx);
              }}
            />
          ))}
        </Stack>
      )}

      <TransactionDialog
        open={dialogOpen}
        accounts={state.accounts.filter((a) => !a.isArchived)}
        categories={state.categories}
        defaultAccountId={dialogAccount}
        transaction={editing}
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
        title={t('transactions.deleteConfirmTitle')}
        body={
          deleteTarget?.transferGroupId != null
            ? t('transactions.transferCreatesTwo')
            : t('transactions.deleteConfirmBody')
        }
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

function TransactionRow({
  tx,
  onEdit,
  onDelete,
}: {
  tx: Transaction;
  onEdit: () => void;
  onDelete: () => void;
}): ReactNode {
  const state = useAppStore();
  const account = accountById(state, tx.accountId);
  const category = categoryById(state, tx.categoryId);
  const isTransfer = tx.kind === 'transfer_in' || tx.kind === 'transfer_out';

  return (
    <Card variant="outlined">
      <CardContent
        sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2, '&:last-child': { pb: 2 } }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="subtitle1" component="span" sx={{ fontWeight: 600 }}>
              {account?.name ?? `#${tx.accountId}`}
            </Typography>
            <Chip size="small" variant="outlined" label={t(`transactionKind.${tx.kind}`)} />
            {category !== undefined && <Chip size="small" label={category.name} />}
            {tx.linkedSnapshotId !== null && (
              <Tooltip title={t('transactions.linkedToSnapshot')}>
                <Chip size="small" color="info" variant="outlined" label={t('transactions.linkedSnapshot')} />
              </Tooltip>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {formatThaiDateTime(tx.occurredAt)}
          </Typography>
          {tx.note !== null && tx.note !== '' && (
            <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
              {tx.note}
            </Typography>
          )}
        </Box>
        <Box sx={{ flexShrink: 0, textAlign: 'end' }}>
          <AmountText
            satang={tx.amountSatang}
            showSign
            tone={isTransfer ? 'neutral' : tx.amountSatang < 0 ? 'expense' : 'income'}
          />
        </Box>
        <Stack sx={{ flexShrink: 0 }}>
          {/* A transfer's legs are one unit: editing one leg alone would break
              the pair, so only whole transfers are deleted, never edited. */}
          {tx.transferGroupId === null && (
            <Tooltip title={t('transactions.edit')}>
              <IconButton size="small" onClick={onEdit} aria-label={t('transactions.edit')}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('app.delete')}>
            <IconButton size="small" onClick={onDelete} aria-label={t('app.delete')}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </CardContent>
    </Card>
  );
}

