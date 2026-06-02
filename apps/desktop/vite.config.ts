import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const isElectronBuild = process.env.VITE_BUILD_ELECTRON === 'true';

export default defineConfig({
  base: isElectronBuild ? './' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: isElectronBuild
        ? {
            main: resolve(__dirname, 'electron/main.js'),
            preload: resolve(__dirname, 'electron/preload.js')
          }
        : undefined,
      output: isElectronBuild
        ? {
            dir: 'dist',
            format: 'es',
            entryFileNames: '[name].js'
          }
        : undefined
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
