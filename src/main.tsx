// Entry point.
//
// MUI requires the color-scheme script to run before first paint so a dark
// preference does not flash light; `styleOverrides` on CssBaseline handles the
// rest of the document chrome.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from './theme';
import { ThemeModeProvider } from './theme/ThemeModeProvider';
import { App } from './App';
import { useAppStore } from './state/appStore';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root element not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <ThemeModeProvider>
        <CssBaseline enableColorScheme />
        <App />
      </ThemeModeProvider>
    </ThemeProvider>
  </StrictMode>,
);

// Kick off the initial load once the tree is up; the shell renders the loading
// screen until the store resolves.
void useAppStore.getState().load();
