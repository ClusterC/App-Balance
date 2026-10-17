// Empty state: an illustration-free card that says what to do next.
//
// The spec requires real empty states — not a blank table — because a
// first-run user with no accounts must be told the first action, not shown
// nothing.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { sxFragment, type SxStyle } from './sxUtils';

export interface EmptyStateProps {
  title: string;
  hint?: string;
  /** Usually a button: the action that fills the list. */
  action?: ReactNode;
  icon?: ReactNode;
  sx?: SxStyle;
}

export function EmptyState({ title, hint, action, icon, sx }: EmptyStateProps): ReactNode {
  return (
    <Box
      sx={[
        {
          py: 8,
          px: 3,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
        },
        ...sxFragment(sx),
      ]}
    >
      {icon !== undefined && (
        <Box sx={{ fontSize: 40, color: 'text.secondary' }} aria-hidden="true">
          {icon}
        </Box>
      )}
      <Typography variant="h6">{title}</Typography>
      {hint !== undefined && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
          {hint}
        </Typography>
      )}
      {action !== undefined && <Stack sx={{ mt: 2 }}>{action}</Stack>}
    </Box>
  );
}
