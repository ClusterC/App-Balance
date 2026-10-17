import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri drives this dev server, so the port is fixed and the terminal must not be cleared.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // The Rust side rebuilds itself; watching it from Vite causes reload loops.
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // WebView2 on Windows 10/11 is Chromium-based and well past this floor.
    target: 'chrome105',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
  },
});
