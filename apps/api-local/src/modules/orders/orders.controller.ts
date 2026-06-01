import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, OrderStatus, TabStatus } from '@prisma/client';

interface CreateOrderBody {
  tableId: string;
  items: Array<{
    productId: string;
    quantity: number;
    note?: string;
  }>;
}

interface UpdateOrderStatusBody {
  status: OrderStatus;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  @Get()
  async list(@Headers('authorization') authHeader: string | undefined, @Query('active') active?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'ESTOQUE']);

    const where: Prisma.OrderWhereInput | undefined = active === 'true'
      ? { tab: { status: { equals: 'ABERTA' as TabStatus } }, companyId: auth.companyId }
      : { companyId: auth.companyId };

    type OrderWithRelations = Prisma.OrderGetPayload<{
      include: {
        tab: {
          include: {
            table: true;
          };
        };
        items: {
          include: {
            product: true;
          };
        };
      };
    }>;

    const orders = await this.prisma.order.findMany({
      where,
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
      orderBy: { createdAt: 'desc' }
    }) as OrderWithRelations[];

    return orders.map((order) => ({
      id: order.id,
      tabId: order.tabId,
      tabStatus: order.tab.status,
      tableId: order.tab.tableId,
      tableName: order.tab.table.name,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        note: item.note
      }))
    }));
  }

  @Post()
  async create(@Headers('authorization') authHeader: string | undefined, @Body() body: CreateOrderBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['GARCOM', 'CAIXA', 'GERENTE', 'ESTOQUE']);

    const table = await this.prisma.restaurantTable.findUnique({ where: { id: body.tableId } });
    if (!table || table.companyId !== auth.companyId) {
      return { error: 'Mesa nao encontrada.' };
    }

    const currentUser = auth.currentUser;

    let tab = await this.prisma.tab.findFirst({
      where: {
        tableId: body.tableId,
        status: 'ABERTA',
        companyId: auth.companyId
      }
    });

    if (!tab) {
      tab = await this.prisma.tab.create({
        data: {
          companyId: table.companyId,
          tableId: body.tableId,
          openedById: currentUser.id,
          status: 'ABERTA'
        }
      });
    }

    const order = await this.prisma.order.create({
      data: {
        companyId: table.companyId,
        tabId: tab.id,
        userId: currentUser.id,
        status: 'ENVIADO',
        items: {
          create: await Promise.all(
            body.items.map(async (item) => {
              const product = await this.prisma.product.findUnique({
                where: { id: item.productId }
              });

              if (!product || product.companyId !== auth.companyId) {
                throw new Error('Produto nao encontrado ou pertence a outra empresa.');
              }

              return {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: product.price,
                note: item.note || null
              };
            })
          )
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
      }
    });

    await this.prisma.restaurantTable.update({
      where: { id: body.tableId },
      data: { status: 'OCUPADA' }
    });

    return {
      id: order.id,
      tableId: order.tab.tableId,
      tableName: order.tab.table.name,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        note: item.note
      }))
    };
  }

  @Patch(':id/status')
  async updateStatus(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string, @Body() body: UpdateOrderStatusBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'GERENTE', 'COZINHA']);

    const order = await this.prisma.order.findUnique({
      where: { id },
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
      }
    });

    if (!order || order.companyId !== auth.companyId) {
      return { error: 'Pedido nao encontrado.' };
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: body.status },
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
      }
    });

    return {
      id: updated.id,
      tableId: updated.tab.tableId,
      tableName: updated.tab.table.name,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      items: updated.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        note: item.note
      }))
    };
  }
}
