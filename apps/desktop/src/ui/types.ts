export type TableStatus = 'LIVRE' | 'OCUPADA' | 'RESERVADA' | 'FECHANDO_CONTA';
export type DisplayStatus = 'LIVRE' | 'AMARELO' | 'VERMELHO';
export type OrderStatus = 'ENVIADO' | 'EM_PREPARO' | 'PRONTO' | 'ENTREGUE' | 'CANCELADO';

export interface RestaurantTable {
  id: string;
  number: number;
  name: string;
  capacity: number;
  status: DisplayStatus;
  hasOpenTab?: boolean;
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  preparationMinutes: number;
  available: boolean;
}

export interface Order {
  id: string;
  tabId?: string;
  tabStatus?: 'ABERTA' | 'FECHANDO' | 'FECHADA' | 'CANCELADA';
  tableId: string;
  tableName: string;
  status: OrderStatus;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    note?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
