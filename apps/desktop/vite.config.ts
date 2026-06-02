import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isElectronBuild = process.env.VITE_BUILD_ELECTRON === 'true';

// Vite only builds the React frontend (browser bundle).
// electron/main.js and electron/preload.js are Node.js files copied
// directly to dist/ by build-app.mjs — Vite must NOT touch them.
export default defineConfig({
  base: isElectronBuild ? './' : '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
