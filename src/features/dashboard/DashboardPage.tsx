// The dashboard.
//
// The at-a-glance view: totals derived from the newest snapshot per account,
// this month's cashflow from the same `aggregatePeriod` the reports use, the
// balance trend, recent timeline entries, and the staleness warning driven by
// the settings' threshold.

import { useMemo, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import HelpOutlineIcon from '@mui/icons-material/Help';
import { useAppStore, activeAccounts, currentMonthKey } from '../../state/appStore';
import {
  aggregatePeriod,
  buildBalanceSeries,
  splitAssetsAndLiabilities,
} from '../../domain/cashflow';
import { compareNewestFirst } from '../../domain/snapshots';
import { monthRange, daysSince, formatThaiDateTime, formatThaiDate } from '../../domain/dates';
import { formatAmount, type Satang } from '../../domain/money';
import { t } from '../../i18n/th';
import {
  AmountText,
  BalanceText,
  ChangeText,
  ChartCard,
  EmptyState,
  StatCard,
} from '../../components';

export function DashboardPage(): ReactNode {
  const state = useAppStore();
  const accounts = activeAccounts(state);

  const latestByAccount = useMemo(() => {
    const map = new Map<number, Satang>();
    const ordered = [...state.snapshots].sort(compareNewestFirst);
    for (const snapshot of ordered) {
      if (!map.has(snapshot.accountId)) map.set(snapshot.accountId, snapshot.balanceSatang);
    }
    return map;
  }, [state.snapshots]);

  const currentBalance = (accountId: number, opening: Satang): Satang =>
    latestByAccount.get(accountId) ?? opening;

  const { assets, liabilities, netWorth } = useMemo(() => {
    const balances = new Map<number, Satang>();
    for (const account of accounts) {
      balances.set(account.id, currentBalance(account.id, account.openingBalanceSatang));
    }
    return splitAssetsAndLiabilities(
      balances,
      accounts.map((account) => ({ id: account.id, isLiability: account.isLiability })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, latestByAccount]);

  const monthRangeValue = monthRange(currentMonthKey());

  const summary = useMemo(
    () =>
      aggregatePeriod({
        transactions: state.transactions,
        snapshots: state.snapshots.map((s) => ({
          id: s.id,
          accountId: s.accountId,
          balanceSatang: s.balanceSatang,
          effectiveAt: s.effectiveAt,
          updateType: s.updateType,
          categoryId: s.categoryId,
          note: s.note,
          derivedDeltaSatang: s.derivedDeltaSatang,
          prevSnapshotId: s.prevSnapshotId,
          isClassified: s.isClassified,
        })),
        range: monthRangeValue,
        categories: state.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
        accounts: state.accounts.map((a) => ({ id: a.id, name: a.name })),
      }),
    [state, monthRangeValue],
  );

  const series = useMemo(
    () =>
      buildBalanceSeries({
        snapshots: state.snapshots.map((s) => ({
          id: s.id,
          accountId: s.accountId,
          balanceSatang: s.balanceSatang,
          effectiveAt: s.effectiveAt,
          updateType: s.updateType,
          categoryId: s.categoryId,
          note: s.note,
          derivedDeltaSatang: s.derivedDeltaSatang,
          prevSnapshotId: s.prevSnapshotId,
          isClassified: s.isClassified,
        })),
        accounts: state.accounts.map((a) => ({
          id: a.id,
          openingBalanceSatang: a.openingBalanceSatang,
          openingDate: a.openingDate,
        })),
        range: monthRangeValue,
      }),
    [state, monthRangeValue],
  );

  // Staleness: days since the newest snapshot across all accounts.
  const newestSnapshot = useMemo(() => {
    const ordered = [...state.snapshots].sort(compareNewestFirst);
    return ordered[0] ?? null;
  }, [state.snapshots]);
  const staleDays = newestSnapshot !== null ? daysSince(newestSnapshot.effectiveAt) : null;
  const isStale = staleDays !== null && staleDays >= state.settings.stalenessThresholdDays;

  const recent = useMemo(() => {
    const ordered = [...state.snapshots].sort(compareNewestFirst);
    return ordered.slice(0, 5);
  }, [state.snapshots]);

  if (accounts.length === 0) {
    return (
      <Box>
        <Typography variant="h4" component="h1">
          {t('dashboard.title')}
        </Typography>
        <EmptyState title={t('dashboard.noData')} hint={t('dashboard.noDataHint')} />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" component="h1">
        {t('dashboard.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('dashboard.subtitle')}
      </Typography>

      {isStale && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" component="div">
            {t('dashboard.staleWarning')}
          </Typography>
          <Typography variant="body2" component="div">
            {t('dashboard.staleWarningBody', { days: staleDays })}
          </Typography>
        </Alert>
      )}

      {/* ── headline totals ─────────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label={t('money.totalAssets')}
            value={<BalanceText satang={assets} size="h5" />}
            icon={<AccountBalanceWalletIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label={t('money.totalLiabilities')}
            value={<BalanceText satang={liabilities} size="h5" />}
            icon={<TrendingDownIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatCard
            label={t('money.netWorth')}
            value={<BalanceText satang={netWorth} size="h5" />}
            icon={<TrendingUpIcon />}
          />
        </Grid>
      </Grid>

      {/* ── this month's cashflow ───────────────────────────────────── */}
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
        {t('dashboard.thisMonth')}
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label={t('money.income')} value={<AmountText satang={summary.income} tone="income" showSign />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label={t('money.expense')} value={<AmountText satang={summary.expense} tone="expense" showSign />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label={t('money.net')} value={<ChangeText satang={summary.net} />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label={t('dashboard.unclassifiedTotal')}
            value={<AmountText satang={summary.unclassified} />}
            caption={`${summary.unclassifiedCount}`}
            icon={<HelpOutlineIcon />}
          />
        </Grid>
      </Grid>

      {/* ── trend chart ─────────────────────────────────────────────── */}
      <ChartCard
        title={t('dashboard.netWorthTrend')}
        summary={`${t('money.netWorth')}: ${series.length > 0 ? formatAmount(series[series.length - 1]?.balanceSatang ?? 0) : ''}`}
        height={280}
        caption={`${formatThaiDate(monthRangeValue.start)} — ${formatThaiDate(monthRangeValue.end)}`}
        sx={{ mb: 3 }}
      >
        <TrendChart data={series.map((point) => ({ dateKey: point.dateKey, balanceSatang: point.balanceSatang }))} />
      </ChartCard>

      {/* ── recent updates ──────────────────────────────────────────── */}
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
        {t('dashboard.recentUpdates')}
      </Typography>
      {recent.length === 0 ? (
        <EmptyState title={t('timeline.noSnapshots')} hint={t('timeline.noSnapshotsHint')} />
      ) : (
        <Stack spacing={1} sx={{ mb: 3 }}>
          {recent.map((snapshot) => {
            const account = state.accounts.find((a) => a.id === snapshot.accountId);
            return (
              <Stack
                key={snapshot.id}
                direction="row"
                spacing={2}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {account?.name ?? `#${snapshot.accountId}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatThaiDateTime(snapshot.effectiveAt)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <ChangeText satang={snapshot.derivedDeltaSatang} />
                  <BalanceText satang={snapshot.balanceSatang} />
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

// ── chart ───────────────────────────────────────────────────────────────────

import { LineChart } from '@mui/x-charts/LineChart';

function TrendChart({
  data,
}: {
  data: readonly { dateKey: string; balanceSatang: Satang }[];
}): ReactNode {
  if (data.length < 2) {
    return <EmptyState title={t('dashboard.noData')} />;
  }
  return (
    <LineChart
      height={230}
      xAxis={[
        {
          data: data.map((point) => point.dateKey),
          scaleType: 'band',
          tickLabelStyle: { fontSize: 10 },
        },
      ]}
      series={[
        {
          data: data.map((point) => point.balanceSatang / 100),
          label: t('money.netWorth'),
          showMark: false,
        },
      ]}
      yAxis={[{ valueFormatter: (value: number) => `${value.toLocaleString()}฿` }]}
      grid={{ vertical: false, horizontal: true }}
    />
  );
}
