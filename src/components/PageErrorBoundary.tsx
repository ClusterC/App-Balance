// The page-level error boundary.
//
// Without this, any error thrown while rendering a page unmounts the whole
// React tree — the navigation rail included — which the user sees as a blank
// white window with nothing left to click. The boundary logs the real error
// (never silently swallowed), offers a retry, and the rail stays interactive
// so the user can simply navigate away.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { t } from '../i18n/th';

export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error | null } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged, not swallowed: the message and component stack go to the
    // console so a bug report has something concrete in it.
    console.error('Page render failed:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          py: 8,
          textAlign: 'center',
        }}
        role="alert"
      >
        <Typography variant="h6" component="h2">
          {t('errors.unexpected')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
          {t('errors.genericHint')}
        </Typography>
        <Typography
          variant="caption"
          component="div"
          sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxWidth: 640, opacity: 0.7 }}
        >
          {error.message}
        </Typography>
        <Button variant="contained" onClick={() => { this.setState({ error: null }); }}>
          {t('app.retry')}
        </Button>
      </Box>
    );
  }
}
