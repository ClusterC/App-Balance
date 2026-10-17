// Reproduction test: navigate to Forecast and back, with empty and with data.
//
// The store's `load()` is bypassed: the store is seeded directly, so the test
// exercises the page against the same shapes the real store would hold.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, type RenderResult } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ForecastPage } from './ForecastPage';
import { useAppStore } from '../../state/appStore';
import { theme } from '../../theme';
import { DEFAULT_SETTINGS } from '../../db/repositories/settings';
import { t } from '../../i18n/th';

function renderPage(): RenderResult {
  return render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ForecastPage />
    </ThemeProvider>,
  );
}

describe('ForecastPage', () => {
  beforeEach(() => {
    useAppStore.setState({
      status: 'ready',
      error: null,
      errorDetail: null,
      accounts: [],
      categories: [],
      snapshots: [],
      transactions: [],
      budgets: [],
      settings: DEFAULT_SETTINGS,
      snapshotCounts: new Map(),
      transactionDates: new Map(),
      linkedSnapshotIds: new Set(),
    });
  });

  it('renders the empty state when there is no data at all', async () => {
    renderPage();
    expect(await screen.findByText(t('forecast.title'))).toBeInTheDocument();
    expect(screen.getByText(t('forecast.noData'))).toBeInTheDocument();
  });

  it('renders a warning (not a crash) when history is too short', () => {
    // Two weeks of data — below MIN_PERIODS = 4.
    const now = Date.now();
    const transactions = [0, 1, 2].map((i) => ({
      id: i + 1,
      accountId: 1,
      kind: 'expense' as const,
      amountSatang: 10_000 + i,
      currency: 'THB',
      categoryId: null,
      occurredAt: new Date(now - i * 3 * 86_400_000).toISOString(),
      note: null,
      transferGroupId: null,
      linkedSnapshotId: null,
    }));
    useAppStore.setState({ transactions });
    renderPage();
    expect(screen.getByText(t('forecast.insufficient'))).toBeInTheDocument();
  });

  it('renders the full forecast when history is sufficient', () => {
    // Five weekly expenses, well inside the 6-month history window.
    const now = Date.now();
    const transactions = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      accountId: 1,
      kind: 'expense' as const,
      amountSatang: 50_000 + i * 100,
      currency: 'THB',
      categoryId: null,
      occurredAt: new Date(now - i * 7 * 86_400_000).toISOString(),
      note: null,
      transferGroupId: null,
      linkedSnapshotId: null,
    }));
    useAppStore.setState({ transactions });
    renderPage();
    expect(screen.getByText(t('forecast.predicted'))).toBeInTheDocument();
  });

  it('renders after switching data between renders (simulating back-and-forth navigation)', () => {
    const now = Date.now();
    const makeTx = (id: number, occurredAt: string) => ({
      id,
      accountId: 1,
      kind: 'expense' as const,
      amountSatang: 20_000,
      currency: 'THB',
      categoryId: null,
      occurredAt,
      note: null,
      transferGroupId: null,
      linkedSnapshotId: null,
    });
    useAppStore.setState({ transactions: [makeTx(1, new Date(now).toISOString())] });
    const { unmount } = renderPage();
    expect(screen.getByText(t('forecast.insufficient'))).toBeInTheDocument();
    unmount();

    useAppStore.setState({ transactions: [] });
    renderPage();
    expect(screen.getByText(t('forecast.noData'))).toBeInTheDocument();
    unmount();

    useAppStore.setState({
      transactions: Array.from({ length: 6 }, (_, i) =>
        makeTx(i + 1, new Date(now - i * 7 * 86_400_000).toISOString()),
      ),
    });
    renderPage();
    expect(screen.getAllByText(t('forecast.predicted')).length).toBeGreaterThan(0);
  });
});
