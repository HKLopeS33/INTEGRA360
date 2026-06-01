import type { Order, Product, RestaurantTable } from './types.js';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3333';

let authToken: string | null = null;

const getAuthToken = () => authToken || localStorage.getItem('authToken');
const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
};

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers,
    ...options
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401) {
      setAuthToken(null);
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('sistema:unauthorized', { detail: { status: 401 } }));
        }
      } catch (e) {
        // ignore: defensive in case environment has no window
      }
    }
    const message = parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as any).error : `Erro na API: ${response.status}`;
    throw new Error(message);
  }

  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    throw new Error((parsed as any).error ?? 'Erro da API');
  }

  return parsed as T;
};

export const api = {
  // Auth
  login: async (email: string, password: string): Promise<{ accessToken: string; user: any; company?: any } | { error: string }> => {
    try {
      const result = await request<{ accessToken: string; user: any; company?: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (result.accessToken) {
        setAuthToken(result.accessToken);
      }
      return result;
    } catch (err: any) {
      return { error: err.message ?? 'Erro ao conectar com a API' };
    }
  },

  validateToken: (token: string) =>
    request<{ valid: boolean; user?: any }>('/auth/validate-token', {
      method: 'POST',
      body: JSON.stringify({ token })
    }),

  me: () => request<{ user: any; company?: any }>('/auth/me'),
  getCompanyProfile: () => request<{ company: any }>('/auth/company'),
  updateCompanyProfile: (payload: { name?: string; cnpj?: string; email?: string; phone?: string; address?: string; city?: string; state?: string; country?: string; pixKey?: string }) =>
    request<{ success: boolean; company: any }>('/auth/company/update', { method: 'POST', body: JSON.stringify(payload) }),

  logout: async () => {
    await request<{ success: boolean }>('/auth/logout', {
      method: 'POST'
    });
    setAuthToken(null);
  },

  getToken: () => getAuthToken(),
  setToken: setAuthToken,

  health: () => request<{ status: string }>('/health'),
  
  // Tables
  tables: () => request<RestaurantTable[]>('/tables'),
  updateTableStatus: (tableId: string, status: string) =>
    request<RestaurantTable>(`/tables/${tableId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }),
  
  // Menu
  categories: () => request('/menu/categories'),
  products: () => request<Product[]>('/menu/products'),
  createProduct: (product: {
    categoryId?: string;
    name: string;
    description?: string;
    price: number;
    preparationMinutes?: number;
  }) =>
    request<Product>('/menu/products', {
      method: 'POST',
      body: JSON.stringify(product)
    }),
  
  // Orders
  orders: (active?: boolean) => request<Order[]>(`/orders${active ? '?active=true' : ''}`),
  createOrder: (tableId: string, items: Array<{ productId: string; quantity: number; note?: string }>) =>
    request<Order>('/orders', {
      method: 'POST',
      body: JSON.stringify({ tableId, items })
    }),
  updateOrderStatus: (orderId: string, status: string) =>
    request<Order>(`/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }),
  closeTab: (tabId: string, paymentMethod: string, amountPaid?: number) =>
    request<{ receiptNumber?: number; [key: string]: any }>(`/tabs/${tabId}/close`, {
      method: 'PATCH',
      body: JSON.stringify({ paymentMethod, amountPaid })
    }),
  initiatePixPayment: (tabId: string, amount: number) =>
    request<{ paymentId: string; status: string; amount: number }>(`/tabs/${tabId}/pix/initiate`, {
      method: 'POST',
      body: JSON.stringify({ amount })
    }),
  getPixPaymentStatus: (tabId: string) =>
    request<{ status: string; amount: number; paymentId?: string }>(`/tabs/${tabId}/pix-status`),
  confirmPixPayment: (tabId: string) =>
    request<{ status: string; amount: number; paymentId?: string }>(`/tabs/${tabId}/pix-confirm`, {
      method: 'PATCH'
    }),
  dailyReport: () => request<any>('/reports/daily'),
  reportSummary: (period: string = 'daily') => request<any>(`/reports?period=${period}`),
  
  // Kitchen
  kitchenQueue: () => request<Order[]>('/kitchen/queue'),
  
  // Cash Register
  cashRegisterCurrent: () => request<any>('/cash-register/current'),
  openCashRegister: (initialAmount: number) =>
    request<any>('/cash-register/open', {
      method: 'POST',
      body: JSON.stringify({ initialAmount })
    }),
  closeCashRegister: (closingAmount: number) =>
    request<any>('/cash-register/close', {
      method: 'PATCH',
      body: JSON.stringify({ closingAmount })
    })
  ,

  // Super user / multi-tenant
  createCompany: (payload: any) =>
    request('/auth/super/create-company', { method: 'POST', body: JSON.stringify(payload) }),

  listCompanies: () => request<any[]>('/auth/super/companies'),

  suspendCompany: (companyId: string) => request(`/auth/super/company/${companyId}/suspend`, { method: 'POST' }),
  reactivateCompany: (companyId: string) => request(`/auth/super/company/${companyId}/reactivate`, { method: 'POST' }),

  suspendUser: (userId: string) => request(`/auth/super/user/${userId}/suspend`, { method: 'POST' }),
  reactivateUser: (userId: string) => request(`/auth/super/user/${userId}/reactivate`, { method: 'POST' }),
  deleteUser: (userId: string) => request(`/auth/super/user/${userId}/delete`, { method: 'POST' }),
  listUsers: (companyId?: string) => request<any[]>(`/auth/users${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`),
  createCompanyUser: (payload: { name: string; email: string; password: string; role?: string; active?: boolean; companyId?: string }) =>
    request('/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (userId: string, payload: any) => request(`/auth/super/user/${userId}/update`, { method: 'POST', body: JSON.stringify(payload) }),

  renewSubscription: (companyId: string, payload: { months?: number; days?: number; hours?: number; amount?: number; status?: string }) =>
    request(`/auth/super/company/${companyId}/renew`, { method: 'POST', body: JSON.stringify(payload) }),

  markPaymentPaid: (paymentId: string) =>
    request(`/auth/super/payment/${paymentId}/pay`, { method: 'POST' }),

  changePassword: (newPassword: string, confirmPassword: string) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ newPassword, confirmPassword }) }),

  // Receipts
  listDailyReceipts: () => request<any[]>('/tabs/receipts/daily'),
  getReceiptByNumber: (receiptNumber: number) => request<any>(`/tabs/receipts/number/${receiptNumber}`),

  // Generic fetch for super user reports
  fetch: (path: string, params?: Record<string, any>) => {
    const queryString = new URLSearchParams(params || {}).toString();
    const fullPath = queryString ? `/${path}?${queryString}` : `/${path}`;
    return request<any>(fullPath);
  }
};
