import 'reflect-metadata';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module.js';
import { PrismaService } from './modules/database/prisma.service.js';

const loadEnvFile = () => {
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (true) {
    const envPath = path.join(dir, '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/i);
        if (!match) continue;

        const key = match[1];
        const rawValue = match[2];
        if (!key || rawValue === undefined) continue;
        if (process.env[key]) continue;

        let value = rawValue;
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }

        process.env[key] = value;
      }
      break;
    }

    if (dir === root) break;
    dir = path.dirname(dir);
  }
};

loadEnvFile();
const port = Number(process.env.API_PORT ?? 3333);

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true
  });

  await app.listen(port);
  console.log(`API local rodando em http://localhost:${port}`);

  try {
    const prisma = app.get(PrismaService) as PrismaService;
    const activeCompanies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });
    if (activeCompanies.length === 1) {
      const [onlyCompany] = activeCompanies;
      if (onlyCompany && onlyCompany.id) {
        const defaultCompanyId = onlyCompany.id;
        const orphans = await prisma.user.findMany({ where: { companyId: null, role: { not: 'SUPER' } } });
        if (orphans.length > 0) {
          await prisma.user.updateMany({ where: { companyId: null, role: { not: 'SUPER' } }, data: { companyId: defaultCompanyId } });
          console.log(`Assigned ${orphans.length} orphaned users to default company ${defaultCompanyId}`);
        }
      }
    }
  } catch (e) {
    console.error('Erro ao corrigir usuarios sem empresa no startup', e);
  }

  // Scheduler: verifica assinaturas expiradas a cada minuto
  try {
    const prisma = app.get(PrismaService) as PrismaService;
    setInterval(async () => {
      const now = new Date();
      const expired = await prisma.subscription.findMany({ where: { expiresAt: { lt: now }, status: 'ATIVO' } });
      for (const s of expired) {
        try {
          await prisma.subscription.update({ where: { id: s.id }, data: { status: 'EXPIRADO' } });
          await prisma.company.update({ where: { id: s.companyId }, data: { active: false } });
          await prisma.user.updateMany({ where: { companyId: s.companyId }, data: { active: false } });
        } catch (e) {
          console.error('Erro ao expirar assinatura', s.id, e);
        }
      }
    }, 60 * 1000);
  } catch (e) {
    console.error('Nao foi possivel iniciar o scheduler de assinaturas', e);
  }
};

bootstrap();
