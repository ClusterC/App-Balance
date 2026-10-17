// The forecast page.
//
// A thin, honest surface over `domain/forecast.ts`: choose a horizon and a
// history window, hand the pure function the expense observations, and render
// exactly what it returns — including "insufficient data" when it says so.
// Every disclosure the spec requires is on the page: method, periods used,
// history range, confidence band, and the not-financial-advice disclaimer.

import { useMemo, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useAppStore, allSnapshotsAsDomain } from '../../state/appStore';
import {
  forecastExpenses,
  expenseObservations,
  HORIZONS,
  type ForecastHorizon,
  type ForecastResult,
} from '../../domain/forecast';
import {
  todayKey,
  addMonthsKey,
  bangkokDateKey,
  formatThaiDate,
} from '../../domain/dates';
import { formatAmount } from '../../domain/money';
import { t } from '../../i18n/th';
import { ChartCard, EmptyState } from '../../components';

type HistoryWindow = '3mo' | '6mo' | '12mo';

const HISTORY_MONTHS: Record<HistoryWindow, number> = { '3mo': 3, '6mo': 6, '12mo': 12 };

export function ForecastPage(): ReactNode {
  const state = useAppStore();

  const [horizon, setHorizon] = useState<ForecastHorizon>(HORIZONS[1] ?? { kind: '30d', label: '30 วัน' });
  const [history, setHistory] = useState<HistoryWindow>('6mo');

  const result = useMemo<ForecastResult | null>(() => {
    const today = todayKey();
    const fromKey = addMonthsKey(today, -HISTORY_MONTHS[history]);
    const observations = expenseObservations({
      transactions: state.transactions,
      snapshots: allSnapshotsAsDomain(state).map((s) => ({
        id: s.id,
        derivedDeltaSatang: s.derivedDeltaSatang,
        effectiveAt: s.effectiveAt,
        updateType: s.updateType,
        isClassified: s.isClassified,
      })),
      fromKey,
      toKey: today,
      dateKeyOf: bangkokDateKey,
    });
    if (observations.length === 0) return null;
    return forecastExpenses({ observations, horizon, today });
  }, [state, horizon, history]);

  return (
    <Box>
      <Typography variant="h4" component="h1">
        {t('forecast.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('forecast.subtitle')}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 1.5, mb: 3 }}>
        <TextField
          select
          size="small"
          sx={{ minWidth: 170 }}
          label={t('forecast.horizon')}
          value={horizon.kind}
          onChange={(event) => {
            const found = HORIZONS.find((h) => h.kind === event.target.value);
            if (found) setHorizon(found);
          }}
        >
          <MenuItem value="7d">{t('forecast.horizon7d')}</MenuItem>
          <MenuItem value="30d">{t('forecast.horizon30d')}</MenuItem>
          <MenuItem value="3mo">{t('forecast.horizon3mo')}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          sx={{ minWidth: 170 }}
          label={t('forecast.historyWindow')}
          value={history}
          onChange={(event) => {
            setHistory(event.target.value as HistoryWindow);
          }}
        >
          <MenuItem value="3mo">3 {t('forecast.periodMonth')}</MenuItem>
          <MenuItem value="6mo">6 {t('forecast.periodMonth')}</MenuItem>
          <MenuItem value="12mo">12 {t('forecast.periodMonth')}</MenuItem>
        </TextField>
      </Stack>

      {result === null ? (
        <EmptyState title={t('forecast.noData')} hint={t('forecast.noDataHint')} />
      ) : !result.sufficient ? (
        <Alert severity="warning">
          <Typography variant="subtitle2" component="div">
            {t('forecast.insufficient')}
          </Typography>
          <Typography variant="body2" component="div">
            {t('forecast.insufficientBody', {
              period: result.grain === 'month' ? t('forecast.periodMonth') : t('forecast.periodWeek'),
              have: result.periodsAvailable,
            })}
          </Typography>
        </Alert>
      ) : (
        <ForecastDisplay result={result} />
      )}

      <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mt: 3 }}>
        {t('forecast.disclaimer')}
      </Alert>
    </Box>
  );
}

