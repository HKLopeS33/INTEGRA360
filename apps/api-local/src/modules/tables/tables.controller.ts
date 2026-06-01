import { Body, Controller, Get, Headers, Param, Patch } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { TablesService } from './tables.service.js';
import type { TableStatus } from '@prisma/client';

interface UpdateTableStatusBody {
  status: TableStatus;
}

@Controller('tables')
export class TablesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly tablesService: TablesService
  ) {}

  @Get()
  async list(@Headers('authorization') authHeader?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'ESTOQUE']);

    const tables = await this.tablesService.getTablesWithStatus(auth.companyId);

    return tables.map((table) => ({
      id: table.id,
      number: table.number,
      name: table.name,
      capacity: table.capacity,
      status: table.displayStatus,
      hasOpenTab: table.hasOpenTab
    }));
  }

  @Patch(':id/status')
  async updateStatus(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string, @Body() body: UpdateTableStatusBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'ESTOQUE']);

    const table = await this.prisma.restaurantTable.findUnique({ where: { id } });

    if (!table || table.companyId !== auth.companyId) {
      return { error: 'Mesa nao encontrada.' };
    }

    const updated = await this.prisma.restaurantTable.update({
      where: { id },
      data: { status: body.status }
    });

    return {
      id: updated.id,
      number: updated.number,
      name: updated.name,
      capacity: updated.capacity,
      status: updated.status
    };
  }
}
