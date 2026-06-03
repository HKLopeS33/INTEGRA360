#!/usr/bin/env node
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Carrega .env automaticamente para injetar tokens no build (suporta CRLF do Windows)
async function loadEnv() {
  try {
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
    const content = await readFile(envPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.replace(/\r/g, '').trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* .env opcional */ }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const distAppDir = path.join(__dirname, 'dist-app');
const unpackedDir = path.join(distAppDir, 'win-unpacked');

function runCommand(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, VITE_BUILD_ELECTRON: 'true', USE_HARD_LINKS: 'false', CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_LINK: '' }
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

    console.log('📋 Copiando e injetando tokens nos arquivos Electron...');
    await mkdir(distDir, { recursive: true });

    // Injeta o GH_UPDATER_TOKEN diretamente no main.js antes de empacotar.
    // process.env não existe no app empacotado — o token precisa estar no código.
    let mainJs = await readFile(path.join(__dirname, 'electron/main.js'), 'utf8');
    const updaterToken = process.env.GH_UPDATER_TOKEN || '';
    mainJs = mainJs.replace(
      'process.env.GH_UPDATER_TOKEN',
      JSON.stringify(updaterToken)
    );
    if (updaterToken) {
      console.log('✅ GH_UPDATER_TOKEN injetado no main.js');
    } else {
      console.warn('⚠️  GH_UPDATER_TOKEN não encontrado — auto-update para repo privado não funcionará');
    }
    await writeFile(path.join(distDir, 'main.js'), mainJs);
    await copyFile(path.join(__dirname, 'electron/preload.js'), path.join(distDir, 'preload.js'));

    // Garante que o dist/ seja tratado como CommonJS pelo Electron
    // (o preload.js usa require() e não pode ser carregado como ESM)
    await writeFile(path.join(distDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));

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

await loadEnv();
build();