function ForecastDisplay({ result }: { result: ForecastResult }): ReactNode {
  const periodLabel =
    result.grain === 'month' ? t('forecast.periodMonth') : t('forecast.periodWeek');
  const methodLabel =
    result.method === 'wma_trend' ? t('forecast.methodWmaTrend') : t('forecast.methodWma');

  return (
    <Stack spacing={3}>
      {/* ── headline ────────────────────────────────────────────────── */}
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2, '& > *': { flex: '1 1 200px' } }}>
        <HeadlineStat
          label={t('forecast.predicted')}
          value={formatAmount(result.amountSatang ?? 0)}
          caption={t('forecast.perPeriod', { period: periodLabel })}
        />
        {result.hasConfidenceBand && (
          <HeadlineStat
            label={t('forecast.confidence')}
            value={`${formatAmount(result.lowerSatang ?? 0)} – ${formatAmount(result.upperSatang ?? 0)}`}
          />
        )}
      </Stack>

      {/* ── disclosures ─────────────────────────────────────────────── */}
      <Stack spacing={0.5}>
        <Disclosure label={t('forecast.method')} value={methodLabel} />
        <Disclosure label={t('forecast.periodsUsed')} value={`${result.periodsUsed} / ${result.periodsAvailable}`} />
        {result.historyRange !== null && (
          <Disclosure
            label={t('forecast.historyRange')}
            value={`${formatThaiDate(result.historyRange.start)} — ${formatThaiDate(result.historyRange.end)}`}
          />
        )}
        {result.excludedOutliers > 0 && (
          <Disclosure
            label={t('forecast.outliersExcluded', { count: result.excludedOutliers })}
            value={t('forecast.outliersNote')}
          />
        )}
        {result.sparse && <Disclosure label={t('forecast.notAdvice')} value={t('forecast.sparseNote')} />}
      </Stack>

      {/* ── chart ───────────────────────────────────────────────────── */}
      <ChartCard
        title={t('forecast.actualVsForecast')}
        summary={`${t('forecast.predicted')} ${formatAmount(result.perPeriodSatang ?? 0)} / ${periodLabel}`}
        height={280}
      >
        <ForecastChart result={result} />
      </ChartCard>
    </Stack>
  );
}

function HeadlineStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}): ReactNode {
  return (
    <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="h5" component="div" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
      {caption !== undefined && (
        <Typography variant="caption" color="text.secondary" component="div">
          {caption}
        </Typography>
      )}
    </Box>
  );
}

function Disclosure({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <Stack direction="row" spacing={1}>
      <Typography variant="body2" color="text.secondary" component="span" sx={{ minWidth: 180 }}>
        {label}:
      </Typography>
      <Typography variant="body2" component="span">
        {value}
      </Typography>
    </Stack>
  );
}

// ── chart ───────────────────────────────────────────────────────────────────

import { LineChart } from '@mui/x-charts/LineChart';

function ForecastChart({ result }: { result: ForecastResult }): ReactNode {
  const history = result.periods.filter((period) => period.actualSatang !== null);
  if (history.length === 0) {
    return <EmptyState title={t('forecast.noData')} />;
  }
  return (
    <LineChart
      height={230}
      xAxis={[
        {
          data: result.periods.map((period) => period.key),
          scaleType: 'point',
          tickLabelStyle: { fontSize: 10 },
        },
      ]}
      series={[
        {
          data: result.periods.map((period) =>
            period.actualSatang === null ? null : period.actualSatang / 100,
          ),
          label: t('forecast.actual'),
          showMark: true,
        },
        {
          data: result.periods.map((period) => period.fittedSatang / 100),
          label: t('forecast.forecastLine'),
          showMark: false,
        },
      ]}
      slotProps={{ legend: { position: { vertical: 'top', horizontal: 'center' } } }}
      grid={{ vertical: false, horizontal: true }}
    />
  );
}
