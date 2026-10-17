// Test environment setup.
//
// The app normally runs inside a Tauri webview, which provides a few browser
// APIs jsdom does not. Rather than stubbing Tauri's `invoke` here, individual
// tests mock `@tauri-apps/plugin-sql` — that keeps this file about *environment*
// and leaves *behaviour* to the test that needs it.

import '@testing-library/jest-dom/vitest';

// MUI's responsive helpers and colour-scheme provider query this. jsdom does
// not implement it, so every media query would otherwise throw.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
  }),
});

/** A stand-in for a listener-registration method that nothing needs to call. */
function noop(): void {
  // Intentionally empty: jsdom never dispatches the events these would receive.
}

// MUI X Charts measures its container with a ResizeObserver, which jsdom lacks.
// A no-op observer is enough: the size comes from the offset stubs below.
class ResizeObserverStub {
  observe(): void {
    // Nothing to observe in a layout-less DOM.
  }

  unobserve(): void {
    // Nothing to stop observing.
  }

  disconnect(): void {
    // Nothing to disconnect.
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: ResizeObserverStub,
});

// jsdom has no layout engine, so every element measures 0x0. Charts would then
// render nothing at all; a fixed box lets them draw and be asserted on.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return 800;
  },
});

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 400;
  },
});
