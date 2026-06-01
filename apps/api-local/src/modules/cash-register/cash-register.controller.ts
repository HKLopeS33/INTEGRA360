import { Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CashRegisterStatus } from '@prisma/client';

interface OpenCashRegisterBody {
  initialAmount: number;
}

interface CloseCashRegisterBody {
  closingAmount: number;
}

@Controller('cash-register')
export class CashRegisterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  @Get('current')
  async current(@Headers('authorization') authHeader?: string) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'FINANCEIRO', 'GERENTE']);

    const cashRegister = await this.prisma.cashRegister.findFirst({
      where: { status: 'ABERTO', companyId: auth.companyId },
      include: {
        openedBy: true,
        closedBy: true,
        payments: true
      }
    });

    if (!cashRegister) {
      return null;
    }

    return {
      id: cashRegister.id,
      status: cashRegister.status,
      openedAt: cashRegister.openedAt.toISOString(),
      closedAt: cashRegister.closedAt?.toISOString() ?? null,
      initialAmount: Number(cashRegister.initialAmount),
      closingAmount: cashRegister.closingAmount ? Number(cashRegister.closingAmount) : null,
      openedBy: cashRegister.openedBy.name,
      closedBy: cashRegister.closedBy?.name ?? null,
      paymentsCount: cashRegister.payments.length,
      totalPayments: cashRegister.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    };
  }

  @Post('open')
  async open(@Headers('authorization') authHeader: string | undefined, @Body() body: OpenCashRegisterBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'FINANCEIRO', 'GERENTE']);

    const current = await this.prisma.cashRegister.findFirst({
      where: { status: 'ABERTO', companyId: auth.companyId }
    });

    if (current) {
      const cashRegister = await this.prisma.cashRegister.findUnique({
        where: { id: current.id },
        include: {
          openedBy: true,
          payments: true
        }
      });

      return {
        id: cashRegister!.id,
        status: cashRegister!.status,
        openedAt: cashRegister!.openedAt.toISOString(),
        closedAt: null,
        initialAmount: Number(cashRegister!.initialAmount),
        closingAmount: null,
        openedBy: cashRegister!.openedBy.name,
        closedBy: null,
        paymentsCount: cashRegister!.payments.length,
        totalPayments: cashRegister!.payments.reduce((sum, p) => sum + Number(p.amount), 0)
      };
    }

    const currentUser = auth.currentUser;

    const cashRegister = await this.prisma.cashRegister.create({
      data: {
        companyId: auth.companyId,
        openedById: currentUser.id,
        initialAmount: body.initialAmount,
        status: 'ABERTO'
      },
      include: {
        openedBy: true,
        payments: true
      }
    });

    return {
      id: cashRegister.id,
      status: cashRegister.status,
      openedAt: cashRegister.openedAt.toISOString(),
      closedAt: null,
      initialAmount: Number(cashRegister.initialAmount),
      closingAmount: null,
      openedBy: cashRegister.openedBy.name,
      closedBy: null,
      paymentsCount: cashRegister.payments.length,
      totalPayments: 0
    };
  }

  @Patch('close')
  async close(@Headers('authorization') authHeader: string | undefined, @Body() body: CloseCashRegisterBody) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['CAIXA', 'FINANCEIRO', 'GERENTE']);

    const current = await this.prisma.cashRegister.findFirst({
      where: { status: 'ABERTO', companyId: auth.companyId }
    });

    if (!current) {
      return { error: 'Nenhum caixa aberto.' };
    }

    const currentUser = auth.currentUser;

    const cashRegister = await this.prisma.cashRegister.update({
      where: { id: current.id },
      data: {
        status: 'FECHADO',
        closedAt: new Date(),
        closedById: currentUser.id,
        closingAmount: body.closingAmount
      },
      include: {
        openedBy: true,
        closedBy: true,
        payments: true
      }
    });

    return {
      id: cashRegister.id,
      status: cashRegister.status,
      openedAt: cashRegister.openedAt.toISOString(),
      closedAt: cashRegister.closedAt?.toISOString() ?? null,
      initialAmount: Number(cashRegister.initialAmount),
      closingAmount: Number(cashRegister.closingAmount),
      openedBy: cashRegister.openedBy.name,
      closedBy: cashRegister.closedBy?.name ?? null,
      paymentsCount: cashRegister.payments.length,
      totalPayments: cashRegister.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    };
  }
}
