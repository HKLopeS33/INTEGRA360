import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const isElectronBuild = process.env.VITE_BUILD_ELECTRON === 'true';

// Lê a versão do package.json automaticamente
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// Vite only builds the React frontend (browser bundle).
// electron/main.js and electron/preload.js are Node.js files copied
// directly to dist/ by build-app.mjs — Vite must NOT touch them.
export default defineConfig({
  base: isElectronBuild ? './' : '/',
  plugins: [react()],
  define: {
    // Injeta a versão do package.json no bundle — atualiza automaticamente a cada build
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
