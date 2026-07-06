export type TableStatus = 'LIVRE' | 'OCUPADA' | 'RESERVADA' | 'FECHANDO_CONTA';
export type DeliveryStatus = 'RECEBIDO' | 'EM_PREPARO' | 'SAIU_PARA_ENTREGA' | 'ENTREGUE' | 'CANCELADO';

export interface DeliveryOrderItem {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  note?: string;
}

export interface DeliveryOrder {
  id: string;
  companyId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress: string;
  status: DeliveryStatus;
  paymentMethod: string;
  paymentStatus?: string;
  deliveryFee: number;
  total: number;
  notes?: string;
  items: DeliveryOrderItem[];
  createdAt: string;
  closedAt?: string;
  cancellationRequestedAt?: string | null;
  cancellationReason?: string | null;
}
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
