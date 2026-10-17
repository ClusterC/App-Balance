// A card showing one headline figure.
//
// Deliberately not a chart: a single number is more legible as a number than as
// a bar, and the spec's dashboard is a set of these tiles with charts below.

import type { ReactNode } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { sxFragment, type SxStyle } from './sxUtils';

export interface StatCardProps {
  label: string;
  /** Usually an `<AmountText>`; any node so a count can be shown too. */
  value: ReactNode;
  /** Secondary line: a comparison, a date, a count. */
  caption?: ReactNode;
  icon?: ReactNode;
  /** Small visual state, e.g. a warning chip. */
  badge?: ReactNode;
  sx?: SxStyle;
}

export function StatCard({ label, value, caption, icon, badge, sx }: StatCardProps): ReactNode {
  return (
    <Card sx={[{ height: '100%' }, ...sxFragment(sx)]}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {label}
            </Typography>
            <Box sx={{ fontSize: '1.25rem', fontWeight: 600 }}>{value}</Box>
            {caption !== undefined && (
              <Typography variant="caption" color="text.secondary" component="div">
                {caption}
              </Typography>
            )}
          </Stack>
          {icon !== undefined && (
            <Box sx={{ color: 'text.secondary', display: 'flex', flexShrink: 0 }} aria-hidden="true">
              {icon}
            </Box>
          )}
        </Stack>
        {badge !== undefined && <Box sx={{ mt: 1 }}>{badge}</Box>}
      </CardContent>
    </Card>
  );
}
