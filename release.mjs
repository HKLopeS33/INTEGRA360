#!/usr/bin/env node
/**
 * Script de release do Integra360
 * Uso: node release.mjs 1.2.0
 *
 * O que faz:
 *  1. Atualiza a versão nos dois package.json (raiz + apps/desktop)
 *  2. Roda o build Electron (Vite + electron-builder)
 *  3. Publica a release no GitHub automaticamente
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('❌ Informe a versão no formato correto. Exemplo:\n   node release.mjs 1.2.0');
  process.exit(1);
}

function updateVersion(filePath, newVersion) {
  const pkg = JSON.parse(readFileSync(filePath, 'utf-8'));
  const old = pkg.version;
  pkg.version = newVersion;
  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ ${filePath.replace(__dirname, '.')}: ${old} → ${newVersion}`);
}

function run(cmd, args = [], cwd = __dirname, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      cwd,
      env: { ...process.env, ...extraEnv }
    });
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Falhou com código ${code}`)));
    proc.on('error', reject);
  });
}

async function loadEnv() {
  try {
    const envPath = resolve(__dirname, 'apps/desktop/.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=][^=]*)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    }
    if (process.env.GH_TOKEN) console.log('✅ GH_TOKEN carregado do .env');
    else console.warn('⚠️  GH_TOKEN não encontrado no .env — publish pode falhar');
  } catch {
    console.warn('⚠️  .env não encontrado — certifique-se de que GH_TOKEN está no ambiente');
  }
}

async function main() {
  console.log(`\n🚀 Release Integra360 v${version}\n`);

  // 0. Carrega tokens do .env
  await loadEnv();

  // 1. Atualiza versões
  updateVersion(resolve(__dirname, 'package.json'), version);
  updateVersion(resolve(__dirname, 'apps/desktop/package.json'), version);

  // 2. Build Electron
  console.log('\n📦 Buildando...');
  await run('node', ['build-app.mjs'], resolve(__dirname, 'apps/desktop'));

  // 3. Publish no GitHub Releases — passa GH_TOKEN explicitamente para o processo filho
  console.log('\n📡 Publicando release no GitHub...');
  await run(
    'npx', ['electron-builder', '--publish', 'always'],
    resolve(__dirname, 'apps/desktop'),
    { GH_TOKEN: process.env.GH_TOKEN }
  );

  console.log(`\n🎉 Release v${version} publicada com sucesso!`);
  console.log('   Clientes com o app instalado receberão a atualização na próxima abertura.\n');
}

main().catch(err => {
  console.error('❌ Release falhou:', err.message);
  process.exit(1);
});
