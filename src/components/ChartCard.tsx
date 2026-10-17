// Chart wrapper: a figure with a visually-hidden Thai text summary.
//
// The spec requires every chart to carry an accessible fallback, because a
// chart is an image to a screen reader. The summary is the chart's content in
// one sentence — the caller writes it, since only it knows what matters here.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { sxFragment, visuallyHidden, type SxStyle } from './sxUtils';

export interface ChartCardProps {
  title: string;
  /** The one-sentence Thai summary a screen reader announces. */
  summary: string;
  /** The chart itself. Rendered inside a fixed-height box. */
  children: ReactNode;
  /** Chart height in pixels; charts need a measured box or they draw nothing. */
  height?: number;
  /** Caption under the chart, e.g. the period it covers. */
  caption?: ReactNode;
  actions?: ReactNode;
  sx?: SxStyle;
}

export function ChartCard({
  title,
  summary,
  children,
  height = 280,
  caption,
  actions,
  sx,
}: ChartCardProps): ReactNode {
  return (
    <Card sx={[{ height: '100%' }, ...sxFragment(sx)]}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6" component="h3">
            {title}
          </Typography>
          {actions}
        </Box>
        <Box component="figure" sx={{ margin: 0 }}>
          {/* The summary replaces the chart for a screen reader: the chart
              itself is hidden from the a11y tree so its aria labels do not
              compete with the sentence. */}
          <Box component="figcaption" sx={visuallyHidden}>
            {summary}
          </Box>
          <Box sx={{ height }} role="img" aria-label={summary}>
            {children}
          </Box>
        </Box>
        {caption !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
