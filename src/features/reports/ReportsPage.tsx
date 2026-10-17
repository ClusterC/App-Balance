// The reports page.
//
// One reporting window, chosen as a preset or a custom range, aggregated by
// the domain's `aggregatePeriod` and compared against the equally long window
// before it. Charts carry Thai text summaries through `ChartCard`; the CSV
// export buttons write UTF-8 files through the Rust CSV command.

import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import { useAppStore, allSnapshotsAsDomain } from '../../state/appStore';
import {
  compareWithPrevious,
  buildBalanceSeries,
  type CashflowSummary,
} from '../../domain/cashflow';
import {
  todayKey,
  monthRange,
  weekRange,
  previousRange,
  addMonthsKey,
  formatThaiDate,
  type DateRange,
} from '../../domain/dates';
import { formatAmount, formatPercent, type Satang } from '../../domain/money';
import { exportTable, accountsTable, snapshotsTable, transactionsTable, categoriesTable, periodTable } from '../../lib/csv';
import { listSnapshotDetails } from '../../db/repositories/snapshots';
import { t } from '../../i18n/th';
import { AmountText, ChangeText, ChartCard, EmptyState, StatCard, useUndoSnackbar } from '../../components';

type Preset = 'thisWeek' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

function resolveRange(preset: Preset, custom: DateRange | null): DateRange | null {
  const today = todayKey();
  switch (preset) {
    case 'thisWeek':
      return weekRange(today);
    case 'thisMonth':
      return monthRange(today.slice(0, 7));
    case 'lastMonth':
      return monthRange(addMonthsKey(today.slice(0, 7), -1));
    case 'last3Months': {
      const end = monthRange(today.slice(0, 7)).end;
      const start = monthRange(addMonthsKey(today.slice(0, 7), -2)).start;
      return { start, end };
    }
    case 'thisYear':
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case 'custom':
      return custom;
  }
}

export function ReportsPage(): ReactNode {
  const state = useAppStore();
  const { notify, element: snackbar } = useUndoSnackbar();

  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState<DateRange | null>(null);

  const range = resolveRange(preset, custom);

  const input = useMemo(() => {
    if (range === null) return null;
    return {
      transactions: state.transactions,
      snapshots: allSnapshotsAsDomain(state),
      categories: state.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
      accounts: state.accounts.map((a) => ({ id: a.id, name: a.name, openingBalanceSatang: a.openingBalanceSatang, openingDate: a.openingDate })),
    };
  }, [state, range]);

  const comparison = useMemo(() => {
    if (input === null || range === null) return null;
    return compareWithPrevious(input, range, previousRange(range));
  }, [input, range]);

  const series = useMemo(() => {
    if (input === null || range === null) return null;
    return buildBalanceSeries({
      snapshots: input.snapshots,
      accounts: state.accounts,
      range,
    });
  }, [input, range, state.accounts]);

  if (range === null || input === null || comparison === null) {
    return (
      <Box>
        <Typography variant="h4" component="h1">
          {t('reports.title')}
        </Typography>
        <EmptyState title={t('reports.noDataForPeriod')} hint={t('reports.noDataForPeriodHint')} />
      </Box>
    );
  }

  const summary = comparison.current;

  const handleExport = async (kind: 'accounts' | 'snapshots' | 'transactions' | 'categories' | 'period') => {
    try {
      if (kind === 'accounts') {
        await exportTable('accounts', accountsTable(state.accounts), todayKey());
      } else if (kind === 'transactions') {
        await exportTable('transactions', transactionsTable(state.transactions), todayKey());
      } else if (kind === 'categories') {
        await exportTable('categories', categoriesTable(state.categories), todayKey());
      } else if (kind === 'snapshots') {
        const details = await listSnapshotDetails(range.start, range.end);
        await exportTable('snapshots', snapshotsTable(details), todayKey());
      } else {
        await exportTable('period', periodTable(periodRows(summary)), todayKey());
      }
      notify(t('reports.exportSuccess', { path: '' }));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('reports.exportFailed'));
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h1">
        {t('reports.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('reports.subtitle')}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1.5, mb: 3 }}>
        <TextField
          select
          size="small"
          sx={{ minWidth: 180 }}
          label={t('reports.period')}
          value={preset}
          onChange={(event) => {
            setPreset(event.target.value as Preset);
          }}
        >
          <MenuItem value="thisWeek">{t('reports.thisWeek')}</MenuItem>
          <MenuItem value="thisMonth">{t('reports.thisMonth')}</MenuItem>
          <MenuItem value="lastMonth">{t('reports.lastMonth')}</MenuItem>
          <MenuItem value="last3Months">{t('reports.last3Months')}</MenuItem>
          <MenuItem value="thisYear">{t('reports.thisYear')}</MenuItem>
          <MenuItem value="custom">{t('reports.customRange')}</MenuItem>
        </TextField>
        {preset === 'custom' && (
          <>
            <TextField
              size="small"
              type="date"
              sx={{ minWidth: 160 }}
              label={t('reports.from')}
              value={custom?.start ?? ''}
              onChange={(event) => {
                setCustom((c) => ({ start: event.target.value, end: c?.end ?? event.target.value }));
              }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              type="date"
              sx={{ minWidth: 160 }}
              label={t('reports.to')}
              value={custom?.end ?? ''}
              onChange={(event) => {
                setCustom((c) => ({ start: c?.start ?? event.target.value, end: event.target.value }));
              }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </>
        )}
        <Button
          startIcon={<DownloadIcon />}
          onClick={() => {
            void handleExport('period');
          }}
        >
          {t('reports.exportCsv')}
        </Button>
      </Stack>

      {summary.transactionCount === 0 && summary.unclassifiedCount === 0 && (
        <EmptyState title={t('reports.noDataForPeriod')} hint={t('reports.noDataForPeriodHint')} />
      )}

      {/* ── summary ─────────────────────────────────────────────────── */}
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2, mb: 3, '& > *': { flex: '1 1 200px' } }}>
        <StatCard
          label={t('reports.totalIncome')}
          value={<AmountText satang={summary.income} tone="income" showSign size="h5" />}
          caption={<CompareCaption change={comparison.incomeChange} />}
        />
        <StatCard
          label={t('reports.totalExpense')}
          value={<AmountText satang={summary.expense} tone="expense" showSign size="h5" />}
          caption={<CompareCaption change={comparison.expenseChange} />}
        />
        <StatCard
          label={t('reports.netChange')}
          value={<ChangeText satang={summary.net} />}
          caption={<CompareCaption change={comparison.netChange} />}
        />
        <StatCard
          label={t('dashboard.unclassifiedTotal')}
          value={<AmountText satang={summary.unclassified} size="h5" />}
          caption={`${summary.unclassifiedCount} ${t('timeline.unclassified')}`}
        />
      </Stack>

      {/* ── balance movement ────────────────────────────────────────── */}
      <ChartCard
        title={t('reports.balanceMovement')}
        summary={`${t('reports.balanceMovement')}: ${series !== null && series.length > 0 ? formatAmount(series[series.length - 1]?.balanceSatang ?? 0) : ''}`}
        height={260}
        caption={`${formatThaiDate(range.start)} — ${formatThaiDate(range.end)}`}
        sx={{ mb: 3 }}
      >
        <BalanceSeriesChart data={series ?? []} />
      </ChartCard>

      {/* ── by category ─────────────────────────────────────────────── */}
      <ChartCard
        title={t('reports.byCategory')}
        summary={rollupSummary(summary.byCategoryExpense)}
        height={260}
        sx={{ mb: 3 }}
      >
        <CategoryBars data={summary.byCategoryExpense} />
      </ChartCard>

      {/* ── by account ──────────────────────────────────────────────── */}
      <ChartCard
        title={t('reports.byAccount')}
        summary={rollupSummary(summary.byAccount)}
        height={260}
        sx={{ mb: 3 }}
      >
        <CategoryBars data={summary.byAccount} />
      </ChartCard>

      {/* ── unclassified section ────────────────────────────────────── */}
      {summary.unclassifiedCount > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mb: 3 }}>
          {t('reports.unclassifiedSection')}: {summary.unclassifiedCount} ·{' '}
          {formatAmount(summary.unclassified)}
        </Typography>
      )}

      {/* ── CSV exports ─────────────────────────────────────────────── */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button size="small" onClick={() => { void handleExport('accounts'); }}>{t('reports.exportAccounts')}</Button>
        <Button size="small" onClick={() => { void handleExport('snapshots'); }}>{t('reports.exportSnapshot')}</Button>
        <Button size="small" onClick={() => { void handleExport('transactions'); }}>{t('reports.exportTransactions')}</Button>
        <Button size="small" onClick={() => { void handleExport('categories'); }}>{t('reports.exportCategories')}</Button>
        <Button size="small" onClick={() => { void handleExport('period'); }}>{t('reports.exportPeriod')}</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {t('reports.csvBomNote')}
      </Typography>
      {snackbar}
    </Box>
  );
}

