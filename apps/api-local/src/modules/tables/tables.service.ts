import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { TabStatus, OrderStatus } from '@prisma/client';

export enum TableDisplayStatus {
  LIVRE = 'LIVRE',      // Verde - Sem comanda aberta
  AMARELO = 'AMARELO',  // Amarelo - Comanda aberta, pedidos aguardando
  VERMELHO = 'VERMELHO' // Vermelho - Comanda aberta, todos pedidos entregues
}

interface TableWithStatus {
  id: string;
  number: number;
  name: string;
  capacity: number;
  status: string;
  displayStatus: TableDisplayStatus;
  hasOpenTab: boolean;
}

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async getTablesWithStatus(companyId: string): Promise<TableWithStatus[]> {
    const tables = await this.prisma.restaurantTable.findMany({
      where: { active: true, companyId },
      orderBy: { number: 'asc' },
      include: {
        tabs: {
          where: {
            status: { in: ['ABERTA' as TabStatus, 'FECHANDO' as TabStatus] }
          },
          include: {
            orders: {
              include: {
                items: true
              }
            }
          }
        }
      }
    });

    return tables.map((table) => {
      const displayStatus = this.calculateDisplayStatus(table.tabs);

      return {
        id: table.id,
        number: table.number,
        name: table.name,
        capacity: table.capacity,
        status: table.status,
        displayStatus,
        hasOpenTab: table.tabs.length > 0
      };
    });
  }

  private calculateDisplayStatus(
    tabs: Array<{
      status: string;
      orders: Array<{
        status: string;
        items: Array<{ status: string }>;
      }>;
    }>
  ): TableDisplayStatus {
    // Se não tem comanda aberta, mesa está livre
    if (tabs.length === 0) {
      return TableDisplayStatus.LIVRE;
    }

    // Verifica o status de todos os pedidos nas comandas abertas
    const openTab = tabs[0]; // Pega a primeira comanda aberta (deve haver apenas uma)

    if (!openTab || !openTab.orders || openTab.orders.length === 0) {
      // Comanda aberta mas sem pedidos
      return TableDisplayStatus.AMARELO;
    }

    // Verifica se há algum pedido que NÃO foi entregue
    const hasUndeliveredOrders = openTab.orders.some(
      (order) => order.status !== 'ENTREGUE'
    );

    // Se tem pedidos não entregues, está aguardando (amarelo)
    if (hasUndeliveredOrders) {
      return TableDisplayStatus.AMARELO;
    }

    // Se todos os pedidos foram entregues, está apenas ocupada (vermelho)
    return TableDisplayStatus.VERMELHO;
  }
}
