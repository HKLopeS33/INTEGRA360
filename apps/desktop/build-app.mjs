#!/usr/bin/env node
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const distAppDir = path.join(__dirname, 'dist-app');
const unpackedDir = path.join(distAppDir, 'win-unpacked');

function runCommand(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, USE_HARD_LINKS: 'false', CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_LINK: '' }
    });
    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function checkUnpacked() {
  try {
    const files = await readdir(unpackedDir);
    return files.some(f => f.includes('Integra360.exe') || f.includes('.exe'));
  } catch {
    return false;
  }
}

async function checkNsisInstaller() {
  try {
    const files = await readdir(distAppDir);
    return files.find(f => f.endsWith('.exe') && f.includes('Setup'));
  } catch {
    return null;
  }
}

async function createZip() {
  // Usa PowerShell para criar o ZIP (disponível em qualquer Windows 10+)
  const zipPath = path.join(distAppDir, 'Integra360-portable.zip');
  console.log('📦 Criando pacote portátil (ZIP)...');
  await runCommand('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${unpackedDir}\\*' -DestinationPath '${zipPath}' -Force`
  ]);
  return zipPath;
}

async function build() {
  try {
    console.log('📦 Compilando com Vite...');
    await runCommand('npx', ['vite', 'build']);

    console.log('📋 Copiando arquivos Electron para dist...');
    await mkdir(distDir, { recursive: true });
    await copyFile(path.join(__dirname, 'electron/main.js'), path.join(distDir, 'main.js'));
    await copyFile(path.join(__dirname, 'electron/preload.js'), path.join(distDir, 'preload.js'));

    console.log('🔨 Empacotando com electron-builder...');
    let nsisOk = false;
    try {
      await runCommand('npx', ['electron-builder', '--publish', 'never']);
      const installer = await checkNsisInstaller();
      if (installer) {
        nsisOk = true;
        console.log('\n✅ Build completo!');
        console.log(`📍 Instalador: dist-app/${installer}`);
        console.log('   Envie esse único arquivo para o cliente instalar.\n');
      }
    } catch {
      // NSIS falhou (ex: sem permissão para symlinks) — tenta ZIP
    }

    if (!nsisOk) {
      if (!(await checkUnpacked())) {
        throw new Error('Build falhou — win-unpacked não encontrado.');
      }
      const zipPath = await createZip();
      console.log('\n✅ Build completo!');
      console.log(`📍 Pacote portátil: ${zipPath}`);
      console.log('   Envie o ZIP para o cliente, ele extrai e executa "Integra360.exe" dentro da pasta.\n');
    }
  } catch (error) {
    console.error('❌ Build falhou:', error.message);
    process.exit(1);
  }
}

build();
