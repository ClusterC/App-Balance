// Money rendering.
//
// The spec requires that a negative amount is recognisable without relying on
// colour alone. Every amount here therefore carries three redundant signals:
// a `−`/`+` sign, a `▼`/`▲` arrow glyph, and only then a colour. The glyph and
// sign survive greyscale printing and colour-blindness, which a colour-only
// encoding does not.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { formatTHB, type Satang } from '../domain/money';
import { semanticColor, moneyTextSx } from '../theme';
import { t } from '../i18n/th';
import { sxFragment, visuallyHidden, type SxStyle } from './sxUtils';

export interface AmountTextProps {
  satang: Satang;
  /** Forces a `+` on a positive value. A negative always shows its sign. */
  showSign?: boolean;
  /** Renders the arrow glyph beside the number. On by default. */
  showArrow?: boolean;
  /** Applies the income/expense colour. Off renders in the inherited colour. */
  colored?: boolean;
  /** Treats a positive number as income for colouring; default neutral. */
  tone?: 'income' | 'expense' | 'neutral' | 'auto';
  size?: 'body' | 'subtitle' | 'h5' | 'h4' | 'h3';
  sx?: SxStyle;
}

/**
 * An amount of money, sign- and glyph-annotated.
 *
 * `tone: 'auto'` reads the sign: positive is income-green, negative is
 * expense-red. Use it where the sign genuinely means income or expense; use
 * `'neutral'` for a balance, where a negative number is a debt rather than a
 * loss and colouring it red would editorialise.
 */
export function AmountText({
  satang,
  showSign = false,
  showArrow = true,
  colored = true,
  tone = 'neutral',
  size = 'body',
  sx,
}: AmountTextProps): ReactNode {
  const theme = useTheme();

  const resolvedTone = tone === 'auto' ? (satang < 0 ? 'expense' : 'income') : tone;
  const color = colored ? semanticColor(theme, resolvedTone) : undefined;

  const glyph = satang < 0 ? '▼' : satang > 0 ? '▲' : '';

  return (
    <Box
      component="span"
      sx={[
        moneyTextSx,
        { color },
        size === 'h3' ? { fontSize: '1.5rem', fontWeight: 600 } : {},
        size === 'h4' ? { fontSize: '1.25rem', fontWeight: 600 } : {},
        size === 'h5' ? { fontSize: '1.125rem', fontWeight: 600 } : {},
        size === 'subtitle' ? { fontWeight: 500 } : {},
        ...sxFragment(sx),
      ]}
    >
      {/* The arrow is decorative: the sign already carries the meaning for a
          screen reader, so announcing "black down-pointing triangle" as well
          would just be noise. */}
      {showArrow && glyph !== '' && (
        <Box component="span" aria-hidden="true" sx={{ mr: 0.5, fontSize: '0.8em' }}>
          {glyph}
        </Box>
      )}
      {formatTHB(satang, { showSign })}
    </Box>
  );
}

/** A balance: never coloured, because a debt is not a loss. */
export function BalanceText(props: Omit<AmountTextProps, 'tone' | 'colored'>): ReactNode {
  return <AmountText {...props} tone="neutral" colored={false} />;
}

/**
 * A change: coloured by direction, with an explicit Thai word for it.
 *
 * The word is what a screen reader announces, so the meaning does not depend on
 * the arrow glyph being perceived.
 */
export function ChangeText({
  satang,
  sx,
}: {
  satang: Satang;
  sx?: SxStyle;
}): ReactNode {
  const label =
    satang > 0 ? t('a11y.increase') : satang < 0 ? t('a11y.decrease') : t('a11y.noChange');

  return (
    <Box component="span" sx={sx}>
      <Box component="span" sx={visuallyHidden}>
        {label}
      </Box>
      <AmountText satang={satang} showSign showArrow tone="auto" />
    </Box>
  );
}
