import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Reads the version from the desktop app's package.json so both builds always
// report the same system version (single source of truth).
const desktopPkg = JSON.parse(readFileSync(resolve(__dirname, '../desktop/package.json'), 'utf-8'));

// Reuses the desktop app's UI source directly so the two builds don't drift.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(desktopPkg.version),
  },
  resolve: {
    alias: {
      '@ui': resolve(__dirname, '../desktop/src/ui'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
});
