// Material Design 3 theme.
//
// MUI's `cssVariables` mode generates a CSS custom property per token and lets
// `colorSchemes` carry both palettes in one theme object, which is what makes
// light/dark switching instant and flash-free — no second theme object, no
// re-render of the whole tree. `useColorScheme` then drives it.
//
// Shape and typography follow the M3 scale rather than MUI's defaults: MUI's
// out-of-the-box radii (4px) and Roboto read as Material 2.

import { createTheme, type Theme } from '@mui/material/styles';
import { th } from '../i18n/th';

/**
 * Seed colour: a deep teal, the same one the app icon is drawn in. Every other
 * colour in the palettes is derived from it, so the app reads as one system.
 */
export const SEED_COLOR = '#00695C';

/** Thai-first typeface stack. Sarabun is the common Thai UI face. */
export const THAI_FONT_STACK = [
  'Sarabun',
  'IBM Plex Sans Thai',
  'Noto Sans Thai',
  'Leelawadee UI',
  'Tahoma',
  'system-ui',
  'sans-serif',
].join(', ');

/** Font stack for money, so digits line up column-to-column. */
export const NUMERIC_FONT_STACK = [
  'IBM Plex Mono',
  'JetBrains Mono',
  'Cascadia Mono',
  'Consolas',
  'ui-monospace',
  'monospace',
].join(', ');

/**
 * M3 shape scale. `borderRadius` on the theme is a convenience for MUI
 * components; the named values are used directly by feature code.
 */
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
} as const;

/** Shared layout constants, so the rail and the content grid agree. */
export const layout = {
  railWidth: 96,
  contentMaxWidth: 1440,
  pageGutter: 3,
} as const;

declare module '@mui/material/styles' {
  interface Theme {
    /** The M3 shape scale, which MUI's single `borderRadius` cannot express. */
    balance: {
      radius: typeof radius;
    };
  }
  interface ThemeOptions {
    balance?: {
      radius?: typeof radius;
    };
  }
}

/**
 * Semantic income/expense colours.
 *
 * Green and red are *supporting* signals only. Every amount in the UI carries a
 * `+`/`−` sign and an arrow glyph as well, so the meaning survives greyscale
 * printing and colour-blindness — the two cases where a colour-only encoding
 * fails completely.
 */
const semantic = {
  light: {
    income: '#1B5E20',
    expense: '#B3261E',
    neutral: '#49454F',
  },
  dark: {
    income: '#7EDB8A',
    expense: '#FFB4AB',
    neutral: '#CAC4D0',
  },
} as const;

