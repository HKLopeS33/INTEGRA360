import { Controller, Get, Headers, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SuperReportsService } from './super-reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly superReports: SuperReportsService
  ) {}

  @Get()
  async summary(@Headers('authorization') authHeader: string | undefined, @Query('period') period = 'daily') {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['FINANCEIRO', 'GERENTE']);
    if ('error' in auth) return auth;

    const now = new Date();
    const normalized = (period || 'daily').toLowerCase();

    let startOfPeriod: Date;
    let endOfPeriod: Date;

    if (normalized === 'weekly') {
      const day = now.getDay();
      const mondayOffset = (day + 6) % 7;
      startOfPeriod = new Date(now);
      startOfPeriod.setHours(0, 0, 0, 0);
      startOfPeriod.setDate(now.getDate() - mondayOffset);
      endOfPeriod = new Date(startOfPeriod);
      endOfPeriod.setDate(startOfPeriod.getDate() + 7);
    } else if (normalized === 'monthly') {
      startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
      endOfPeriod = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (normalized === 'yearly') {
      startOfPeriod = new Date(now.getFullYear(), 0, 1);
      endOfPeriod = new Date(now.getFullYear() + 1, 0, 1);
    } else {
      startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    const orders = await this.prisma.order.findMany({
      where: {
        companyId: auth.companyId,
        createdAt: {
          gte: startOfPeriod,
          lt: endOfPeriod
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

    const totals = orders.reduce(
      (acc, order) => {
        const orderTotal = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
        acc.orders += 1;
        acc.totalValue += orderTotal;
        acc.totalItems += order.items.reduce((sum, item) => sum + item.quantity, 0);
        return acc;
      },
      { orders: 0, totalValue: 0, totalItems: 0 }
    );

    const groupedByTable = Object.values(
      orders.reduce((group, order) => {
        const tableId = order.tab.tableId;
        if (!group[tableId]) {
          group[tableId] = {
            tableId,
            tableName: order.tab.table.name,
            orders: [],
            totalValue: 0,
            totalItems: 0
          };
        }
        const orderTotal = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
        group[tableId].orders.push({
          id: order.id,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
          total: orderTotal,
          items: order.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            productName: item.product.name,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            total: Number(item.unitPrice) * item.quantity
          }))
        });
        group[tableId].totalValue += orderTotal;
        group[tableId].totalItems += order.items.reduce((sum, item) => sum + item.quantity, 0);
        return group;
      }, {} as Record<string, any>)
    );

    const periodLabels: Record<string, string> = {
      daily: 'Dia',
      weekly: 'Semana',
      monthly: 'Mês',
      yearly: 'Ano'
    };

    return {
      period: normalized,
      periodLabel: periodLabels[normalized] ?? 'Dia',
      startDate: startOfPeriod.toISOString(),
      endDate: endOfPeriod.toISOString(),
      totalOrders: totals.orders,
      totalItems: totals.totalItems,
      totalValue: Number(totals.totalValue.toFixed(2)),
      tables: groupedByTable
    };
  }

  @Get('daily')
  async daily(@Headers('authorization') authHeader?: string) {
    return this.summary(authHeader, 'daily');
  }

  // Super User Reports Endpoints
  @Get('super/revenue')
  async superRevenue(
    @Headers('authorization') authHeader: string | undefined,
    @Query('period') period: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'daily',
    @Query('companyId') companyId?: string
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getRevenueReport(period, companyId);
  }

  @Get('super/ticket-average')
  async superTicketAverage(
    @Headers('authorization') authHeader: string | undefined,
    @Query('companyId') companyId?: string
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getTicketAverageReport(companyId);
  }

  @Get('super/top-products')
  async superTopProducts(
    @Headers('authorization') authHeader: string | undefined,
    @Query('limit') limit = '10',
    @Query('companyId') companyId?: string
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getTopProductsReport(parseInt(limit), companyId);
  }

  @Get('super/payment-methods')
  async superPaymentMethods(
    @Headers('authorization') authHeader: string | undefined,
    @Query('companyId') companyId?: string
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getPaymentMethodsReport(companyId);
  }

  @Get('super/user-activity')
  async superUserActivity(
    @Headers('authorization') authHeader: string | undefined,
    @Query('companyId') companyId?: string
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getUserActivityReport(companyId);
  }

  @Get('super/login-history')
  async superLoginHistory(
    @Headers('authorization') authHeader: string | undefined,
    @Query('companyId') companyId?: string,
    @Query('limit') limit = '100'
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getLoginHistoryReport(companyId, parseInt(limit));
  }

  @Get('super/audit-log')
  async superAuditLog(
    @Headers('authorization') authHeader: string | undefined,
    @Query('companyId') companyId?: string,
    @Query('action') action?: string,
    @Query('limit') limit = '200'
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getAuditLogReport(companyId, action, parseInt(limit));
  }

  @Get('super/subscriptions')
  async superSubscriptions(@Headers('authorization') authHeader: string | undefined) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getSubscriptionStatusReport();
  }

  @Get('super/pending-payments')
  async superPendingPayments(@Headers('authorization') authHeader: string | undefined) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getPendingPaymentsReport();
  }

  @Get('super/health')
  async superHealth(@Headers('authorization') authHeader: string | undefined) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getSystemHealthReport();
  }

  @Get('super/low-performance-products')
  async superLowPerformanceProducts(
    @Headers('authorization') authHeader: string | undefined,
    @Query('minQuantity') minQuantity = '5',
    @Query('companyId') companyId?: string
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getLowPerformanceProductsReport(parseInt(minQuantity), companyId);
  }

  @Get('super/hourly-peaks')
  async superHourlyPeaks(
    @Headers('authorization') authHeader: string | undefined,
    @Query('companyId') companyId?: string
  ) {
    const auth = await this.authService.ensureSuper(authHeader);
    if ('error' in auth) return auth;
    return this.superReports.getHourlyPeaksReport(companyId);
  }

  // Company individual products report
  @Get('company/products')
  async companyProducts(
    @Headers('authorization') authHeader: string | undefined,
    @Query('dateType') dateType: 'day' | 'week' = 'day',
    @Query('dateValue') dateValue?: string
  ) {
    const auth = await this.authService.requireCompanyUserWithRoles(authHeader, ['FINANCEIRO', 'GERENTE', 'ADMIN']);
    if ('error' in auth) return auth;

    let startDate: Date;
    let endDate: Date;

    if (dateType === 'week' && dateValue) {
      // Parse ISO week format (YYYY-Www)
      const match = dateValue.match(/(\d{4})-W(\d{2})/);
      if (match && match[1] && match[2]) {
        const year = parseInt(match[1], 10);
        const week = parseInt(match[2], 10);
        const simple = new Date(year, 0, 1 + (week - 1) * 7);
        const dow = simple.getDay();
        const ISOweekStart = simple;
        if (dow <= 4)
          ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
        else
          ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
        startDate = new Date(ISOweekStart);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(ISOweekStart);
        endDate.setDate(ISOweekStart.getDate() + 7);
        endDate.setHours(0, 0, 0, 0);
      } else {
        const now = new Date();
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setDate(now.getDate() + 1);
        endDate.setHours(0, 0, 0, 0);
      }
    } else {
      // Day mode
      const date = dateValue ? new Date(dateValue) : new Date();
      startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(date);
      endDate.setDate(date.getDate() + 1);
      endDate.setHours(0, 0, 0, 0);
    }

    // Get all orders for the company in the date range
    const orders = await this.prisma.order.findMany({
      where: {
        companyId: auth.companyId,
        createdAt: {
          gte: startDate,
          lt: endDate
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    // Aggregate products
    const productMap = new Map<string, { productId: string; name: string; price: number; quantity: number }>();
    orders.forEach(order => {
      order.items.forEach(item => {
        const key = item.productId;
        if (!productMap.has(key)) {
          productMap.set(key, {
            productId: item.productId,
            name: item.product.name,
            price: Number(item.unitPrice),
            quantity: 0
          });
        }
        const prod = productMap.get(key)!;
        prod.quantity += item.quantity;
      });
    });

    // Convert to array and sort
    const products = Array.from(productMap.values());
    const topProducts = products.sort((a, b) => b.quantity - a.quantity).slice(0, 10);
    const lowProducts = products.sort((a, b) => a.quantity - b.quantity).slice(0, 10);

    return {
      topProducts,
      lowProducts,
      dateType,
      dateValue,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
  }
}