function CompareCaption({ change }: { change: Satang }): ReactNode {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary" component="span">
        {t('reports.comparePrev')}:
      </Typography>
      <ChangeText satang={change} />
    </Stack>
  );
}

function rollupSummary(rollups: readonly { name: string; amountSatang: Satang; share: number }[]): string {
  if (rollups.length === 0) return t('reports.noDataForPeriod');
  const top = rollups[0];
  if (top === undefined) return t('reports.noDataForPeriod');
  return `${top.name}: ${formatAmount(top.amountSatang)} (${formatPercent(top.share)})`;
}

/** Period rows for the CSV export, one label/value pair per line. */
function periodRows(summary: CashflowSummary): [string, string][] {
  return [
    [t('reports.totalIncome'), formatAmount(summary.income)],
    [t('reports.totalExpense'), formatAmount(summary.expense)],
    [t('reports.netChange'), formatAmount(summary.net)],
    [t('dashboard.unclassifiedTotal'), formatAmount(summary.unclassified)],
  ];
}

// ── charts ──────────────────────────────────────────────────────────────────
//
// MUI X Charts' smallest surface: a plain LineChart/BarChart with the axes the
// figure needs and nothing else. Data stays in satang until `formatAmount`.

import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';

function BalanceSeriesChart({ data }: { data: readonly { dateKey: string; balanceSatang: Satang }[] }): ReactNode {
  if (data.length < 2) {
    return <EmptyState title={t('reports.noDataForPeriod')} />;
  }
  return (
    <LineChart
      height={220}
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

function CategoryBars({ data }: { data: readonly { name: string; amountSatang: Satang }[] }): ReactNode {
  if (data.length === 0) {
    return <EmptyState title={t('reports.noDataForPeriod')} />;
  }
  const top = data.slice(0, 10);
  return (
    <BarChart
      height={220}
      layout="horizontal"
      xAxis={[{ label: '' }]}
      yAxis={[
        {
          data: top.map((row) => row.name),
          scaleType: 'band',
          tickLabelStyle: { fontSize: 11 },
        },
      ]}
      series={[
        {
          data: top.map((row) => Math.abs(row.amountSatang) / 100),
          label: t('money.expense'),
        },
      ]}
      grid={{ vertical: true, horizontal: false }}
    />
  );
}

