// The accounts page: cards, totals, archive/restore, purge with typed confirm.
//
// The header aggregates assets and liabilities straight from the newest
// snapshot of each account (or the opening balance when there is none yet), so
// the totals can never disagree with the cards below them — both read the same
// selector.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import EditIcon from '@mui/icons-material/Edit';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import TimelineIcon from '@mui/icons-material/Timeline';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useAppStore, activeAccounts, archivedAccounts, foreignCurrencyAccounts } from '../../state/appStore';
import type { Account } from '../../db/types';
import {
  archiveAccount,
  restoreAccount,
} from '../../db/repositories/accounts';
import { purgeAccount } from '../../lib/commands';
import { CommandError } from '../../lib/commands';
import { sumSatang, type Satang } from '../../domain/money';
import { formatThaiDate } from '../../domain/dates';
import { t } from '../../i18n/th';
import { BalanceText, ConfirmDialog, EmptyState, StatCard, useUndoSnackbar } from '../../components';
import { AccountDialog } from './AccountDialog';

export function AccountsPage(): ReactNode {
  const state = useAppStore();
  const accounts = activeAccounts(state);
  const archived = archivedAccounts(state);
  const counts = state.snapshotCounts;
  const snapshots = state.snapshots;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Account | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeBlocked, setPurgeBlocked] = useState<string | null>(null);
  const { notify, notifyUndo, element: snackbar } = useUndoSnackbar();

  // Newest snapshot per account: the store's snapshot list is sorted
  // chronologically, so the last row seen for an account is its newest.
  const latestByAccount = new Map<number, { balance: Satang; effectiveAt: string }>();
  for (const snapshot of snapshots) {
    latestByAccount.set(snapshot.accountId, {
      balance: snapshot.balanceSatang,
      effectiveAt: snapshot.effectiveAt,
    });
  }

  const currentBalance = (account: Account): Satang =>
    latestByAccount.get(account.id)?.balance ?? account.openingBalanceSatang;

  const assets = sumSatang(
    accounts.filter((a) => !a.isLiability).map(currentBalance),
  );
  const liabilities = sumSatang(accounts.filter((a) => a.isLiability).map(currentBalance));

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (account: Account) => {
    setEditing(account);
    setDialogOpen(true);
  };

  const handleArchive = async (account: Account) => {
    try {
      await archiveAccount(account.id);
      await useAppStore.getState().reload();
      notifyUndo(t('accounts.archived'), () => {
        void (async () => {
          await restoreAccount(account.id);
          await useAppStore.getState().reload();
        })();
      });
    } catch (error) {
      notify(error instanceof CommandError ? error.message : t('errors.saveFailed'));
    }
  };

  const handleRestore = async (account: Account) => {
    try {
      await restoreAccount(account.id);
      await useAppStore.getState().reload();
      notify(t('accounts.title'));
    } catch (error) {
      notify(error instanceof CommandError ? error.message : t('errors.saveFailed'));
    }
  };

  const handlePurge = async () => {
    if (purgeTarget === null) return;
    setPurging(true);
    try {
      await purgeAccount(purgeTarget.id);
      await useAppStore.getState().reload();
      setPurgeTarget(null);
      notify(t('accounts.purge'));
    } catch (error) {
      const message = error instanceof CommandError ? error.message : t('errors.deleteFailed');
      notify(message);
      if (error instanceof CommandError) setPurgeBlocked(message);
    } finally {
      setPurging(false);
    }
  };

  const foreign = foreignCurrencyAccounts(state);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            {t('accounts.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('accounts.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
          {t('accounts.add')}
        </Button>
      </Stack>

      {foreign.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('accounts.foreignCurrencyWarning')}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard label={t('money.totalAssets')} value={<BalanceText satang={assets} size="h5" />} icon={<AccountBalanceWalletIcon />} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard label={t('money.totalLiabilities')} value={<BalanceText satang={liabilities} size="h5" />} icon={<AccountBalanceWalletIcon />} />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label={t('money.netWorth')}
            value={<BalanceText satang={assets + liabilities} size="h5" />}
            icon={<AccountBalanceWalletIcon />}
            caption={t('money.negativeHint')}
          />
        </Grid>
      </Grid>

      {accounts.length === 0 ? (
        <EmptyState
          title={t('accounts.noAccounts')}
          hint={t('accounts.noAccountsHint')}
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
              {t('accounts.add')}
            </Button>
          }
          icon={<AccountBalanceWalletIcon fontSize="inherit" />}
        />
      ) : (
        <Grid container spacing={2}>
          {accounts.map((account) => {
            const count = counts.get(account.id) ?? 0;
            const balance = currentBalance(account);
            return (
              <Grid key={account.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Stack direction={"row"} spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                      <Typography variant="h6" component="h2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                        {account.name}
                      </Typography>
                      <Chip size="small" label={t(`accountType.${account.accountType}`)} />
                    </Stack>
                    <BalanceText satang={balance} size="h4" />
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                      {count === 0
                        ? t('accounts.neverUpdated')
                        : `${t('accounts.lastUpdated')}: ${formatThaiDate(
                            latestByAccount.get(account.id)?.effectiveAt ?? '',
                          )}`}
                    </Typography>
                    {account.numberSuffix !== null && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        ••••{account.numberSuffix}
                      </Typography>
                    )}
                  </CardContent>
                  <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                    <IconButton size="small" aria-label={t('accounts.openTimeline')} onClick={() => { /* wired when the timeline slice lands */ }}>
                      <TimelineIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label={t('app.edit')} onClick={() => { openEdit(account); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label={t('accounts.archive')} onClick={() => { void handleArchive(account); }}>
                      <ArchiveIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label={t('accounts.purge')} onClick={() => { setPurgeBlocked(null); setPurgeTarget(account); }}>
                      <DeleteForeverIcon fontSize="small" />
                    </IconButton>
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {archived.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            {t('accounts.archivedSection')}
          </Typography>
          <Stack spacing={1}>
            {archived.map((account) => (
              <Stack
                key={account.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
              >
                <Typography sx={{ flexGrow: 1 }}>{account.name}</Typography>
                <Chip size="small" label={t('accounts.archived')} />
                <Button size="small" startIcon={<UnarchiveIcon />} onClick={() => { void handleRestore(account); }}>
                  {t('accounts.restore')}
                </Button>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      <AccountDialog
        open={dialogOpen}
        account={editing}
        onClose={() => { setDialogOpen(false); }}
        onSaved={async () => {
          await useAppStore.getState().reload();
          notify(t('app.save'));
        }}
      />

      <ConfirmDialog
        open={purgeTarget !== null}
        title={t('accounts.purgeConfirmTitle')}
        body={
          <>
            <Typography variant="body2" component="div">
              {t('accounts.purgeConfirmBody')}
            </Typography>
            {purgeBlocked !== null && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {purgeBlocked}
              </Alert>
            )}
          </>
        }
        requirePhrase={purgeTarget?.name}
        phraseLabel={t('accounts.purgeConfirmInstruction')}
        danger
        busy={purging}
        confirmLabel={t('accounts.purge')}
        onConfirm={() => { void handlePurge(); }}
        onClose={() => { setPurgeTarget(null); }}
      />

      {snackbar}
    </Box>
  );
}
