#!/usr/bin/env node
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const distAppDir = path.join(__dirname, 'dist-app');

function runCommand(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { 
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, USE_HARD_LINKS: 'false' }
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function checkAppBuilt() {
  try {
    const files = await readdir(path.join(distAppDir, 'win-unpacked'));
    return files.some(f => f.includes('Sistema Shawarma.exe'));
  } catch {
    return false;
  }
}

async function build() {
  try {
    console.log('📦 Building app with Vite (skipping TypeScript check)...');
    await runCommand('npx', ['vite', 'build']);

    console.log('📋 Copying Electron files to dist...');
    await mkdir(distDir, { recursive: true });
    await copyFile(
      path.join(__dirname, 'electron/main.js'),
      path.join(distDir, 'main.js')
    );
    await copyFile(
      path.join(__dirname, 'electron/preload.js'),
      path.join(distDir, 'preload.js')
    );

    console.log('🔨 Building installer with electron-builder...');
    try {
      await runCommand('npx', ['electron-builder', '--publish', 'never']);
    } catch (error) {
      // Check if app was built despite error
      if (await checkAppBuilt()) {
        console.log('⚠️  Build tool error, but app executable was created successfully!');
      } else {
        throw error;
      }
    }

    console.log('✅ Build complete! App is ready in dist-app/win-unpacked/');
    console.log('📍 Executable: dist-app/win-unpacked/Sistema Shawarma.exe');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

build();