export const theme: Theme = createTheme({
  cssVariables: {
    cssVarPrefix: 'balance',
    colorSchemeSelector: 'data-mui-color-scheme',
  },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#00695C', light: '#4DB6AC', dark: '#00453C', contrastText: '#FFFFFF' },
        secondary: { main: '#4A6360', light: '#78909C', dark: '#334B48', contrastText: '#FFFFFF' },
        error: { main: '#B3261E', contrastText: '#FFFFFF' },
        warning: { main: '#8F5000', contrastText: '#FFFFFF' },
        success: { main: '#1B5E20', contrastText: '#FFFFFF' },
        info: { main: '#00629E', contrastText: '#FFFFFF' },
        background: { default: '#F4FBF8', paper: '#FFFFFF' },
        divider: 'rgba(0, 0, 0, 0.08)',
      },
    },
    dark: {
      palette: {
        primary: { main: '#4DB6AC', light: '#80CBC4', dark: '#00897B', contrastText: '#00332C' },
        secondary: { main: '#B0CCC7', light: '#D6E5E1', dark: '#7C9C97', contrastText: '#1B3330' },
        error: { main: '#FFB4AB', contrastText: '#690005' },
        warning: { main: '#FFB77C', contrastText: '#4A2800' },
        success: { main: '#7EDB8A', contrastText: '#00390D' },
        info: { main: '#8ECDFF', contrastText: '#003354' },
        background: { default: '#101413', paper: '#1A1F1E' },
        divider: 'rgba(255, 255, 255, 0.10)',
      },
    },
  },
  balance: {
    radius,
  },
  shape: {
    borderRadius: radius.md,
  },
  typography: {
    fontFamily: THAI_FONT_STACK,
    // MUI's defaults are Roboto-sized; these are tuned for Sarabun, which has a
    // taller x-height and needs slightly less size at the same weight.
    h1: { fontSize: '2rem', fontWeight: 600, lineHeight: 1.3 },
    h2: { fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.3 },
    h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.35 },
    h4: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4 },
    h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.5 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.5 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
    body2: { fontSize: '0.875rem', lineHeight: 1.6 },
    caption: { fontSize: '0.75rem', lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          colorScheme: 'light dark',
        },
        html: {
          // Thai text has marks above and below the baseline; a little extra
          // line height stops them clipping against neighbouring lines.
          lineHeight: 1.6,
        },
        body: {
          // No gradients, no glassmorphism — flat surfaces only.
          WebkitFontSmoothing: 'antialiased',
        },
        '::selection': {
          backgroundColor: 'var(--balance-palette-primary-main)',
          color: 'var(--balance-palette-primary-contrastText)',
        },
        // Visually hidden but available to screen readers: used by chart
        // summaries and table captions.
        '.balance-visually-hidden': {
          border: 0,
          clip: 'rect(0 0 0 0)',
          height: '1px',
          margin: '-1px',
          overflow: 'hidden',
          padding: 0,
          position: 'absolute',
          whiteSpace: 'nowrap',
          width: '1px',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
          },
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme: t }) => ({
          backgroundImage: 'none',
          border: `1px solid ${t.vars.palette.divider}`,
        }),
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderRadius: radius.lg,
          border: `1px solid ${t.vars.palette.divider}`,
          backgroundImage: 'none',
        }),
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: radius.xl, paddingInline: 20, minHeight: 40 },
        sizeSmall: { minHeight: 32 },
        sizeLarge: { minHeight: 48 },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: radius.xl } },
    },
    MuiFab: {
      styleOverrides: { root: { borderRadius: radius.lg, width: 56, height: 56 } },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: radius.md } },
    },
    MuiSelect: {
      styleOverrides: { root: { borderRadius: radius.md } },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: radius.sm } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { borderRadius: radius.xl } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: radius.xl, backgroundImage: 'none' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme: t }) => ({
          borderRadius: radius.xs,
          backgroundColor: t.vars.palette.background.paper,
          color: t.vars.palette.text.primary,
          border: `1px solid ${t.vars.palette.divider}`,
          fontSize: '0.8125rem',
        }),
      },
    },
    MuiTable: {
      styleOverrides: {
        root: { borderCollapse: 'separate', borderSpacing: 0 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderBottom: `1px solid ${t.vars.palette.divider}`,
          paddingBlock: 10,
        }),
        head: ({ theme: t }) => ({
          fontWeight: 600,
          color: t.vars.palette.text.secondary,
          backgroundColor: 'transparent',
          whiteSpace: 'nowrap',
        }),
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: radius.md } },
    },
    MuiSnackbarContent: {
      styleOverrides: { root: { borderRadius: radius.md } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: radius.xl } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: radius.sm, height: 8 } },
    },
    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: { root: { borderRadius: radius.sm } },
    },
  },
});

/**
 * Money is rendered in a monospaced, tabular-figure face so a column of amounts
 * does not jitter as values change — the single most important typographic
 * detail in a finance app, because the number *is* the content.
 */
export const moneyTextSx = {
  fontFamily: NUMERIC_FONT_STACK,
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum" 1, "zero" 1',
  letterSpacing: '-0.01em',
} as const;

/**
 * Applies the semantic income/expense colour for the active scheme.
 *
 * These are not palette slots: an expense is not an *error* and income is not
 * *success*, and mapping them onto those two would make every future palette
 * change a semantic decision by accident. The values below are picked for
 * contrast against each scheme's `background.paper` and are always paired with
 * a sign and an arrow glyph, never colour alone.
 */
export function semanticColor(theme: Theme, kind: 'income' | 'expense' | 'neutral'): string {
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  return semantic[mode][kind];
}

export { th as strings };
