import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PaymentMethod, TabStatus, OrderStatus } from '@prisma/client';

interface CloseTabBody {
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
}

@Controller('tabs')
export class TabsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  @Get('active')
  async listActive(@Headers('authorization') authHeader?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO']);

    const tabs = await this.prisma.tab.findMany({
      where: { status: 'ABERTA', companyId: auth.companyId },
      include: {
        table: true,
        orders: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        }
      },
      orderBy: { openedAt: 'asc' }
    });

    return tabs.map((tab) => ({
      id: tab.id,
      tableId: tab.tableId,
      tableName: tab.table.name,
      openedAt: tab.openedAt.toISOString(),
      status: tab.status,
      orders: tab.orders.map((order) => ({
        id: order.id,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          total: Number(item.unitPrice) * item.quantity
        }))
      }))
    }));
  }

  @Patch(':id/close')
  async close(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string, @Body() body: CloseTabBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'GERENTE', 'FINANCEIRO']);

    const tab = await this.prisma.tab.findUnique({
      where: { id },
      include: {
        table: true,
        orders: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    if (!tab || tab.status !== 'ABERTA' || tab.companyId !== auth.companyId) {
      return { error: 'Comanda não encontrada ou já encerrada.' };
    }

    const subtotal = tab.orders.reduce((sum, order) => {
      return (
        sum +
        order.items.reduce((itemSum, item) => itemSum + Number(item.unitPrice) * item.quantity, 0)
      );
    }, 0);
    const total = subtotal;

    await this.prisma.order.updateMany({
      where: {
        tabId: tab.id,
        status: { not: 'CANCELADO' }
      },
      data: { status: 'ENTREGUE' }
    });

    const updatedTab = await this.prisma.tab.update({
      where: { id: tab.id },
      data: {
        status: 'FECHADA',
        closedAt: new Date(),
        subtotal: String(subtotal.toFixed(2)),
        total: String(total.toFixed(2)),
        receiptNumber: undefined, // Will generate receipt number below
        receiptGeneratedAt: undefined
      }
    });

    // Generate next receipt number for this company only
    const lastReceipt = await this.prisma.tab.findFirst({
      where: {
        companyId: tab.companyId,
        receiptNumber: { not: null }
      },
      orderBy: { receiptNumber: 'desc' }
    });

    const nextReceiptNumber = (lastReceipt?.receiptNumber ?? 0) + 1;

    const finalTab = await this.prisma.tab.update({
      where: { id: tab.id },
      data: {
        receiptNumber: nextReceiptNumber,
        receiptGeneratedAt: new Date()
      },
      include: { table: true }
    });

    await this.prisma.restaurantTable.update({
      where: { id: tab.tableId },
      data: { status: 'LIVRE' }
    });

    const cashRegister = await this.prisma.cashRegister.findFirst({
      where: { status: 'ABERTO', companyId: auth.companyId }
    });

    if (cashRegister && body.amountPaid != null) {
      if (body.paymentMethod === 'PIX') {
        const existingPixPayment = await this.prisma.payment.findFirst({
          where: {
            tabId: tab.id,
            method: 'PIX',
            status: 'PENDENTE'
          }
        });

        if (existingPixPayment) {
          await this.prisma.payment.update({
            where: { id: existingPixPayment.id },
            data: { status: 'PAGO' }
          });
        } else {
          await this.prisma.payment.create({
            data: {
              tabId: tab.id,
              cashRegisterId: cashRegister.id,
              method: 'PIX',
              amount: String(body.amountPaid.toFixed(2)),
              status: 'PAGO'
            }
          });
        }
      } else {
        await this.prisma.payment.create({
          data: {
            tabId: tab.id,
            cashRegisterId: cashRegister.id,
            method: body.paymentMethod ?? 'DINHEIRO',
            amount: String(body.amountPaid.toFixed(2)),
            status: 'confirmado'
          }
        });
      }
    }

    return {
      id: finalTab.id,
      tableId: finalTab.tableId,
      tableName: finalTab.table.name,
      status: finalTab.status,
      receiptNumber: finalTab.receiptNumber,
      receiptGeneratedAt: finalTab.receiptGeneratedAt?.toISOString() ?? null,
      openedAt: finalTab.openedAt.toISOString(),
      closedAt: finalTab.closedAt?.toISOString() ?? null,
      subtotal: Number(finalTab.subtotal),
      total: Number(finalTab.total)
    };
  }

  @Post(':id/pix/initiate')
  async initiatePixPayment(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: { amount: number }
  ) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'GERENTE', 'FINANCEIRO']);

    const tab = await this.prisma.tab.findUnique({ where: { id } });
    if (!tab || tab.status !== 'ABERTA' || tab.companyId !== auth.companyId) {
      return { error: 'Comanda não encontrada ou já encerrada.' };
    }

    let cashRegister = await this.prisma.cashRegister.findFirst({
      where: { status: 'ABERTO', companyId: auth.companyId }
    });

    if (!cashRegister) {
      const currentUser = auth.currentUser;
      cashRegister = await this.prisma.cashRegister.create({
        data: {
          companyId: auth.companyId,
          openedById: currentUser.id,
          initialAmount: 0,
          status: 'ABERTO'
        }
      });
    }

    const existing = await this.prisma.payment.findFirst({
      where: {
        tabId: tab.id,
        method: 'PIX',
        status: 'PENDENTE'
      }
    });

    if (existing) {
      return {
        paymentId: existing.id,
        status: existing.status,
        amount: Number(existing.amount)
      };
    }

    const payment = await this.prisma.payment.create({
      data: {
        tabId: tab.id,
        cashRegisterId: cashRegister.id,
        method: 'PIX',
        amount: String(body.amount.toFixed(2)),
        status: 'PENDENTE'
      }
    });

    return {
      paymentId: payment.id,
      status: payment.status,
      amount: Number(payment.amount)
    };
  }

  @Get(':id/pix-status')
  async getPixStatus(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'GERENTE', 'FINANCEIRO']);

    const tab = await this.prisma.tab.findUnique({ where: { id } });
    if (!tab || tab.companyId !== auth.companyId) {
      return { error: 'Comanda não encontrada.' };
    }

    const payment = await this.prisma.payment.findFirst({
      where: {
        tabId: tab.id,
        method: 'PIX'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!payment) {
      return { status: 'NONE' };
    }

    return {
      status: payment.status,
      paymentId: payment.id,
      amount: Number(payment.amount)
    };
  }

  @Patch(':id/pix-confirm')
  async confirmPixPayment(@Headers('authorization') authHeader: string | undefined, @Param('id') id: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'GERENTE', 'FINANCEIRO']);

    const tab = await this.prisma.tab.findUnique({ where: { id } });
    if (!tab || tab.companyId !== auth.companyId) {
      return { error: 'Comanda não encontrada.' };
    }

    const payment = await this.prisma.payment.findFirst({
      where: {
        tabId: tab.id,
        method: 'PIX',
        status: 'PENDENTE'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!payment) {
      return { error: 'Pagamento PIX pendente não encontrado.' };
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PAGO' }
    });

    return { status: 'PAGO', paymentId: payment.id, amount: Number(payment.amount) };
  }

  @Get('receipts/daily')
  async listDailyReceipts(@Headers('authorization') authHeader?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'GERENTE', 'FINANCEIRO']);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const receipts = await this.prisma.tab.findMany({
      where: {
        companyId: auth.companyId,
        status: 'FECHADA',
        receiptGeneratedAt: {
          gte: today,
          lt: tomorrow
        }
      },
      include: { table: true },
      orderBy: { receiptGeneratedAt: 'asc' }
    });

    return receipts.map((tab) => ({
      id: tab.id,
      receiptNumber: tab.receiptNumber,
      tableName: tab.table.name,
      subtotal: Number(tab.subtotal),
      total: Number(tab.total),
      closedAt: tab.closedAt?.toISOString() ?? null,
      receiptGeneratedAt: tab.receiptGeneratedAt?.toISOString() ?? null
    }));
  }

  @Get('receipts/number/:receiptNumber')
  async getReceiptByNumber(@Headers('authorization') authHeader: string | undefined, @Param('receiptNumber') receiptNumber: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'GERENTE', 'FINANCEIRO']);

    const tab = await this.prisma.tab.findFirst({
      where: {
        companyId: auth.companyId,
        receiptNumber: Number(receiptNumber)
      },
      include: {
        table: true,
        orders: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    if (!tab) {
      return { error: 'Recibo não encontrado.' };
    }

    return {
      id: tab.id,
      receiptNumber: tab.receiptNumber,
      tableName: tab.table.name,
      subtotal: Number(tab.subtotal),
      total: Number(tab.total),
      closedAt: tab.closedAt?.toISOString() ?? null,
      receiptGeneratedAt: tab.receiptGeneratedAt?.toISOString() ?? null,
      orders: tab.orders.map((order) => ({
        id: order.id,
        status: order.status,
        items: order.items.map((item) => ({
          id: item.id,
          productName: item.product.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          total: Number(item.unitPrice) * item.quantity
        }))
      }))
    };
  }
}

