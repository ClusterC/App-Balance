// Light/dark/system colour-scheme switching.
//
// MUI's `useColorScheme` already resolves `system` against the OS preference
// and swaps the `data-mui-color-scheme` attribute that the cssVariables theme
// listens to; what it does not do is remember the choice. This provider owns
// that: localStorage for the immediate read on startup, and the app_settings
// row as the durable copy written by the settings page through the store.
//
// Kept out of the Zustand store deliberately: the store's `load()` touches the
// database, and the theme must resolve before any data exists.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from '@mui/material/styles';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'balance.themeMode';

interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Storage can be unavailable (private mode); the default stands.
  }
  return 'system';
}

function writeStoredMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Same as above: a dropped preference is not an error worth raising.
  }
}

export function ThemeModeProvider({ children }: { children: ReactNode }): ReactNode {
  const { setMode: setMuiMode } = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());

  // Apply the stored choice once MUI's scheme controller is mounted.
  useEffect(() => {
    setMuiMode(mode);
  }, [mode, setMuiMode]);

  const value = useMemo<ThemeModeContextValue>(
    () => ({
      mode,
      setMode: (next) => {
        setModeState(next);
        writeStoredMode(next);
        setMuiMode(next);
      },
    }),
    [mode, setMuiMode],
  );

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook is the context's only consumer API
export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (context === null) {
    throw new Error('useThemeMode must be used inside ThemeModeProvider');
  }
  return context;
}
