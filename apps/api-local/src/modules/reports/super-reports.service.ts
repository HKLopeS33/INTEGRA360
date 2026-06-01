import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class SuperReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private getDateRange(period: 'daily' | 'weekly' | 'monthly' | 'yearly') {
    const now = new Date();
    let startOfPeriod: Date;
    let endOfPeriod: Date;

    if (period === 'weekly') {
      const day = now.getDay();
      const mondayOffset = (day + 6) % 7;
      startOfPeriod = new Date(now);
      startOfPeriod.setHours(0, 0, 0, 0);
      startOfPeriod.setDate(now.getDate() - mondayOffset);
      endOfPeriod = new Date(startOfPeriod);
      endOfPeriod.setDate(startOfPeriod.getDate() + 7);
    } else if (period === 'monthly') {
      startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
      endOfPeriod = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (period === 'yearly') {
      startOfPeriod = new Date(now.getFullYear(), 0, 1);
      endOfPeriod = new Date(now.getFullYear() + 1, 0, 1);
    } else {
      startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    return { startOfPeriod, endOfPeriod };
  }

  async getRevenueReport(period: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'daily', companyId?: string) {
    const { startOfPeriod, endOfPeriod } = this.getDateRange(period);

    const orders = await this.prisma.order.findMany({
      where: {
        ...(companyId && { companyId }),
        createdAt: {
          gte: startOfPeriod,
          lt: endOfPeriod
        }
      },
      include: {
        items: {
          include: { product: true }
        },
        company: true
      }
    });

    const groupedByCompany = orders.reduce(
      (acc, order) => {
        if (!acc[order.companyId]) {
          acc[order.companyId] = {
            companyId: order.companyId,
            companyName: order.company.name,
            totalValue: 0,
            totalOrders: 0,
            totalItems: 0
          };
        }
        const orderTotal = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
        acc[order.companyId].totalValue += orderTotal;
        acc[order.companyId].totalOrders += 1;
        acc[order.companyId].totalItems += order.items.reduce((sum, item) => sum + item.quantity, 0);
        return acc;
      },
      {} as Record<string, any>
    );

    const companies = Object.values(groupedByCompany);
    const totalValue = companies.reduce((sum, c) => sum + c.totalValue, 0);

    return {
      period,
      startDate: startOfPeriod.toISOString(),
      endDate: endOfPeriod.toISOString(),
      totalValue: Number(totalValue.toFixed(2)),
      totalOrders: companies.reduce((sum, c) => sum + c.totalOrders, 0),
      totalItems: companies.reduce((sum, c) => sum + c.totalItems, 0),
      companies: companies.sort((a, b) => b.totalValue - a.totalValue)
    };
  }

  async getTicketAverageReport(companyId?: string) {
    const orders = await this.prisma.order.findMany({
      where: companyId ? { companyId } : {},
      include: {
        items: {
          include: { product: true }
        },
        company: true
      }
    });

    const groupedByCompany = orders.reduce(
      (acc, order) => {
        if (!acc[order.companyId]) {
          acc[order.companyId] = {
            companyId: order.companyId,
            companyName: order.company.name,
            orders: []
          };
        }
        const orderTotal = order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
        acc[order.companyId].orders.push(orderTotal);
        return acc;
      },
      {} as Record<string, any>
    );

    const results = Object.values(groupedByCompany).map((company: any) => ({
      companyId: company.companyId,
      companyName: company.companyName,
      ticketAverage: company.orders.length > 0 ? company.orders.reduce((a: number, b: number) => a + b, 0) / company.orders.length : 0,
      totalOrders: company.orders.length,
      minValue: Math.min(...company.orders),
      maxValue: Math.max(...company.orders)
    }));

    return {
      results: results.sort((a, b) => b.ticketAverage - a.ticketAverage)
    };
  }

  async getTopProductsReport(limit: number = 10, companyId?: string) {
    const orderItems = await this.prisma.orderItem.findMany({
      where: companyId
        ? {
            order: { companyId }
          }
        : {},
      include: {
        product: {
          include: { company: true }
        },
        order: true
      }
    });

    const groupedByProduct = orderItems.reduce(
      (acc, item) => {
        if (!acc[item.productId]) {
          acc[item.productId] = {
            productId: item.productId,
            productName: item.product.name,
            companyId: item.product.companyId,
            companyName: item.product.company.name,
            quantity: 0,
            revenue: 0
          };
        }
        acc[item.productId].quantity += item.quantity;
        acc[item.productId].revenue += Number(item.unitPrice) * item.quantity;
        return acc;
      },
      {} as Record<string, any>
    );

    const products = Object.values(groupedByProduct)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit);

    return {
      limit,
      topProducts: products
    };
  }

  async getPaymentMethodsReport(companyId?: string) {
    const payments = await this.prisma.payment.findMany({
      where: companyId
        ? {
            tab: { companyId }
          }
        : {},
      include: {
        tab: { include: { company: true } }
      }
    });

    const groupedByMethod = payments.reduce(
      (acc, payment) => {
        const method = payment.method;
        if (!acc[method]) {
          acc[method] = {
            method,
            totalAmount: 0,
            count: 0,
            percentage: 0
          };
        }
        acc[method].totalAmount += Number(payment.amount);
        acc[method].count += 1;
        return acc;
      },
      {} as Record<string, any>
    );

    const methods = Object.values(groupedByMethod);
    const grandTotal = methods.reduce((sum, m: any) => sum + m.totalAmount, 0);

    return {
      methods: methods.map((method: any) => ({
        ...method,
        percentage: grandTotal > 0 ? ((method.totalAmount / grandTotal) * 100).toFixed(2) : 0,
        totalAmount: Number(method.totalAmount.toFixed(2))
      }))
    };
  }

  async getUserActivityReport(companyId?: string) {
    const orders = await this.prisma.order.findMany({
      where: companyId ? { companyId } : {},
      include: {
        user: true,
        items: true
      }
    });

    const groupedByUser = orders.reduce(
      (acc, order) => {
        const userId = order.userId;
        if (!acc[userId]) {
          acc[userId] = {
            userId: order.user.id,
            userName: order.user.name,
            userEmail: order.user.email,
            userRole: order.user.role,
            ordersCreated: 0,
            itemsSold: 0
          };
        }
        acc[userId].ordersCreated += 1;
        acc[userId].itemsSold += order.items.length;
        return acc;
      },
      {} as Record<string, any>
    );

    const users = Object.values(groupedByUser).sort((a, b) => b.ordersCreated - a.ordersCreated);

    return {
      users
    };
  }

  async getLoginHistoryReport(companyId?: string, limit: number = 100) {
    const users = await this.prisma.user.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { lastLoginAt: 'desc' },
      take: limit
    });

    return {
      users: users.map((user) => ({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        lastLoginAt: user.lastLoginAt?.toISOString() || 'Nunca'
      }))
    };
  }

  async getAuditLogReport(companyId?: string, action?: string, limit: number = 200) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        ...(companyId && { companyId }),
        ...(action && { action: { contains: action } })
      },
      include: {
        user: true,
        company: true
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        companyName: log.company.name,
        userName: log.user?.name || 'Sistema',
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        createdAt: log.createdAt.toISOString(),
        data: log.dataJson ? JSON.parse(log.dataJson) : null
      }))
    };
  }

  async getSubscriptionStatusReport() {
    const subscriptions = await this.prisma.subscription.findMany({
      include: { company: true }
    });

    const grouped = subscriptions.reduce(
      (acc, sub) => {
        const status = sub.status;
        if (!acc[status]) {
          acc[status] = {
            status,
            count: 0,
            companies: []
          };
        }
        acc[status].count += 1;
        acc[status].companies.push({
          companyId: sub.company.id,
          companyName: sub.company.name,
          monthlyFee: Number(sub.monthlyFee),
          expiresAt: sub.expiresAt.toISOString()
        });
        return acc;
      },
      {} as Record<string, any>
    );

    return {
      subscriptions: Object.values(grouped)
    };
  }

  async getPendingPaymentsReport() {
    const payments = await this.prisma.paymentRecord.findMany({
      where: { status: 'PENDENTE' },
      include: { company: true },
      orderBy: { dueDate: 'asc' }
    });

    return {
      count: payments.length,
      payments: payments.map((payment) => ({
        id: payment.id,
        companyName: payment.company.name,
        amount: Number(payment.amount),
        dueDate: payment.dueDate.toISOString(),
        status: payment.status,
        daysOverdue: Math.floor((new Date().getTime() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24))
      }))
    };
  }

  async getSystemHealthReport() {
    const [totalCompanies, totalUsers, totalTables, totalProducts, totalOrders, activeSubscriptions] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.user.count(),
      this.prisma.restaurantTable.count(),
      this.prisma.product.count(),
      this.prisma.order.count(),
      this.prisma.subscription.count({ where: { status: 'ATIVO' } })
    ]);

    const companiesByStatus = await this.prisma.company.groupBy({
      by: ['active'],
      _count: true
    });

    const usersByRole = await this.prisma.user.groupBy({
      by: ['role'],
      _count: true
    });

    return {
      companies: {
        total: totalCompanies,
        byStatus: companiesByStatus.map((stat) => ({
          status: stat.active ? 'Ativo' : 'Inativo',
          count: stat._count
        }))
      },
      users: {
        total: totalUsers,
        byRole: usersByRole.map((stat) => ({
          role: stat.role,
          count: stat._count
        }))
      },
      tables: totalTables,
      products: totalProducts,
      orders: totalOrders,
      subscriptions: {
        active: activeSubscriptions
      }
    };
  }

  async getLowPerformanceProductsReport(minQuantity: number = 5, companyId?: string) {
    const products = await this.prisma.product.findMany({
      where: companyId ? { companyId } : { active: true },
      include: {
        orderItems: true,
        company: true
      }
    });

    const productsWithStats = products
      .map((product) => ({
        productId: product.id,
        productName: product.name,
        companyId: product.companyId,
        companyName: product.company.name,
        price: Number(product.price),
        cost: Number(product.cost),
        quantitySold: product.orderItems.length,
        revenue: product.orderItems.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
      }))
      .filter((p) => p.quantitySold < minQuantity)
      .sort((a, b) => a.quantitySold - b.quantitySold);

    return {
      minQuantity,
      lowPerformanceProducts: productsWithStats
    };
  }

  async getHourlyPeaksReport(companyId?: string) {
    const orders = await this.prisma.order.findMany({
      where: companyId ? { companyId } : {},
      include: {
        items: true,
        company: true
      }
    });

    const groupedByHour = orders.reduce(
      (acc, order) => {
        const hour = order.createdAt.getHours();
        if (!acc[hour]) {
          acc[hour] = {
            hour: `${String(hour).padStart(2, '0')}:00`,
            orders: 0,
            items: 0,
            revenue: 0
          };
        }
        acc[hour].orders += 1;
        acc[hour].items += order.items.length;
        acc[hour].revenue += order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
        return acc;
      },
      {} as Record<number, any>
    );

    return {
      peakHours: Object.values(groupedByHour)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)
    };
  }
}
