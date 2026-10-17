// Filter bar: the shared account / date-range / search controls.
//
// One component rather than each page assembling its own, so the layout, the
// Thai labels and the "clear filters" affordance behave identically everywhere.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import IconButton from '@mui/material/IconButton';
import { t } from '../i18n/th';
import { sxFragment, type SxStyle } from './sxUtils';

export interface DateRange {
  start: string;
  end: string;
}

export interface FilterBarProps {
  search: string;
  onSearch: (value: string) => void;

  accountId: number | 'all';
  onAccount: (value: number | 'all') => void;
  /** `[{ id, name }]` — active accounts only, in display order. */
  accounts: readonly { id: number; name: string }[];

  range: DateRange | null;
  onRange: (value: DateRange | null) => void;

  /** Extra page-specific controls (e.g. an update-type select). */
  children?: ReactNode;
  sx?: SxStyle;
}

export function FilterBar({
  search,
  onSearch,
  accountId,
  onAccount,
  accounts,
  range,
  onRange,
  children,
  sx,
}: FilterBarProps): ReactNode {
  const hasFilter =
    search !== '' || accountId !== 'all' || range !== null;

  return (
    <Stack
      direction="row"
      spacing={2}
      sx={[{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1.5 }, ...sxFragment(sx)]}
    >
      <TextField
        size="small"
        sx={{ minWidth: 280, flexGrow: 1, maxWidth: 420 }}
        label={t('search.placeholder')}
        value={search}
        onChange={(event) => { onSearch(event.target.value); }}        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment:
              search !== '' ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => { onSearch(''); }} aria-label={t('app.clearFilter')}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
          },
        }}
      />

      <TextField
        select
        size="small"
        sx={{ minWidth: 180 }}
        label={t('timeline.account')}
        value={accountId === 'all' ? 'all' : String(accountId)}
        onChange={(event) => {
          const value = event.target.value;
          onAccount(value === 'all' ? 'all' : Number(value));
        }}
      >
        <MenuItem value="all">{t('app.all')}</MenuItem>
        {accounts.map((account) => (
          <MenuItem key={account.id} value={String(account.id)}>
            {account.name}
          </MenuItem>
        ))}
      </TextField>

      {range !== null && (
        <>
          <TextField
            size="small"
            type="date"
            sx={{ minWidth: 160 }}
            label={t('reports.from')}
            value={range.start}
            onChange={(event) => { onRange({ ...range, start: event.target.value }); }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            sx={{ minWidth: 160 }}
            label={t('reports.to')}
            value={range.end}
            onChange={(event) => { onRange({ ...range, end: event.target.value }); }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </>
      )}

      {hasFilter && (
        <Box>
          <IconButton
            size="small"
            onClick={() => {
              onSearch('');
              onAccount('all');
              onRange(null);
            }}
            aria-label={t('app.clearFilter')}
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {children}
    </Stack>
  );
}
