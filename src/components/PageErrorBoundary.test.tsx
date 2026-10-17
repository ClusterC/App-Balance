// The shell's error boundary: a throw inside a page must not unmount the
// navigation rail — the user must be able to navigate away instead of facing
// a blank white window.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useState, type ReactNode } from 'react';
import { PageErrorBoundary } from './PageErrorBoundary';
import { theme } from '../theme';

/** A page that throws on every render, as a real broken page would. */
function BrokenPage(): ReactNode {
  throw new Error('boom');
}

function Shell(): ReactNode {
  const [broken, setBroken] = useState(true);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <button onClick={() => { setBroken(false); }}>go to overview</button>
      <PageErrorBoundary key={broken ? 'broken' : 'overview'}>
        {broken ? <BrokenPage /> : <div>overview content</div>}
      </PageErrorBoundary>
    </ThemeProvider>
  );
}

describe('PageErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the fallback instead of unmounting the tree, and navigation still works', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Shell />);

    // The error is logged, never swallowed silently.
    expect(errorSpy).toHaveBeenCalledWith(
      'Page render failed:',
      expect.objectContaining({ message: 'boom' }),
      expect.anything(),
    );

    // The fallback is on screen, and the sibling navigation is still clickable.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByText('go to overview'));
    expect(screen.getByText('overview content')).toBeInTheDocument();
  });

  it('recovers when the user retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    function SometimesBroken(): ReactNode {
      if (shouldThrow) throw new Error('transient');
      return <div>recovered</div>;
    }
    function Recoverable(): ReactNode {
      return (
        <PageErrorBoundary>
          <SometimesBroken />
        </PageErrorBoundary>
      );
    }
    render(<Recoverable />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
