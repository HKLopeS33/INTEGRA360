import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';

const resolveDatabaseUrl = () => {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const cwd = process.cwd();
  const localDatabasePath = cwd.endsWith(path.join('apps', 'api-local'))
    ? path.resolve(cwd, '../../packages/database/prisma/data/local.db')
    : path.resolve(cwd, 'packages/database/prisma/data/local.db');

  return `file:${localDatabasePath.replace(/\\/g, '/')}`;
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    process.env.DATABASE_URL = resolveDatabaseUrl();
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
