import { Controller, Get, Headers } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';

@Controller('kitchen')
export class KitchenController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  @Get('queue')
  async queue(@Headers('authorization') authHeader?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['COZINHA', 'CAIXA', 'GERENTE']);

    const orders = await this.prisma.order.findMany({
      where: {
        companyId: auth.companyId,
        status: {
          in: ['ENVIADO', 'EM_PREPARO', 'PRONTO']
        }
      },
      include: {
        tab: {
          include: {
            table: true
          }
        },
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return orders.map((order) => ({
      id: order.id,
      tableId: order.tab.tableId,
      tableName: order.tab.table.name,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        preparationMinutes: item.product.preparationMinutes,
        note: item.note,
        status: item.status
      }))
    }));
  }
}
