// The persistent navigation rail (not a drawer) and the app shell around it.
//
// The spec fixes the page set and the layout: rail at ≥1024px with the eight
// destinations in Thai, content area capped at ~1440px, a skip link for the
// keyboard, and one global error/loading surface so no page repeats it.
//
// Pages arrive one slice at a time; the registry below is the single place a
// new page is wired in.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import SkipLink from '@mui/material/Link';import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import AccountsIcon from '@mui/icons-material/AccountBalanceWallet';
import TimelineIcon from '@mui/icons-material/Timeline';
import TransactionsIcon from '@mui/icons-material/SwapHoriz';
import BudgetsIcon from '@mui/icons-material/PieChart';
import ReportsIcon from '@mui/icons-material/Assessment';
import ForecastIcon from '@mui/icons-material/TrendingUp';
import SettingsIcon from '@mui/icons-material/Settings';
import { t } from './i18n/th';
import { useAppStore } from './state/appStore';
import { layout, theme } from './theme';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { AccountsPage } from './features/accounts/AccountsPage';
import { TimelinePage } from './features/timeline/TimelinePage';
import { TransactionsPage } from './features/transactions/TransactionsPage';
import { BudgetsPage } from './features/budgets/BudgetsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { ForecastPage } from './features/forecast/ForecastPage';
import { SettingsPage } from './features/settings/SettingsPage';

export type PageId =
  | 'dashboard'
  | 'accounts'
  | 'timeline'
  | 'transactions'
  | 'budgets'
  | 'reports'
  | 'forecast'
  | 'settings';

interface PageDef {
  id: PageId;
  label: string;
  icon: ReactNode;
}

const PAGES: readonly PageDef[] = [
  { id: 'dashboard', label: t('nav.dashboard'), icon: <DashboardIcon /> },
  { id: 'accounts', label: t('nav.accounts'), icon: <AccountsIcon /> },
  { id: 'timeline', label: t('nav.timeline'), icon: <TimelineIcon /> },
  { id: 'transactions', label: t('nav.transactions'), icon: <TransactionsIcon /> },
  { id: 'budgets', label: t('nav.budgets'), icon: <BudgetsIcon /> },
  { id: 'reports', label: t('nav.reports'), icon: <ReportsIcon /> },
  { id: 'forecast', label: t('nav.forecast'), icon: <ForecastIcon /> },
  { id: 'settings', label: t('nav.settings'), icon: <SettingsIcon /> },
];

function NavigationRail({
  current,
  onNavigate,
}: {
  current: PageId;
  onNavigate: (page: PageId) => void;
}): ReactNode {
  return (
    <Box
      component="nav"
      aria-label={t('nav.mainNavigation')}
      sx={{
        width: layout.railWidth,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        borderRight: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      {PAGES.map((page) => {
        const active = page.id === current;
        return (
          <Box
            key={page.id}
            component="button"
            type="button"
            onClick={() => {
              onNavigate(page.id);
            }}
            aria-current={active ? 'page' : undefined}
            sx={(th) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.5,
              width: 72,
              py: 1.5,
              px: 1,
              border: 'none',
              borderRadius: `${th.balance.radius.md}px`,
              cursor: 'pointer',
              bgcolor: active ? 'var(--balance-palette-primary-container, rgba(0,0,0,0.06))' : 'transparent',
              color: active ? 'var(--balance-palette-primary-main)' : 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' },
              '&:focus-visible': { outline: `2px solid ${theme.vars?.palette.primary.main ?? 'currentColor'}` },
            })}
          >
            {page.icon}
            <Typography variant="caption" sx={{ fontWeight: active ? 600 : 400 }}>
              {page.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/** The one error boundary surface: shows the store's error, not a thrown tree. */
function ErrorBanner(): ReactNode {
  const error = useAppStore((s) => s.error);
  const errorDetail = useAppStore((s) => s.errorDetail);
  const clearError = useAppStore((s) => s.clearError);
  if (error === null) return null;

  return (
    <Alert
      severity="error"
      onClose={() => {
        clearError();
      }}
      sx={{ mb: 2 }}
    >
      <Typography variant="body2" component="div">
        {error}
      </Typography>
      {errorDetail !== null && (
        <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.8 }}>
          {errorDetail}
        </Typography>
      )}
    </Alert>
  );
}

function LoadingScreen(): ReactNode {
  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
      role="status"
      aria-live="polite"
    >
      <CircularProgress size={40} />
      <Typography variant="body2" color="text.secondary">
        {t('app.loading')}
      </Typography>
    </Box>
  );
}

function FatalErrorScreen({ message, detail }: { message: string; detail: string | null }): ReactNode {
  const load = useAppStore((s) => s.load);
  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        px: 3,
        textAlign: 'center',
      }}
    >
      <Typography variant="h5" component="h1">
        {message}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
        {t('errors.genericHint')}
      </Typography>
      {detail !== null && (
        <Typography
          variant="caption"
          sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxWidth: 640, opacity: 0.7 }}
          component="div"
        >
          {detail}
        </Typography>
      )}
      <Button variant="contained" onClick={() => { void load(); }}>
        {t('app.retry')}
      </Button>
    </Box>
  );
}

export function App(): ReactNode {
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const errorDetail = useAppStore((s) => s.errorDetail);
  const [page, setPage] = useState<PageId>('dashboard');

  const body = (() => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage />;
      case 'accounts':
        return <AccountsPage />;
      case 'timeline':
        return <TimelinePage />;
      case 'transactions':
        return <TransactionsPage />;
      case 'budgets':
        return <BudgetsPage />;
      case 'reports':
        return <ReportsPage />;
      case 'forecast':
        return <ForecastPage />;
      case 'settings':
        return <SettingsPage />;
    }
  })();

  if (status === 'idle' || status === 'loading') {
    return <LoadingScreen />;
  }
  if (status === 'error') {
    return <FatalErrorScreen message={error ?? t('errors.generic')} detail={errorDetail} />;
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <SkipLink
        href="#main-content"
        sx={{
          position: 'absolute',
          left: -9999,
          '&:focus': { left: 8, top: 8, zIndex: theme.zIndex.tooltip + 1 },
        }}
      >
        {t('a11y.skipToContent')}
      </SkipLink>
      <NavigationRail current={page} onNavigate={setPage} />
      <Box
        component="main"
        id="main-content"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          maxWidth: layout.contentMaxWidth,
          mx: 'auto',
          px: layout.pageGutter,
          py: 3,
        }}
      >
        <ErrorBanner />
        <Stack spacing={3}>{body}</Stack>
      </Box>
    </Box>
  );
}

// Re-exported so a test that only wants the shell can assert the page set
// without importing each feature page.
// eslint-disable-next-line react-refresh/only-export-components -- navigation metadata, not a component
export { PAGES as NAV_PAGES };
export type { PageDef };
