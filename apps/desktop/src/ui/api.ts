import type { Order, Product, RestaurantTable } from './types.js';
import { supabase, supabaseAnon, getAuthToken, setAuthToken } from './supabase.ts';
import { getCompanyById, getCompanyForCurrentUser, getUserRowById, invalidateUserCache, loadCurrentUser, requireCompanyUser, requireCompanyUserWithRoles, requireSuperUser } from './supabase-db.ts';

// Ordenação "natural": trata números embutidos no nome como números, não como
// texto — sem isso "10. Item" vem antes de "7. Item" (comparação de string
// puxa '1' < '7'), o que fica visivelmente fora de ordem pro cliente no
// cardápio. Ex.: ["7. Batata simples", "10. Batata especial"] -> mantém 7 antes de 10.
const naturalNameCompare = (a: string, b: string) =>
  (a ?? '').localeCompare(b ?? '', 'pt-BR', { numeric: true, sensitivity: 'base' });

// Cria usuário no Supabase Auth via Admin REST API (service role key).
// Isso é necessário para aceitar emails com domínios internos (.local, etc.)
// e confirmar o email automaticamente sem enviar mensagem.
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_SERVICE_KEY: string = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string;
const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string;

const createAuthUser = async (email: string, password: string, metadata: Record<string, any>) => {
  if (SUPABASE_SERVICE_KEY) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.msg || json.message || `Erro ${res.status} ao criar usuário.`);
    return json as { id: string; email: string };
  }
  // Fallback sem service key (requer email real e confirmação)
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: metadata } });
  if (error || !data.user) throw new Error(error?.message || 'Falha ao criar usuário.');
  return data.user;
};

const throwSupabaseError = (error: any, defaultMessage: string) => {
  if (error) {
    throw new Error(error.message || defaultMessage);
  }
  throw new Error(defaultMessage);
};

const normalizeCompany = (company: any) => ({
  id: company.id,
  name: company.name,
  email: company.email,
  cnpj: company.cnpj,
  phone: company.phone,
  address: company.address,
  city: company.city,
  state: company.state,
  country: company.country,
  pixKey: company.pixKey ?? null,
  kitchenPrinter: company.kitchenPrinter ?? null,
  cashierPrinter: company.cashierPrinter ?? null,
  printingDisabled: company.printingDisabled ?? false,
  menuBannerUrl: company.menuBannerUrl ?? null,
  active: company.active,
  deliveryFeeAmount: Number(company.deliveryFeeAmount ?? 0),
  openingTime: company.openingTime ?? '18:00',
  closingTime: company.closingTime ?? '00:00',
  isOpen: company.isOpen !== false, // default true
  plan: (company.plan ?? 'STARTER') as 'STARTER' | 'TRIAL' | 'PRO' | 'ENTERPRISE',
  planMonthlyPrice: Number(company.planMonthlyPrice ?? 0),
  trialEndsAt: company.trialEndsAt ?? null,
});

const normalizeTableDisplay = (tabs: Array<{ status: string }>) => {
  if (!tabs || tabs.length === 0) {
    return 'LIVRE';
  }

  const hasOrders = tabs.some((tab) => Boolean(tab));
  if (!hasOrders) {
    return 'AMARELO';
  }

  const allDelivered = tabs.every((tab) => tab.status === 'ENTREGUE' || tab.status === 'PRONTO' || tab.status === 'EM_PREPARO');
  return allDelivered ? 'VERMELHO' : 'AMARELO';
};

const mapOrderResponse = (order: any, tabMap: Record<string, any>, tableMap: Record<string, any>, itemMap: Record<string, any[]>, productMap: Record<string, any>) => {
  const tab = tabMap[order.tabId];
  const table = tab ? tableMap[tab.tableId] : null;
  const items = (itemMap[order.id] || []).map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: productMap[item.productId]?.name ?? '',
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    note: item.note ?? undefined
  }));

  return {
    id: order.id,
    tableId: tab?.tableId ?? '',
    tableName: table?.name ?? '',
    tabId: order.tabId,
    tabStatus: tab?.status ?? '',
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items
  };
};

const buildReportQuery = (params?: Record<string, any>) => {
  if (!params) return '';
  return Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
};

const formatDate = (value: string | null) => (value ? new Date(value).toISOString() : null);

// ── API pública de delivery (sem autenticação — acesso anon) ─────────────────

// Helper para requisições públicas sem autenticação (bypass do cliente Supabase JS)
const anonFetch = async (path: string, options?: RequestInit) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  return res;
};

export const publicDeliveryApi = {
  getMenu: async (companyId: string) => {
    const [companyRes, categoriesRes, productsRes] = await Promise.all([
      anonFetch(`/Company?id=eq.${encodeURIComponent(companyId)}&active=eq.true&select=id,name,menuBannerUrl,phone,deliveryFeeAmount,openingTime,closingTime,isOpen&limit=1`),
      anonFetch(`/Category?companyId=eq.${encodeURIComponent(companyId)}&active=eq.true&select=id,name,sort,imageUrl&order=sort.asc`),
      anonFetch(`/Product?companyId=eq.${encodeURIComponent(companyId)}&active=eq.true&available=eq.true&select=id,categoryId,name,description,price,available,salesCount&order=name.asc`),
    ]);
    if (!companyRes.ok) throw new Error('Empresa não encontrada ou inativa.');
    const companies: any[] = await companyRes.json();
    if (!companies.length) throw new Error('Empresa não encontrada ou inativa.');
    const categories: any[] = await categoriesRes.json();
    const products: any[] = await productsRes.json();
    return {
      company: { ...companies[0], deliveryFeeAmount: Number(companies[0].deliveryFeeAmount ?? 0), isOpen: companies[0].isOpen !== false } as { id: string; name: string; menuBannerUrl: string | null; phone: string | null; deliveryFeeAmount: number; openingTime: string; closingTime: string; isOpen: boolean },
      categories: categories as Array<{ id: string; name: string; sort: number; imageUrl: string | null }>,
      products: products
        .map((p: any) => ({ ...p, price: Number(p.price), salesCount: Number(p.salesCount ?? 0) }))
        .sort((a: any, b: any) => naturalNameCompare(a.name, b.name)) as Array<{ id: string; categoryId: string; name: string; description: string | null; price: number; available: boolean; salesCount: number }>,
    };
  },

  createOrder: async (companyId: string, payload: {
    customerName: string;
    customerPhone?: string;
    customerAddress: string;
    paymentMethod: string;
    deliveryFee: number;
    notes?: string;
    items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; note?: string }>;
  }) => {
    const total = payload.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) + payload.deliveryFee;
    // Gera o UUID no cliente para não precisar de SELECT após INSERT (evita RLS anon sem policy de leitura)
    const orderId = crypto.randomUUID();

    // Pedidos pagos online (Mercado Pago) só são liberados para o estabelecimento
    // após confirmação do pagamento via webhook — ficam "aguardando pagamento" até lá.
    const isOnlinePayment = payload.paymentMethod === 'ONLINE' || payload.paymentMethod === 'PIX_ONLINE' || payload.paymentMethod === 'CARTAO_ONLINE';

    const orderRes = await anonFetch('/DeliveryOrder', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        id: orderId,
        companyId,
        customerName: payload.customerName.trim(),
        customerPhone: payload.customerPhone?.trim() || null,
        customerAddress: payload.customerAddress.trim(),
        paymentMethod: payload.paymentMethod,
        deliveryFee: payload.deliveryFee,
        total,
        notes: payload.notes?.trim() || null,
        status: isOnlinePayment ? 'AGUARDANDO_PAGAMENTO' : 'RECEBIDO',
        paymentStatus: isOnlinePayment ? 'PENDENTE' : 'PAGO',
        updatedAt: new Date().toISOString(),
      }),
    });
    if (!orderRes.ok) {
      const body = await orderRes.text();
      throw new Error(`Falha ao registrar pedido. (${orderRes.status}) ${body}`);
    }

    if (payload.items.length > 0) {
      const itemsRes = await anonFetch('/DeliveryOrderItem', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload.items.map((item) => ({
          deliveryOrderId: orderId,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          note: item.note || null,
        }))),
      });
      if (!itemsRes.ok) {
        const body = await itemsRes.text();
        throw new Error(`Falha ao salvar itens do pedido. (${itemsRes.status}) ${body}`);
      }
    }
    // Busca o receiptNumber gerado pelo banco (SECURITY DEFINER via trigger)
    let receiptNumber: number | null = null;
    try {
      const receiptRes = await anonFetch(`/DeliveryOrder?id=eq.${orderId}&select=receiptNumber&limit=1`);
      if (receiptRes.ok) {
        const rows: any[] = await receiptRes.json();
        receiptNumber = rows[0]?.receiptNumber ?? null;
      }
    } catch { /* não crítico — exibe o número se disponível */ }

    // Notificação WhatsApp para pedidos em dinheiro (status já é RECEBIDO no insert)
    if (!isOnlinePayment) {
      fetch(`${SUPABASE_URL}/functions/v1/whatsapp-notify`, { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, status: 'RECEBIDO' }) }).catch(() => {});
    }

    return { id: orderId, receiptNumber };
  },

  getOrderStatus: async (orderId: string): Promise<{ status: string; receiptNumber: number | null; paymentStatus: string } | null> => {
    const res = await anonFetch(`/DeliveryOrder?id=eq.${encodeURIComponent(orderId)}&select=status,receiptNumber,paymentStatus&limit=1`);
    if (!res.ok) return null;
    const rows: any[] = await res.json();
    if (!rows.length) return null;
    return { status: rows[0].status, receiptNumber: rows[0].receiptNumber ?? null, paymentStatus: rows[0].paymentStatus ?? 'PAGO' };
  },

  // Pagamento online agora é processado pela conta master da plataforma
  // (não depende mais de cada empresa conectar sua própria conta MP).
  isMercadoPagoAvailable: async (_companyId: string): Promise<boolean> => true,

  // Creates a Mercado Pago Checkout Pro preference (card + PIX + all methods).
  // Returns the init_point URL to redirect the customer.
  createCheckoutPreference: async (companyId: string, deliveryOrderId: string, backUrl: string) => {
    const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL ?? '';
    const anonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY ?? '';
    const res = await fetch(`${supabaseUrl}/functions/v1/mercado-pago-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey },
      body: JSON.stringify({ companyId, deliveryOrderId, backUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error || 'Falha ao criar sessão de pagamento.');
    return data as { initPoint: string; preferenceId: string };
  },

  // Creates a Mercado Pago Pix charge for an order that is awaiting payment.
  // Calls the public Edge Function (no Supabase auth session for anonymous customers).
  createPixCharge: async (companyId: string, deliveryOrderId: string, payerEmail?: string) => {
    const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL ?? (import.meta as any).env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY ?? (import.meta as any).env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/mercado-pago-public-pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey },
      body: JSON.stringify({ companyId, deliveryOrderId, payerEmail }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      throw new Error(data?.error || 'Falha ao gerar cobrança Pix.');
    }
    return data as { mpPaymentId: string; status: string; qrCode: string | null; qrCodeBase64: string | null; ticketUrl: string | null };
  },

  // Public key da conta Mercado Pago master — segura para embutir no front-end
  // (usada para montar o Card Payment Brick no cardápio público).
  getPlatformPublicKey: async (): Promise<string | null> => {
    const { data, error } = await supabaseAnon.rpc('get_platform_mercado_pago_public_key');
    if (error) {
      console.error('Falha ao carregar public key do Mercado Pago', error);
      return null;
    }
    return (data as string) ?? null;
  },

  // Processa pagamento de cartão (token gerado pelo Card Payment Brick no
  // navegador do cliente — o número do cartão nunca passa pelo nosso backend).
  payWithCard: async (companyId: string, deliveryOrderId: string, formData: {
    token: string;
    paymentMethodId: string;
    issuerId?: string;
    payerEmail?: string;
    payerDocType?: string;
    payerDocNumber?: string;
  }) => {
    const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL ?? (import.meta as any).env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY ?? (import.meta as any).env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/mercado-pago-card-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey },
      body: JSON.stringify({ companyId, deliveryOrderId, ...formData }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      throw new Error(data?.error || 'Pagamento recusado. Tente outro cartão.');
    }
    return data as { status: string; statusDetail: string; mpPaymentId: string };
  },

  // Registra uma visita ao cardápio público. Chamado anonimamente assim que o
  // cliente abre o link — não requer sessão de autenticação.
  incrementMenuOpenCount: async (companyId: string): Promise<void> => {
    await supabaseAnon.rpc('increment_menu_open_count', { p_company_id: companyId });
  },

  // Cliente solicita cancelamento do pedido (sem autenticação, via RPC anon)
  requestCancellation: async (orderId: string, reason: string): Promise<{ ok?: boolean; error?: string }> => {
    const { data, error } = await supabaseAnon.rpc('request_delivery_cancellation', {
      p_order_id: orderId,
      p_reason: reason,
    });
    if (error) return { error: error.message };
    return data as { ok?: boolean; error?: string };
  },
};

export const api = {
  login: async (email: string, password: string): Promise<{ accessToken: string; user: any; company?: any } | { error: string }> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return { error: error.message || 'Erro ao conectar com o Supabase Auth' };
      }
      if (!data.session || !data.user) {
        return { error: 'Falha ao autenticar usuário.' };
      }

      await setAuthToken(data.session.access_token, data.session.refresh_token ?? data.session.access_token);
      try {
        const user = await loadCurrentUser();
        const company = user.companyId ? await getCompanyById(user.companyId) : null;
        return { accessToken: data.session.access_token, user, company: company ? normalizeCompany(company) : null };
      } catch (innerError: any) {
        return { error: innerError.message ?? 'Falha ao carregar perfil do usuário.' };
      }
    } catch (err: any) {
      return { error: err.message ?? 'Erro ao conectar com o Supabase Auth' };
    }
  },

  validateToken: async (token: string) => {
    if (!token) {
      return { valid: false };
    }
    await setAuthToken(token, token);
    const { data, error } = await supabase.auth.getUser();
    return { valid: !error, user: data.user ? data.user : undefined };
  },

  me: async () => {
    const user = await loadCurrentUser();
    const company = user.companyId ? await getCompanyById(user.companyId) : null;
    return { user, company: company ? normalizeCompany(company) : null };
  },

  getCompanyProfile: async () => {
    const company = await getCompanyForCurrentUser();
    return { company: normalizeCompany(company) };
  },

  updateCompanyProfile: async (payload: { name?: string; cnpj?: string; email?: string; phone?: string; address?: string; city?: string; state?: string; country?: string; pixKey?: string; kitchenPrinter?: string; cashierPrinter?: string; printingDisabled?: boolean; deliveryFeeAmount?: number; openingTime?: string; closingTime?: string }) => {
    const user = await requireCompanyUser();
    const { data, error } = await supabase
      .from('Company')
      .update({
        name: payload.name,
        cnpj: payload.cnpj,
        email: payload.email,
        phone: payload.phone,
        address: payload.address,
        city: payload.city,
        state: payload.state,
        country: payload.country,
        pixKey: payload.pixKey,
        kitchenPrinter: payload.kitchenPrinter ?? null,
        cashierPrinter: payload.cashierPrinter ?? null,
        printingDisabled: payload.printingDisabled ?? false,
        ...(payload.deliveryFeeAmount !== undefined && { deliveryFeeAmount: payload.deliveryFeeAmount }),
        ...(payload.openingTime !== undefined && { openingTime: payload.openingTime }),
        ...(payload.closingTime !== undefined && { closingTime: payload.closingTime }),
      })
      .eq('id', user.companyId)
      .select('id,name,email,cnpj,phone,address,city,state,country,pixKey,kitchenPrinter,cashierPrinter,printingDisabled,menuBannerUrl,active,deliveryFeeAmount,openingTime,closingTime,isOpen,plan,planMonthlyPrice,trialEndsAt')
      .single();

    if (error) {
      throwSupabaseError(error, 'Falha ao atualizar empresa.');
    }

    return { success: true, company: normalizeCompany(data) };
  },

  setStoreIsOpen: async (isOpen: boolean) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE']);
    const { error } = await supabase
      .from('Company')
      .update({ isOpen, updatedAt: new Date().toISOString() })
      .eq('id', user.companyId);
    if (error) throwSupabaseError(error, 'Falha ao atualizar status da loja.');
    return { success: true };
  },

  logout: async () => {
    invalidateUserCache();
    await supabase.auth.signOut();
    return { success: true };
  },

  getToken: async () => getAuthToken(),
  setToken: setAuthToken,

  health: async () => ({ status: 'ok' }),

  tables: async () => {
    const user = await requireCompanyUser();
    const { data: tables, error: tablesError } = await supabase
      .from('RestaurantTable')
      .select('id,number,name,capacity,status,active')
      .eq('companyId', user.companyId)
      .eq('active', true)
      .order('number', { ascending: true });

    if (tablesError) {
      throwSupabaseError(tablesError, 'Falha ao carregar mesas.');
    }

    const tableIds = (tables || []).map((table) => table.id);

    // Buscar tabs de todas as mesas em paralelo (única query com join implícito de status)
    const { data: tabs, error: tabsError } = tableIds.length > 0
      ? await supabase.from('Tab').select('id,tableId,status').in('tableId', tableIds).in('status', ['ABERTA', 'FECHANDO'])
      : { data: [] as any[], error: null };

    if (tabsError) {
      throwSupabaseError(tabsError, 'Falha ao carregar comandas.');
    }

    const tabIds = (tabs || []).map((tab) => tab.id);
    let orderMap: Record<string, Array<{ status: string }>> = {};
    if (tabIds.length > 0) {
      const { data: orders, error: ordersError } = await supabase
        .from('Order')
        .select('tabId,status')
        .in('tabId', tabIds)
        .in('status', ['ENVIADO', 'EM_PREPARO', 'PRONTO']);
      if (ordersError) {
        throwSupabaseError(ordersError, 'Falha ao carregar pedidos.');
      }
      orderMap = (orders || []).reduce((acc, order) => {
        acc[order.tabId] = acc[order.tabId] || [];
        acc[order.tabId].push({ status: order.status });
        return acc;
      }, {} as Record<string, Array<{ status: string }>>);
    }

    const tabByTable = (tabs || []).reduce((acc, tab) => {
      acc[tab.tableId] = acc[tab.tableId] || [];
      acc[tab.tableId].push(tab);
      return acc;
    }, {} as Record<string, Array<any>>);

    return (tables || []).map((table) => {
      const openTabs = tabByTable[table.id] || [];
      const activeOrders = openTabs.flatMap((tab) => orderMap[tab.id] ?? []);
      // Sem comanda aberta → LIVRE
      // Comanda aberta sem pedidos ativos (todos entregues) → VERMELHO (aguardando fechamento)
      // Comanda aberta com pedidos em andamento → AMARELO
      const displayStatus = openTabs.length === 0 ? 'LIVRE' : activeOrders.length === 0 ? 'VERMELHO' : 'AMARELO';
      return {
        id: table.id,
        number: table.number,
        name: table.name,
        capacity: table.capacity,
        status: displayStatus,
        hasOpenTab: openTabs.length > 0
      };
    });
  },

  updateTableStatus: async (tableId: string, status: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'ESTOQUE']);
    const { data: table, error: tableError } = await supabase
      .from('RestaurantTable')
      .select('id,number,name,capacity,status,companyId')
      .eq('id', tableId)
      .single();

    if (tableError) {
      throwSupabaseError(tableError, 'Falha ao carregar mesa.');
    }
    if (!table || table.companyId !== user.companyId) {
      throw new Error('Mesa nao encontrada.');
    }

    const { data: updated, error: updateError } = await supabase
      .from('RestaurantTable')
      .update({ status })
      .eq('id', tableId)
      .select('id,number,name,capacity,status')
      .single();

    if (updateError) {
      throwSupabaseError(updateError, 'Falha ao atualizar mesa.');
    }

    return updated;
  },

  categories: async () => {
    const user = await requireCompanyUser();
    const { data, error } = await supabase
      .from('Category')
      .select('id,name,active,imageUrl')
      .eq('companyId', user.companyId)
      .eq('active', true)
      .order('sort', { ascending: true });

    if (error) {
      throwSupabaseError(error, 'Falha ao carregar categorias.');
    }
    return data || [];
  },

  uploadCategoryImage: async (file: File, categoryId: string): Promise<string> => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'ESTOQUE']);
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${user.companyId}/cat_${categoryId}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new Error(error.message || 'Falha ao enviar imagem.');
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  },

  updateCategoryImage: async (categoryId: string, imageUrl: string | null): Promise<void> => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'ESTOQUE']);
    const { error } = await supabase.from('Category').update({ imageUrl }).eq('id', categoryId).eq('companyId', user.companyId);
    if (error) throwSupabaseError(error, 'Falha ao atualizar imagem da categoria.');
  },

  uploadMenuBanner: async (file: File): Promise<string> => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE']);
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${user.companyId}/menu_banner.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new Error(error.message || 'Falha ao enviar banner.');
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    // Salva a URL no perfil da empresa
    await supabase.from('Company').update({ menuBannerUrl: data.publicUrl }).eq('id', user.companyId);
    return data.publicUrl;
  },

  products: async () => {
    const user = await requireCompanyUser();
    const { data, error } = await supabase
      .from('Product')
      .select('id,categoryId,name,description,price,preparationMinutes,available,imageUrl')
      .eq('companyId', user.companyId)
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) {
      throwSupabaseError(error, 'Falha ao carregar produtos.');
    }

    return (data || [])
      .map((product) => ({
        ...product,
        price: Number(product.price)
      }))
      .sort((a, b) => naturalNameCompare(a.name, b.name));
  },

  uploadProductImage: async (file: File, productId: string): Promise<string> => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'ESTOQUE']);
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${user.companyId}/${productId}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new Error(error.message || 'Falha ao enviar imagem.');
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  },

  createProduct: async (product: {
    categoryId?: string;
    name: string;
    description?: string;
    price: number;
    preparationMinutes?: number;
    imageUrl?: string;
  }) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'ESTOQUE']);

    let categoryId = product.categoryId;
    if (categoryId) {
      const { data: category, error: categoryError } = await supabase
        .from('Category')
        .select('id,companyId')
        .eq('id', categoryId)
        .single();
      if (categoryError) {
        throwSupabaseError(categoryError, 'Falha ao carregar categoria.');
      }
      if (!category || category.companyId !== user.companyId) {
        categoryId = undefined;
      }
    }

    if (!categoryId) {
      const { data: fallbackCategory, error: fallbackError } = await supabase
        .from('Category')
        .select('id')
        .eq('companyId', user.companyId)
        .eq('active', true)
        .order('sort', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fallbackError) {
        throwSupabaseError(fallbackError, 'Falha ao carregar categoria padrao.');
      }

      if (fallbackCategory) {
        categoryId = fallbackCategory.id;
      } else {
        const { data: createdCategory, error: createCategoryError } = await supabase
          .from('Category')
          .insert([{ companyId: user.companyId, name: 'Sem categoria', sort: 0, active: true }])
          .select('id')
          .single();

        if (createCategoryError) {
          throwSupabaseError(createCategoryError, 'Falha ao criar categoria padrao.');
        }
        categoryId = createdCategory.id;
      }
    }

    const { data, error } = await supabase
      .from('Product')
      .insert([{
        companyId: user.companyId,
        categoryId,
        name: product.name.trim(),
        description: product.description?.trim() || 'Sem descricao.',
        price: Number(product.price),
        cost: 0,
        internalCode: `PROD-${Date.now()}`,
        preparationMinutes: Number(product.preparationMinutes ?? 0),
        available: true,
        active: true,
        imageUrl: product.imageUrl ?? null,
      }])
      .select('id,categoryId,name,description,price,preparationMinutes,available,imageUrl')
      .single();

    if (error) {
      throwSupabaseError(error, 'Falha ao criar produto.');
    }

    return {
      ...data,
      price: Number(data.price)
    };
  },

  updateProduct: async (productId: string, payload: {
    name?: string;
    description?: string;
    price?: number;
    preparationMinutes?: number;
    categoryId?: string;
    available?: boolean;
    imageUrl?: string | null;
  }) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'ESTOQUE']);
    const { data, error } = await supabase
      .from('Product')
      .update({
        ...(payload.name !== undefined && { name: payload.name.trim() }),
        ...(payload.description !== undefined && { description: payload.description.trim() }),
        ...(payload.price !== undefined && { price: Number(payload.price) }),
        ...(payload.preparationMinutes !== undefined && { preparationMinutes: Number(payload.preparationMinutes) }),
        ...(payload.categoryId !== undefined && { categoryId: payload.categoryId }),
        ...(payload.available !== undefined && { available: payload.available }),
        ...('imageUrl' in payload && { imageUrl: payload.imageUrl ?? null }),
      })
      .eq('id', productId)
      .eq('companyId', user.companyId)
      .select('id,categoryId,name,description,price,preparationMinutes,available,imageUrl')
      .single();
    if (error) throwSupabaseError(error, 'Falha ao atualizar produto.');
    return { ...data, price: Number(data.price) };
  },

  deleteProduct: async (productId: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'ESTOQUE']);
    const { error } = await supabase
      .from('Product')
      .update({ active: false })
      .eq('id', productId)
      .eq('companyId', user.companyId);
    if (error) throwSupabaseError(error, 'Falha ao remover produto.');
    return { success: true };
  },

  createCategory: async (name: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'ESTOQUE']);
    const { data: existing } = await supabase
      .from('Category')
      .select('id')
      .eq('companyId', user.companyId)
      .ilike('name', name.trim())
      .maybeSingle();
    if (existing) throw new Error('Categoria já existe.');
    const { data: maxSort } = await supabase
      .from('Category')
      .select('sort')
      .eq('companyId', user.companyId)
      .order('sort', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from('Category')
      .insert([{ companyId: user.companyId, name: name.trim(), sort: (maxSort?.sort ?? 0) + 1, active: true }])
      .select('id,name,active')
      .single();
    if (error) throwSupabaseError(error, 'Falha ao criar categoria.');
    return data;
  },

  // ── Delivery ─────────────────────────────────────────────────────────────

  createDeliveryOrder: async (payload: {
    customerName: string;
    customerPhone?: string;
    customerAddress: string;
    paymentMethod: string;
    deliveryFee: number;
    notes?: string;
    items: Array<{ productId?: string; productName: string; quantity: number; unitPrice: number; note?: string }>;
  }) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'CAIXA', 'GARCOM']);
    const total = payload.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) + payload.deliveryFee;

    const { data: order, error } = await supabase
      .from('DeliveryOrder')
      .insert([{
        companyId: user.companyId,
        customerName: payload.customerName.trim(),
        customerPhone: payload.customerPhone?.trim() || null,
        customerAddress: payload.customerAddress.trim(),
        paymentMethod: payload.paymentMethod,
        deliveryFee: payload.deliveryFee,
        total,
        notes: payload.notes?.trim() || null,
        status: 'RECEBIDO',
        updatedAt: new Date().toISOString()
      }])
      .select('id')
      .single();
    if (error) throwSupabaseError(error, 'Falha ao criar pedido de delivery.');

    if (payload.items.length > 0) {
      const { error: itemsError } = await supabase
        .from('DeliveryOrderItem')
        .insert(payload.items.map((item) => ({
          deliveryOrderId: order.id,
          productId: item.productId || null,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          note: item.note || null
        })));
      if (itemsError) throwSupabaseError(itemsError, 'Falha ao salvar itens do pedido.');
    }
    fetch(`${SUPABASE_URL}/functions/v1/whatsapp-notify`, { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, status: 'RECEBIDO' }) }).catch(() => {});
    return { id: order.id };
  },

  listDeliveryOrders: async (status?: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'CAIXA', 'GARCOM', 'COZINHA']);
    let query = supabase
      .from('DeliveryOrder')
      .select('id,customerName,customerPhone,customerAddress,status,paymentMethod,paymentStatus,deliveryFee,total,notes,createdAt,closedAt,cancellationRequestedAt,cancellationReason')
      .eq('companyId', user.companyId)
      // Pedidos com pagamento online pendente ainda não foram confirmados pelo
      // Mercado Pago — não devem aparecer para o estabelecimento até o pagamento ser aprovado.
      .neq('status', 'AGUARDANDO_PAGAMENTO')
      .order('createdAt', { ascending: false });
    if (status === 'all') { /* sem filtro — retorna todos (exceto aguardando pagamento) */ }
    else if (status) query = query.eq('status', status);
    else {
      // Ativos: nem ENTREGUE nem CANCELADO
      query = query.neq('status', 'ENTREGUE').neq('status', 'CANCELADO');
    }

    const { data: orders, error } = await query;
    if (error) throwSupabaseError(error, 'Falha ao carregar pedidos de delivery.');

    if (status !== 'all' && !status) {
      // Busca separada: pedidos com estorno pendente (qualquer status exceto CANCELADO),
      // incluindo ENTREGUE — deve aparecer no painel para o admin aprovar/rejeitar.
      const { data: pendingCancellations } = await supabase
        .from('DeliveryOrder')
        .select('id,customerName,customerPhone,customerAddress,status,paymentMethod,paymentStatus,deliveryFee,total,notes,createdAt,closedAt,cancellationRequestedAt,cancellationReason')
        .eq('companyId', user.companyId)
        .not('cancellationRequestedAt', 'is', null)
        .neq('status', 'CANCELADO')
        .order('createdAt', { ascending: false });

      if (pendingCancellations && pendingCancellations.length > 0) {
        const existingIds = new Set((orders || []).map((o: any) => o.id));
        const extra = pendingCancellations.filter((o: any) => !existingIds.has(o.id));
        const merged = [...(orders || []), ...extra];
        return merged.map((o: any) => ({
          ...o,
          deliveryFee: Number(o.deliveryFee),
          total: Number(o.total),
          items: [],
        }));
      }
    }

    if (!orders || orders.length === 0) return [];

    const { data: items } = await supabase
      .from('DeliveryOrderItem')
      .select('id,deliveryOrderId,productName,quantity,unitPrice,note')
      .in('deliveryOrderId', orders.map((o) => o.id));

    const itemsByOrder: Record<string, any[]> = {};
    (items || []).forEach((item) => {
      itemsByOrder[item.deliveryOrderId] = itemsByOrder[item.deliveryOrderId] || [];
      itemsByOrder[item.deliveryOrderId].push(item);
    });

    return orders.map((o) => ({
      ...o,
      deliveryFee: Number(o.deliveryFee),
      total: Number(o.total),
      items: (itemsByOrder[o.id] || []).map((i) => ({ ...i, unitPrice: Number(i.unitPrice) }))
    }));
  },

  updateDeliveryStatus: async (orderId: string, status: string) => {
    await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'CAIXA', 'GARCOM', 'COZINHA']);

    if (status === 'CANCELADO') {
      // Cancela diretamente no banco (sempre funciona). Se o pedido foi pago online,
      // tenta o estorno via Edge Function em background (não bloqueia o cancel).
      const now = new Date().toISOString();
      const { error: dbError } = await supabase
        .from('DeliveryOrder')
        .update({ status: 'CANCELADO', updatedAt: now, closedAt: now })
        .eq('id', orderId);
      if (dbError) throwSupabaseError(dbError, 'Falha ao cancelar pedido.');
      // Tenta estorno MP em background (não bloqueia)
      supabase.functions.invoke('mercado-pago-refund', {
        body: { deliveryOrderId: orderId, action: 'direct_cancel' },
      }).catch(() => {});
      return { success: true };
    }

    const update: any = { status, updatedAt: new Date().toISOString() };
    if (status === 'ENTREGUE') update.closedAt = new Date().toISOString();
    const { error } = await supabase
      .from('DeliveryOrder')
      .update(update)
      .eq('id', orderId);
    if (error) throwSupabaseError(error, 'Falha ao atualizar status do pedido.');
    fetch(`${SUPABASE_URL}/functions/v1/whatsapp-notify`, { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, status }) }).catch(() => {});
    return { success: true };
  },

  assignDeliveryReceiptNumber: async (orderId: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'CAIXA', 'GARCOM']);

    // Verifica se já tem número atribuído
    const { data: existing } = await supabase
      .from('DeliveryOrder')
      .select('receiptNumber')
      .eq('id', orderId)
      .single();
    if (existing?.receiptNumber) return existing.receiptNumber as number;

    // Incremento atômico via RPC — elimina race condition com mesa/delivery simultâneos
    const { data: next, error: rpcError } = await supabase
      .rpc('next_receipt_number', { p_company_id: user.companyId });
    if (rpcError) throwSupabaseError(rpcError, 'Falha ao gerar número do recibo.');

    const { error } = await supabase
      .from('DeliveryOrder')
      .update({ receiptNumber: next })
      .eq('id', orderId)
      .eq('companyId', user.companyId);
    if (error) throwSupabaseError(error, 'Falha ao salvar número do recibo.');
    return next as number;
  },

  // Retorna pedidos com solicitação de cancelamento pendente (para o painel do restaurante)
  listPendingCancellations: async () => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE', 'CAIXA']);
    const { data, error } = await supabase
      .from('DeliveryOrder')
      .select('id,customerName,customerPhone,total,status,paymentMethod,paymentStatus,cancellationReason,cancellationRequestedAt,createdAt')
      .eq('companyId', user.companyId)
      .not('cancellationRequestedAt', 'is', null)
      .neq('status', 'CANCELADO')
      .order('cancellationRequestedAt', { ascending: true });
    if (error) throwSupabaseError(error, 'Falha ao carregar solicitações de cancelamento.');
    return (data || []).map((o: any) => ({
      ...o,
      total: Number(o.total),
    }));
  },

  approveRefund: async (deliveryOrderId: string): Promise<{ ok: boolean; action: string; warning?: string }> => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mercado-pago-refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ deliveryOrderId, action: 'approve' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Falha ao aprovar estorno.');
    return data;
  },

  rejectRefund: async (deliveryOrderId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mercado-pago-refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ deliveryOrderId, action: 'reject' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Falha ao rejeitar cancelamento.');
    return data;
  },

  // Cancela o pedido no sistema sem chamar a API do MP.
  // Usar quando o estorno automático falha — admin faz o reembolso manualmente no painel MP.
  approveManualRefund: async (deliveryOrderId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mercado-pago-refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ deliveryOrderId, action: 'approve_manual' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Falha ao cancelar pedido.');
    return data;
  },

  // ─────────────────────────────────────────────────────────────────────────

  orders: async (active?: boolean) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'ESTOQUE']);

    let tabIds: string[] = [];
    if (active) {
      const { data: tabs, error: tabsError } = await supabase
        .from('Tab')
        .select('id')
        .eq('companyId', user.companyId)
        .eq('status', 'ABERTA');
      if (tabsError) {
        throwSupabaseError(tabsError, 'Falha ao carregar comandas ativas.');
      }
      tabIds = (tabs || []).map((tab) => tab.id);
    }

    const orderQuery = supabase
      .from('Order')
      .select('id,tabId,status,createdAt,updatedAt')
      .eq('companyId', user.companyId)
      .neq('status', 'CANCELADO')
      .order('createdAt', { ascending: false });

    if (active && tabIds.length > 0) {
      orderQuery.in('tabId', tabIds);
    }

    const { data: orders, error: ordersError } = await orderQuery;
    if (ordersError) {
      throwSupabaseError(ordersError, 'Falha ao carregar pedidos.');
    }

    const orderList = orders || [];
    const orderIds = orderList.map((order) => order.id);
    const tabIdsFromOrders = Array.from(new Set(orderList.map((order) => order.tabId)));

    // Buscar tabs e items em paralelo
    const [{ data: tabs }, { data: items, error: itemsError }] = await Promise.all([
      tabIdsFromOrders.length > 0
        ? supabase.from('Tab').select('id,tableId,status').in('id', tabIdsFromOrders)
        : Promise.resolve({ data: [] as any[] }),
      orderIds.length > 0
        ? supabase.from('OrderItem').select('id,orderId,productId,quantity,unitPrice,note').in('orderId', orderIds)
        : Promise.resolve({ data: [] as any[], error: null })
    ]);
    if (itemsError) {
      throwSupabaseError(itemsError, 'Falha ao carregar itens.');
    }

    const productIds = Array.from(new Set((items || []).map((item) => item.productId)));
    const tableIds = Array.from(new Set((tabs || []).map((tab) => tab.tableId)));

    // Buscar produtos e mesas em paralelo
    const [{ data: products }, { data: tables }] = await Promise.all([
      productIds.length > 0
        ? supabase.from('Product').select('id,name').in('id', productIds)
        : Promise.resolve({ data: [] as any[] }),
      tableIds.length > 0
        ? supabase.from('RestaurantTable').select('id,name').in('id', tableIds)
        : Promise.resolve({ data: [] as any[] })
    ]);

    const productMap = (products || []).reduce((acc, product) => {
      acc[product.id] = product;
      return acc;
    }, {} as Record<string, any>);

    const tabMap = (tabs || []).reduce((acc, tab) => {
      acc[tab.id] = tab;
      return acc;
    }, {} as Record<string, any>);

    const tableMap = (tables || []).reduce((acc, table) => {
      acc[table.id] = table;
      return acc;
    }, {} as Record<string, any>);

    const itemMap = (items || []).reduce((acc, item) => {
      acc[item.orderId] = acc[item.orderId] || [];
      acc[item.orderId].push(item);
      return acc;
    }, {} as Record<string, any[]>);

    return orderList.map((order) => mapOrderResponse(order, tabMap, tableMap, itemMap, productMap));
  },

  createOrder: async (tableId: string, items: Array<{ productId: string; quantity: number; note?: string }>) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GARCOM', 'CAIXA', 'GERENTE', 'ESTOQUE']);
    const { data: table, error: tableError } = await supabase
      .from('RestaurantTable')
      .select('id,companyId')
      .eq('id', tableId)
      .single();
    if (tableError) {
      throwSupabaseError(tableError, 'Falha ao carregar mesa.');
    }
    if (!table || table.companyId !== user.companyId) {
      throw new Error('Mesa nao encontrada.');
    }

    const { data: openTabs, error: tabsError } = await supabase
      .from('Tab')
      .select('id')
      .eq('tableId', tableId)
      .eq('companyId', user.companyId)
      .eq('status', 'ABERTA');
    if (tabsError) {
      throwSupabaseError(tabsError, 'Falha ao carregar comanda.');
    }

    let tabId = openTabs && openTabs.length > 0 ? openTabs[0].id : null;
    if (!tabId) {
      const { data: createdTab, error: createTabError } = await supabase
        .from('Tab')
        .insert([{ companyId: user.companyId, tableId, openedById: user.id, status: 'ABERTA' }])
        .select('id')
        .single();
      if (createTabError) {
        throwSupabaseError(createTabError, 'Falha ao criar comanda.');
      }
      tabId = createdTab.id;
    }

    const productIds = items.map((item) => item.productId);
    const { data: products, error: productsError } = await supabase
      .from('Product')
      .select('id,price,companyId,name')
      .in('id', productIds);
    if (productsError) {
      throwSupabaseError(productsError, 'Falha ao carregar produtos.');
    }

    const productMap = (products || []).reduce((acc, product) => {
      acc[product.id] = product;
      return acc;
    }, {} as Record<string, any>);

    const orderItems = await Promise.all(items.map(async (item) => {
      const product = productMap[item.productId];
      if (!product || product.companyId !== user.companyId) {
        throw new Error('Produto nao encontrado ou pertence a outra empresa.');
      }
      return {
        orderId: '',
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: Number(product.price),
        note: item.note ?? null
      };
    }));

    const { data: createdOrder, error: createOrderError } = await supabase
      .from('Order')
      .insert([{ companyId: user.companyId, tabId, userId: user.id, status: 'ENVIADO', origin: 'mesa', updatedAt: new Date().toISOString() }])
      .select('id,tabId,status,createdAt,updatedAt')
      .single();

    if (createOrderError) {
      throwSupabaseError(createOrderError, 'Falha ao criar pedido.');
    }

    const itemsToInsert = orderItems.map((item) => ({
      ...item,
      orderId: createdOrder.id
    }));
    const { error: createItemsError } = await supabase.from('OrderItem').insert(itemsToInsert);
    if (createItemsError) {
      throwSupabaseError(createItemsError, 'Falha ao criar itens do pedido.');
    }

    await supabase.from('RestaurantTable').update({ status: 'OCUPADA' }).eq('id', tableId);

    const { data: tabInfo, error: tabInfoError } = await supabase.from('Tab').select('id,tableId').eq('id', tabId).single();
    if (tabInfoError) {
      throwSupabaseError(tabInfoError, 'Falha ao carregar comanda.');
    }

    const { data: tableInfo, error: tableInfoError } = await supabase.from('RestaurantTable').select('id,name').eq('id', tabInfo.tableId).single();
    if (tableInfoError) {
      throwSupabaseError(tableInfoError, 'Falha ao carregar mesa.');
    }

    const orderItemsResult = itemsToInsert.map((item) => ({
      id: `${createdOrder.id}-${item.productId}`,
      orderId: createdOrder.id,
      productId: item.productId,
      productName: productMap[item.productId]?.name ?? '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      note: item.note ?? undefined
    }));

    return {
      id: createdOrder.id,
      tableId: tableInfo.id,
      tableName: tableInfo.name,
      status: createdOrder.status,
      createdAt: createdOrder.createdAt,
      updatedAt: createdOrder.updatedAt,
      items: orderItemsResult
    };
  },

  updateOrderStatus: async (orderId: string, status: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'GERENTE', 'COZINHA']);

    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select('id,tabId,companyId,status,createdAt,updatedAt')
      .eq('id', orderId)
      .single();
    if (orderError) {
      throwSupabaseError(orderError, 'Falha ao carregar pedido.');
    }
    if (!order || order.companyId !== user.companyId) {
      throw new Error('Pedido nao encontrado.');
    }

    const { data: updated, error: updateError } = await supabase
      .from('Order')
      .update({ status })
      .eq('id', orderId)
      .select('id,tabId,status,createdAt,updatedAt')
      .single();
    if (updateError) {
      throwSupabaseError(updateError, 'Falha ao atualizar pedido.');
    }

    const { data: tab } = await supabase.from('Tab').select('id,tableId').eq('id', updated.tabId).single();
    const { data: table } = await supabase.from('RestaurantTable').select('id,name').eq('id', tab?.tableId).single();
    const { data: items } = await supabase.from('OrderItem').select('id,orderId,productId,quantity,unitPrice,note').eq('orderId', updated.id);
    const productIds = (items || []).map((item) => item.productId);
    const { data: products } = await supabase.from('Product').select('id,name').in('id', productIds);
    const productMap = (products || []).reduce((acc, product) => {
      acc[product.id] = product;
      return acc;
    }, {} as Record<string, any>);

    const orderItems = (items || []).map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: productMap[item.productId]?.name ?? '',
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      note: item.note ?? undefined
    }));

    return {
      id: updated.id,
      tableId: tab?.tableId ?? '',
      tableName: table?.name ?? '',
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      items: orderItems
    };
  },

  closeTab: async (tabId: string, paymentMethod: string, amountPaid?: number) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'GARCOM']);

    const { data: tab, error: tabError } = await supabase
      .from('Tab')
      .select('id,companyId,tableId,status,openedAt,closedAt,subtotal,total,receiptNumber,receiptGeneratedAt')
      .eq('id', tabId)
      .single();
    if (tabError) {
      throwSupabaseError(tabError, 'Falha ao carregar comanda.');
    }
    if (!tab || tab.status !== 'ABERTA' || tab.companyId !== user.companyId) {
      throw new Error('Comanda não encontrada ou já encerrada.');
    }

    const { data: orderItems, error: orderItemError } = await supabase
      .from('OrderItem')
      .select('quantity,unitPrice')
      .in('orderId', (
        await supabase.from('Order').select('id').eq('tabId', tabId)
      ).data?.map((order) => order.id) ?? []);

    if (orderItemError) {
      throwSupabaseError(orderItemError, 'Falha ao carregar itens do pedido.');
    }

    const subtotal = (orderItems || []).reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
    const total = subtotal;

    const orderIds = (await supabase.from('Order').select('id').eq('tabId', tabId)).data?.map((order) => order.id) ?? [];
    if (orderIds.length > 0) {
      const { error: updateOrdersError } = await supabase
        .from('Order')
        .update({ status: 'ENTREGUE' })
        .not('status', 'eq', 'CANCELADO')
        .in('id', orderIds);
      if (updateOrdersError) {
        throwSupabaseError(updateOrdersError, 'Falha ao atualizar status dos pedidos.');
      }
    }

    const { data: updatedTab, error: updateTabError } = await supabase
      .from('Tab')
      .update({
        status: 'FECHADA',
        closedAt: new Date().toISOString(),
        subtotal: subtotal.toString(),
        total: total.toString()
      })
      .eq('id', tabId)
      .select('id,tableId,status,openedAt,closedAt,subtotal,total,receiptNumber,receiptGeneratedAt')
      .single();
    if (updateTabError) {
      throwSupabaseError(updateTabError, 'Falha ao fechar comanda.');
    }

    // Incremento atômico via RPC — evita duplicata quando mesa e delivery fecham ao mesmo tempo
    const { data: nextReceiptNumber, error: rpcError } = await supabase
      .rpc('next_receipt_number', { p_company_id: user.companyId });
    if (rpcError) throwSupabaseError(rpcError, 'Falha ao gerar numero do recibo.');

    const { data: finalTab, error: finalTabError } = await supabase
      .from('Tab')
      .update({ receiptNumber: nextReceiptNumber, receiptGeneratedAt: new Date().toISOString() })
      .eq('id', tabId)
      .select('id,tableId,status,openedAt,closedAt,subtotal,total,receiptNumber,receiptGeneratedAt')
      .single();
    if (finalTabError) {
      throwSupabaseError(finalTabError, 'Falha ao gerar numero do recibo.');
    }

    const { error: updateTableError } = await supabase
      .from('RestaurantTable')
      .update({ status: 'LIVRE' })
      .eq('id', tab.tableId);
    if (updateTableError) {
      throwSupabaseError(updateTableError, 'Falha ao atualizar mesa.');
    }

    const { data: cashRegister } = await supabase
      .from('CashRegister')
      .select('id')
      .eq('companyId', user.companyId)
      .eq('status', 'ABERTO')
      .maybeSingle();

    if (cashRegister && amountPaid != null) {
      if (paymentMethod === 'PIX') {
        const { data: existingPixPayment, error: existingPixError } = await supabase
          .from('Payment')
          .select('id')
          .eq('tabId', tabId)
          .eq('method', 'PIX')
          .eq('status', 'PENDENTE')
          .order('createdAt', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingPixError) {
          throwSupabaseError(existingPixError, 'Falha ao carregar pagamento PIX.');
        }

        if (existingPixPayment) {
          const { error: paymentUpdateError } = await supabase
            .from('Payment')
            .update({ status: 'PAGO' })
            .eq('id', existingPixPayment.id);
          if (paymentUpdateError) {
            throwSupabaseError(paymentUpdateError, 'Falha ao atualizar pagamento PIX.');
          }
        } else {
          const { error: paymentCreateError } = await supabase.from('Payment').insert([{ tabId, cashRegisterId: cashRegister.id, method: 'PIX', amount: amountPaid.toString(), status: 'PAGO' }]);
          if (paymentCreateError) {
            throwSupabaseError(paymentCreateError, 'Falha ao gerar pagamento PIX.');
          }
        }
      } else {
        const { error: paymentCreateError } = await supabase.from('Payment').insert([{ tabId, cashRegisterId: cashRegister.id, method: paymentMethod || 'DINHEIRO', amount: (amountPaid ?? 0).toString(), status: 'confirmado' }]);
        if (paymentCreateError) {
          throwSupabaseError(paymentCreateError, 'Falha ao registrar pagamento.');
        }
      }
    }

    const { data: tableRow, error: tableRowError } = await supabase.from('RestaurantTable').select('id,name').eq('id', tab.tableId).single();
    if (tableRowError) {
      throwSupabaseError(tableRowError, 'Falha ao carregar mesa.');
    }

    return {
      id: finalTab.id,
      tableId: finalTab.tableId,
      tableName: tableRow.name,
      status: finalTab.status,
      receiptNumber: finalTab.receiptNumber,
      receiptGeneratedAt: formatDate(finalTab.receiptGeneratedAt),
      openedAt: formatDate(finalTab.openedAt),
      closedAt: formatDate(finalTab.closedAt),
      subtotal: Number(finalTab.subtotal),
      total: Number(finalTab.total)
    };
  },

  initiatePixPayment: async (tabId: string, bodyAmount: number) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'GERENTE', 'FINANCEIRO']);
    const { data: tab, error: tabError } = await supabase.from('Tab').select('id,companyId,status').eq('id', tabId).single();
    if (tabError) {
      throwSupabaseError(tabError, 'Falha ao carregar comanda.');
    }
    if (!tab || tab.companyId !== user.companyId || tab.status !== 'ABERTA') {
      throw new Error('Comanda não encontrada ou já encerrada.');
    }

    const { data: cashRegister, error: cashError } = await supabase
      .from('CashRegister')
      .select('id')
      .eq('companyId', user.companyId)
      .eq('status', 'ABERTO')
      .maybeSingle();
    if (cashError) {
      throwSupabaseError(cashError, 'Falha ao carregar caixa.');
    }

    let cashRegisterId = cashRegister?.id;
    if (!cashRegisterId) {
      const { data: newCashRegister, error: createCashError } = await supabase
        .from('CashRegister')
        .insert([{ companyId: user.companyId, openedById: user.id, initialAmount: 0, status: 'ABERTO' }])
        .select('id')
        .single();
      if (createCashError) {
        throwSupabaseError(createCashError, 'Falha ao abrir caixa.');
      }
      cashRegisterId = newCashRegister.id;
    }

    const { data: existingPix, error: existingPixError } = await supabase
      .from('Payment')
      .select('id,method,status,amount')
      .eq('tabId', tabId)
      .eq('method', 'PIX')
      .eq('status', 'PENDENTE')
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPixError) {
      throwSupabaseError(existingPixError, 'Falha ao carregar pagamento PIX.');
    }

    if (existingPix) {
      return { paymentId: existingPix.id, status: existingPix.status, amount: Number(existingPix.amount) };
    }

    const { data: payment, error: paymentError } = await supabase
      .from('Payment')
      .insert([{ tabId, cashRegisterId, method: 'PIX', amount: bodyAmount.toString(), status: 'PENDENTE' }])
      .select('id,method,status,amount')
      .single();

    if (paymentError) {
      throwSupabaseError(paymentError, 'Falha ao criar pagamento PIX.');
    }

    return { paymentId: payment.id, status: payment.status, amount: Number(payment.amount) };
  },

  getPixPaymentStatus: async (tabId: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'GERENTE', 'FINANCEIRO']);
    const { data: tab, error: tabError } = await supabase.from('Tab').select('id,companyId').eq('id', tabId).single();
    if (tabError) {
      throwSupabaseError(tabError, 'Falha ao carregar comanda.');
    }
    if (!tab || tab.companyId !== user.companyId) {
      throw new Error('Comanda não encontrada.');
    }

    const { data: payment, error: paymentError } = await supabase
      .from('Payment')
      .select('id,method,status,amount')
      .eq('tabId', tabId)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError) {
      throwSupabaseError(paymentError, 'Falha ao carregar pagamento PIX.');
    }
    if (!payment) {
      return { status: 'NONE' };
    }
    return { status: payment.status, paymentId: payment.id, amount: Number(payment.amount) };
  },

  confirmPixPayment: async (tabId: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'GERENTE', 'FINANCEIRO']);
    const { data: tab, error: tabError } = await supabase.from('Tab').select('id,companyId').eq('id', tabId).single();
    if (tabError) {
      throwSupabaseError(tabError, 'Falha ao carregar comanda.');
    }
    if (!tab || tab.companyId !== user.companyId) {
      throw new Error('Comanda não encontrada.');
    }

    const { data: payment, error: paymentError } = await supabase
      .from('Payment')
      .select('id,tabId,amount,status')
      .eq('tabId', tabId)
      .eq('method', 'PIX')
      .eq('status', 'PENDENTE')
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError) {
      throwSupabaseError(paymentError, 'Falha ao carregar pagamento PIX.');
    }
    if (!payment) {
      throw new Error('Pagamento PIX pendente não encontrado.');
    }

    const { error: updateError } = await supabase
      .from('Payment')
      .update({ status: 'PAGO' })
      .eq('id', payment.id);
    if (updateError) {
      throwSupabaseError(updateError, 'Falha ao confirmar pagamento PIX.');
    }

    return { status: 'PAGO', paymentId: payment.id, amount: Number(payment.amount) };
  },

  listDailyReceipts: async (dateStr?: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'GERENTE', 'FINANCEIRO']);
    const today = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [tabResult, deliveryResult] = await Promise.all([
      supabase
        .from('Tab')
        .select('id,receiptNumber,tableId,subtotal,total,closedAt,receiptGeneratedAt')
        .eq('companyId', user.companyId)
        .eq('status', 'FECHADA')
        .gte('receiptGeneratedAt', today.toISOString())
        .lt('receiptGeneratedAt', tomorrow.toISOString())
        .order('receiptGeneratedAt', { ascending: true }),
      // Inclui pedidos pagos normais + cancelados/estornados (para exibir nos recibos com badge)
      supabase
        .from('DeliveryOrder')
        .select('id,customerName,total,deliveryFee,paymentMethod,status,paymentStatus,createdAt,receiptNumber')
        .eq('companyId', user.companyId)
        .in('paymentStatus', ['PAGO', 'ESTORNADO'])
        .gte('createdAt', today.toISOString())
        .lt('createdAt', tomorrow.toISOString())
        .order('createdAt', { ascending: true }),
    ]);

    if (tabResult.error) throwSupabaseError(tabResult.error, 'Falha ao carregar recibos.');

    const tableIds = (tabResult.data || []).map((r) => r.tableId);
    const { data: tables } = tableIds.length > 0
      ? await supabase.from('RestaurantTable').select('id,name').in('id', tableIds)
      : { data: [] as any[] };
    const tableMap = (tables || []).reduce((acc: any, t: any) => { acc[t.id] = t; return acc; }, {});

    const mesaReceipts = (tabResult.data || []).map((receipt) => ({
      id: receipt.id,
      type: 'mesa' as const,
      receiptNumber: receipt.receiptNumber,
      tableName: tableMap[receipt.tableId]?.name ?? '',
      subtotal: Number(receipt.subtotal),
      total: Number(receipt.total),
      closedAt: formatDate(receipt.closedAt),
      receiptGeneratedAt: formatDate(receipt.receiptGeneratedAt),
    }));

    const deliveryReceipts = (deliveryResult.data || []).map((d: any) => ({
      id: d.id,
      type: 'delivery' as const,
      receiptNumber: d.receiptNumber ?? null,
      tableName: `Delivery – ${d.customerName}`,
      subtotal: Number(d.total) - Number(d.deliveryFee || 0),
      total: Number(d.total),
      closedAt: formatDate(d.createdAt),
      receiptGeneratedAt: formatDate(d.createdAt),
      paymentMethod: d.paymentMethod,
      status: d.status,
      paymentStatus: d.paymentStatus,
    }));

    return [...mesaReceipts, ...deliveryReceipts].sort((a, b) =>
      new Date(a.receiptGeneratedAt).getTime() - new Date(b.receiptGeneratedAt).getTime()
    );
  },

  getReceiptByNumber: async (receiptNumber: number) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'GERENTE', 'FINANCEIRO']);

    // Busca em Tab (mesas) primeiro
    const { data: tab } = await supabase
      .from('Tab')
      .select('id,receiptNumber,tableId,subtotal,total,closedAt,receiptGeneratedAt')
      .eq('companyId', user.companyId)
      .eq('receiptNumber', receiptNumber)
      .maybeSingle();

    if (tab) {
      const { data: table } = await supabase.from('RestaurantTable').select('name').eq('id', tab.tableId).maybeSingle();
      const { data: orders } = await supabase.from('Order').select('id,status').eq('tabId', tab.id);
      const orderIds = (orders || []).map((o) => o.id);
      const { data: items } = orderIds.length > 0
        ? await supabase.from('OrderItem').select('id,orderId,productId,quantity,unitPrice').in('orderId', orderIds)
        : { data: [] as any[] };
      const productIds = (items || []).map((i) => i.productId);
      const { data: products } = productIds.length > 0
        ? await supabase.from('Product').select('id,name').in('id', productIds)
        : { data: [] as any[] };
      const productMap = (products || []).reduce((acc, p) => { acc[p.id] = p; return acc; }, {} as Record<string, any>);
      const itemsByOrder = (items || []).reduce((acc, i) => { acc[i.orderId] = acc[i.orderId] || []; acc[i.orderId].push(i); return acc; }, {} as Record<string, any[]>);
      return {
        id: tab.id, receiptNumber: tab.receiptNumber, tableName: table?.name ?? '—',
        subtotal: Number(tab.subtotal), total: Number(tab.total),
        closedAt: formatDate(tab.closedAt), receiptGeneratedAt: formatDate(tab.receiptGeneratedAt),
        orders: (orders || []).map((order) => ({
          id: order.id, status: order.status,
          items: (itemsByOrder[order.id] || []).map((item) => ({
            id: item.id, productName: productMap[item.productId]?.name ?? '',
            quantity: item.quantity, unitPrice: Number(item.unitPrice), total: Number(item.unitPrice) * item.quantity,
          })),
        })),
      };
    }

    // Busca em DeliveryOrder se não encontrado em Tab
    const { data: dlv } = await supabase
      .from('DeliveryOrder')
      .select('id,receiptNumber,customerName,total,status,paymentMethod,createdAt')
      .eq('companyId', user.companyId)
      .eq('receiptNumber', receiptNumber)
      .maybeSingle();

    if (dlv) {
      const { data: dlvItems } = await supabase
        .from('DeliveryOrderItem')
        .select('id,productName,quantity,unitPrice')
        .eq('deliveryOrderId', dlv.id);
      const items = (dlvItems || []).map((i) => ({
        id: i.id, productName: i.productName, quantity: i.quantity,
        unitPrice: Number(i.unitPrice), total: Number(i.unitPrice) * i.quantity,
      }));
      return {
        id: dlv.id, receiptNumber: dlv.receiptNumber,
        tableName: `Delivery – ${dlv.customerName}`,
        subtotal: Number(dlv.total), total: Number(dlv.total),
        closedAt: null, receiptGeneratedAt: formatDate(dlv.createdAt),
        orders: [{ id: dlv.id, status: dlv.status, items }],
      };
    }

    throw new Error('Recibo não encontrado.');
  },

  kitchenQueue: async () => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'COZINHA', 'CAIXA', 'GERENTE', 'FINANCEIRO']);
    const { data: orders, error } = await supabase
      .from('Order')
      .select('id,tabId,status,createdAt,updatedAt')
      .eq('companyId', user.companyId)
      .in('status', ['ENVIADO', 'EM_PREPARO', 'PRONTO'])
      .order('createdAt', { ascending: false });
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar pedidos da cozinha.');
    }

    const orderList = orders || [];
    const orderIds = orderList.map((order) => order.id);
    const tabIds = Array.from(new Set(orderList.map((order) => order.tabId)));
    const { data: tabs } = tabIds.length > 0
      ? await supabase.from('Tab').select('id,tableId').in('id', tabIds)
      : { data: [] as any[] };
    const tableIds = Array.from(new Set((tabs || []).map((tab) => tab.tableId)));
    const [{ data: tables }, { data: items }] = await Promise.all([
      tableIds.length > 0 ? supabase.from('RestaurantTable').select('id,name').in('id', tableIds) : Promise.resolve({ data: [] as any[] }),
      orderIds.length > 0 ? supabase.from('OrderItem').select('id,orderId,productId,quantity,unitPrice,note').in('orderId', orderIds) : Promise.resolve({ data: [] as any[] })
    ]);

    const tableMap = (tables || []).reduce((acc, table) => { acc[table.id] = table; return acc; }, {} as Record<string, any>);
    const tabMap = (tabs || []).reduce((acc, tab) => { acc[tab.id] = tab; return acc; }, {} as Record<string, any>);
    const productIds = (items || []).map((item) => item.productId);
    const { data: productRows, error: productError } = await supabase.from('Product').select('id,name').in('id', productIds);
    if (productError) {
      throwSupabaseError(productError, 'Falha ao carregar produtos.');
    }
    const productMap = (productRows || []).reduce((acc, product) => { acc[product.id] = product; return acc; }, {} as Record<string, any>);
    const itemsByOrder = (items || []).reduce((acc, item) => {
      acc[item.orderId] = acc[item.orderId] || [];
      acc[item.orderId].push(item);
      return acc;
    }, {} as Record<string, any[]>);

    return orderList.map((order) => ({
      id: order.id,
      tableId: tabMap[order.tabId]?.tableId ?? '',
      tableName: tableMap[tabMap[order.tabId]?.tableId]?.name ?? '',
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: (itemsByOrder[order.id] || []).map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: productMap[item.productId]?.name ?? '',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        note: item.note ?? undefined
      }))
    }));
  },

  // Lightweight check available to any company user (e.g. waiters) — used to
  // gate table/order access until the cashier opens the register for the day.
  isCashRegisterOpen: async () => {
    const user = await requireCompanyUser();
    const { data, error } = await supabase
      .from('CashRegister')
      .select('id')
      .eq('companyId', user.companyId)
      .eq('status', 'ABERTO')
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Falha ao verificar status do caixa.');
    return !!data;
  },

  cashRegisterCurrent: async () => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'FINANCEIRO', 'GERENTE']);
    const { data: cashRegister, error } = await supabase
      .from('CashRegister')
      .select('id,openedById,closedById,openedAt,closedAt,initialAmount,closingAmount,status')
      .eq('companyId', user.companyId)
      .eq('status', 'ABERTO')
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Falha ao carregar caixa.');
    if (!cashRegister) {
      return null;
    }

    const userIds = [cashRegister.openedById, cashRegister.closedById].filter(Boolean) as string[];
    const { data: users, error: usersError } = await supabase.from('User').select('id,name').in('id', userIds);
    if (usersError) {
      throwSupabaseError(usersError, 'Falha ao carregar usuários do caixa.');
    }
    const userMap = (users || []).reduce((acc, u) => { acc[u.id] = u; return acc; }, {} as Record<string, any>);

    const { data: payments, error: paymentsError } = await supabase.from('Payment').select('amount').eq('cashRegisterId', cashRegister.id);
    if (paymentsError) {
      throwSupabaseError(paymentsError, 'Falha ao carregar pagamentos do caixa.');
    }

    const totalPayments = (payments || []).reduce((sum, payment) => sum + Number(payment.amount), 0);

    return {
      id: cashRegister.id,
      status: cashRegister.status,
      openedAt: formatDate(cashRegister.openedAt),
      closedAt: formatDate(cashRegister.closedAt),
      initialAmount: Number(cashRegister.initialAmount),
      closingAmount: cashRegister.closingAmount != null ? Number(cashRegister.closingAmount) : null,
      openedBy: userMap[cashRegister.openedById]?.name ?? null,
      closedBy: cashRegister.closedById ? userMap[cashRegister.closedById]?.name ?? null : null,
      paymentsCount: payments?.length ?? 0,
      totalPayments
    };
  },

  openCashRegister: async (initialAmount: number) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'FINANCEIRO', 'GERENTE']);
    const { data: existing, error: existingError } = await supabase
      .from('CashRegister')
      .select('id,openedById,openedAt,initialAmount,status')
      .eq('companyId', user.companyId)
      .eq('status', 'ABERTO')
      .maybeSingle();
    if (existingError) {
      throwSupabaseError(existingError, 'Falha ao carregar caixa.');
    }
    if (existing) {
      const { data: openedBy, error: userError } = await supabase.from('User').select('name').eq('id', existing.openedById).single();
      if (userError) {
        throwSupabaseError(userError, 'Falha ao carregar usuário do caixa.');
      }
      return {
        id: existing.id,
        status: existing.status,
        openedAt: formatDate(existing.openedAt),
        closedAt: null,
        initialAmount: Number(existing.initialAmount),
        closingAmount: null,
        openedBy: openedBy.name,
        closedBy: null,
        paymentsCount: 0,
        totalPayments: 0
      };
    }

    const { data: cashRegister, error: createError } = await supabase
      .from('CashRegister')
      .insert([{ companyId: user.companyId, openedById: user.id, initialAmount: initialAmount, status: 'ABERTO' }])
      .select('id,openedById,openedAt,initialAmount,status')
      .single();
    if (createError) {
      throwSupabaseError(createError, 'Falha ao abrir caixa.');
    }

    const { data: openedBy, error: userError } = await supabase.from('User').select('name').eq('id', cashRegister.openedById).single();
    if (userError) {
      throwSupabaseError(userError, 'Falha ao carregar usuário do caixa.');
    }

    return {
      id: cashRegister.id,
      status: cashRegister.status,
      openedAt: formatDate(cashRegister.openedAt),
      closedAt: null,
      initialAmount: Number(cashRegister.initialAmount),
      closingAmount: null,
      openedBy: openedBy.name,
      closedBy: null,
      paymentsCount: 0,
      totalPayments: 0
    };
  },

  closeCashRegister: async (closingAmount: number) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'FINANCEIRO', 'GERENTE']);
    const { data: cashRegister, error } = await supabase
      .from('CashRegister')
      .select('id,openedById,openedAt,initialAmount,status')
      .eq('companyId', user.companyId)
      .eq('status', 'ABERTO')
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Falha ao carregar caixa.');
    if (!cashRegister) {
      return { error: 'Nenhum caixa aberto.' };
    }

    const { error: updateError } = await supabase
      .from('CashRegister')
      .update({ status: 'FECHADO', closedAt: new Date().toISOString(), closedById: user.id, closingAmount })
      .eq('id', cashRegister.id);
    if (updateError) {
      throwSupabaseError(updateError, 'Falha ao fechar caixa.');
    }

    const { data: payments, error: paymentsError } = await supabase.from('Payment').select('amount').eq('cashRegisterId', cashRegister.id);
    if (paymentsError) {
      throwSupabaseError(paymentsError, 'Falha ao carregar pagamentos do caixa.');
    }

    const { data: openedBy, error: userError } = await supabase.from('User').select('name').eq('id', cashRegister.openedById).single();
    if (userError) {
      throwSupabaseError(userError, 'Falha ao carregar usuário do caixa.');
    }

    return {
      id: cashRegister.id,
      status: 'FECHADO',
      openedAt: formatDate(cashRegister.openedAt),
      closedAt: new Date().toISOString(),
      initialAmount: Number(cashRegister.initialAmount),
      closingAmount,
      openedBy: openedBy.name,
      closedBy: user.name,
      paymentsCount: payments?.length ?? 0,
      totalPayments: (payments || []).reduce((sum, payment) => sum + Number(payment.amount), 0)
    };
  },

  createCompany: async (payload: any) => {
    const user = await requireSuperUser();
    if (!payload?.name || !payload?.cnpj || !payload?.email || !payload?.adminName || !payload?.adminEmail || !payload?.adminPassword) {
      throw new Error('Dados incompletos.');
    }
    if (payload.adminPassword.length < 6) {
      throw new Error('Senha do administrador deve ter pelo menos 6 caracteres.');
    }

    // Verificar se email do admin já existe
    const { data: existingAdmin } = await supabase.from('User').select('id').eq('email', payload.adminEmail).maybeSingle();
    if (existingAdmin) throw new Error('Email do administrador já cadastrado.');

    // Verificar se CNPJ ou email já existem antes de inserir
    const { data: existing } = await supabase
      .from('Company')
      .select('id,cnpj,email')
      .or(`cnpj.eq.${payload.cnpj},email.eq.${payload.email}`)
      .maybeSingle();
    if (existing) {
      if (existing.cnpj === payload.cnpj) throw new Error('CNPJ já cadastrado.');
      throw new Error('Email da empresa já cadastrado.');
    }

    const { data: company, error: companyError } = await supabase
      .from('Company')
      .insert([{
        name: payload.name,
        cnpj: payload.cnpj,
        email: payload.email,
        phone: payload.phone ?? null,
        address: payload.address ?? null,
        city: payload.city ?? null,
        state: payload.state ?? null,
        country: payload.country ?? 'BR',
        pixKey: payload.pixKey ?? null,
        active: true,
        updatedAt: new Date().toISOString()
      }])
      .select('id,name,email,cnpj,phone,address,city,state,country,pixKey,active')
      .single();
    if (companyError) {
      if (companyError.code === '23505') throw new Error('CNPJ ou email da empresa já cadastrado.');
      throwSupabaseError(companyError, 'Falha ao criar empresa.');
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + (Number(payload.months ?? 1) || 1));
    const { data: subscription, error: subscriptionError } = await supabase
      .from('Subscription')
      .insert([{
        companyId: company.id,
        status: 'ATIVO',
        monthlyFee: Number(payload.monthlyFee ?? 0),
        expiresAt: expiresAt.toISOString(),
        lastRenewed: now.toISOString(),
        updatedAt: now.toISOString()
      }])
      .select('id,status,monthlyFee,expiresAt,lastRenewed');
    if (subscriptionError) {
      throwSupabaseError(subscriptionError, 'Falha ao criar assinatura.');
    }

    const tableCount = Number.isInteger(Number(payload.tableCount)) && Number(payload.tableCount) > 0 ? Number(payload.tableCount) : 10;
    const tableRows = Array.from({ length: tableCount }, (_, index) => ({
      companyId: company.id,
      number: index + 1,
      name: `Mesa ${index + 1}`,
      capacity: 4
    }));
    const { error: tablesError } = await supabase.from('RestaurantTable').insert(tableRows);
    if (tablesError) {
      throwSupabaseError(tablesError, 'Falha ao criar mesas da empresa.');
    }

    const { error: categoryError } = await supabase.from('Category').insert([{
      companyId: company.id,
      name: 'Sem categoria',
      sort: 0,
      active: true
    }]);
    if (categoryError) {
      throwSupabaseError(categoryError, 'Falha ao criar categoria inicial.');
    }

    const adminUser = await createAuthUser(payload.adminEmail, payload.adminPassword, {
      name: payload.adminName,
      role: 'ADMIN',
      companyId: company.id
    });

    const { error: userRowError } = await supabase.from('User').insert([{
      id: adminUser.id,
      name: payload.adminName,
      email: payload.adminEmail,
      passwordHash: 'supabase-auth',
      role: 'ADMIN',
      active: true,
      companyId: company.id,
      mustChangePassword: false,
      updatedAt: new Date().toISOString()
    }]);
    if (userRowError) {
      throwSupabaseError(userRowError, 'Falha ao criar registro interno de usuário.');
    }

    if (payload.deliveryFeePercent != null) {
      const { error: feeError } = await supabase.rpc('set_company_delivery_fee', {
        p_company_id: company.id,
        p_percent: Number(payload.deliveryFeePercent) || 0
      });
      if (feeError) console.error('Falha ao definir comissão de delivery na criação da empresa', feeError);
    }

    return { success: true, company, admin: { id: adminUser.id, email: adminUser.email } };
  },

  listCompanies: async () => {
    await requireSuperUser();
    const { data: companies, error: companiesError } = await supabase
      .from('Company')
      .select('id,name,email,cnpj,active,menuOpenCount,plan,planMonthlyPrice,trialEndsAt')
      .order('name', { ascending: true });
    if (companiesError) {
      throwSupabaseError(companiesError, 'Falha ao carregar empresas.');
    }

    const companyIds = (companies || []).map((company) => company.id);

    const [subscriptionsResult, paymentsResult, walletsResult] = companyIds.length > 0
      ? await Promise.all([
          supabase.from('Subscription').select('companyId,status,monthlyFee,expiresAt,lastRenewed').in('companyId', companyIds),
          supabase.from('PaymentRecord').select('companyId,id,amount,status,dueDate,paidAt,renewalDate').in('companyId', companyIds),
          supabase.from('Wallet').select('companyId,balance,deliveryFeePercent').in('companyId', companyIds)
        ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

    if (subscriptionsResult.error) throwSupabaseError(subscriptionsResult.error, 'Falha ao carregar assinaturas.');
    if (paymentsResult.error) throwSupabaseError(paymentsResult.error, 'Falha ao carregar pagamentos.');

    const subscriptions = subscriptionsResult.data || [];
    const payments = paymentsResult.data || [];
    const wallets = walletsResult.data || [];

    const paymentsByCompany = (payments || []).reduce((acc, payment) => {
      acc[payment.companyId] = acc[payment.companyId] || [];
      acc[payment.companyId].push(payment);
      return acc;
    }, {} as Record<string, any[]>);

    const subscriptionByCompany = (subscriptions || []).reduce((acc, subscription) => {
      acc[subscription.companyId] = subscription;
      return acc;
    }, {} as Record<string, any>);

    const walletByCompany = (wallets || []).reduce((acc, wallet: any) => {
      acc[wallet.companyId] = wallet;
      return acc;
    }, {} as Record<string, any>);

    return (companies || []).map((company) => {
      const subscription = subscriptionByCompany[company.id];
      const wallet = walletByCompany[company.id];
      return {
        id: company.id,
        name: company.name,
        email: company.email,
        cnpj: company.cnpj,
        active: company.active,
        monthlyFee: subscription ? Number(subscription.monthlyFee) : 0,
        subscriptionStatus: subscription?.status ?? null,
        expiresAt: subscription?.expiresAt ?? null,
        lastRenewed: subscription?.lastRenewed ?? null,
        payments: paymentsByCompany[company.id] ?? [],
        walletBalance: wallet ? Number(wallet.balance) : 0,
        deliveryFeePercent: wallet ? Number(wallet.deliveryFeePercent) : 0,
        menuOpenCount: Number(company.menuOpenCount ?? 0),
        plan: (company.plan ?? 'STARTER') as 'STARTER' | 'TRIAL' | 'PRO' | 'ENTERPRISE',
        planMonthlyPrice: Number(company.planMonthlyPrice ?? 0),
        trialEndsAt: company.trialEndsAt ?? null,
      };
    });
  },

  setCompanyPlan: async (companyId: string, plan: 'STARTER' | 'TRIAL' | 'PRO' | 'ENTERPRISE', trialDays?: number, monthlyPrice?: number) => {
    await requireSuperUser();
    const { data, error } = await supabase.rpc('set_company_plan', {
      p_company_id:    companyId,
      p_plan:          plan,
      p_trial_days:    trialDays ?? null,
      p_monthly_price: monthlyPrice ?? null,
    });
    if (error) throwSupabaseError(error, 'Falha ao alterar plano.');
    if (data?.error) throw new Error(data.error);
    return data as { ok: boolean; plan: string };
  },

  createMpSubscription: async (companyId: string, plan: 'STARTER' | 'PRO', backUrl: string) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mercado-pago-subscription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companyId, plan, backUrl }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Falha ao criar assinatura.');
    return data as { initPoint: string; subscriptionId: string; existing?: boolean };
  },

  cancelMpSubscription: async (companyId: string) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mercado-pago-subscription`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companyId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Falha ao cancelar assinatura.');
    return data as { ok: boolean };
  },

  updateCompanyAsSuperAdmin: async (companyId: string, payload: { name?: string; email?: string; phone?: string; address?: string; monthlyFee?: number; deliveryFeePercent?: number }) => {
    await requireSuperUser();
    const updates: any = {};
    if (payload.name != null) updates.name = payload.name;
    if (payload.email != null) updates.email = payload.email;
    if (payload.phone != null) updates.phone = payload.phone;
    if (payload.address != null) updates.address = payload.address;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('Company').update(updates).eq('id', companyId);
      if (error) throwSupabaseError(error, 'Falha ao atualizar empresa.');
    }

    if (payload.monthlyFee != null) {
      const { error } = await supabase
        .from('Subscription')
        .update({ monthlyFee: payload.monthlyFee })
        .eq('companyId', companyId);
      if (error) throwSupabaseError(error, 'Falha ao atualizar mensalidade.');
    }

    if (payload.deliveryFeePercent != null) {
      const { error } = await supabase.rpc('set_company_delivery_fee', {
        p_company_id: companyId,
        p_percent: payload.deliveryFeePercent
      });
      if (error) throwSupabaseError(error, 'Falha ao atualizar comissão de delivery.');
    }

    return { success: true };
  },

  // --- Mercado Pago integration ---
  // Todos os pagamentos online (Pix de mesa/comanda e delivery) são
  // processados pela conta master da plataforma (configurada via secret
  // MP_MASTER_ACCESS_TOKEN nas Edge Functions) — não há mais conexão
  // individual por empresa. Ver bloco `wallet` para o saldo/comissão.

  createMercadoPagoPixCharge: async (payload: { tabId?: string; deliveryOrderId?: string; amount: number; description?: string; payerEmail?: string }) => {
    await requireCompanyUser();
    const { data, error } = await supabase.functions.invoke('mercado-pago-pix', { body: payload });
    if (error) {
      const message = (error as any)?.context?.error || (error as any)?.message || 'Falha ao gerar cobrança Pix via Mercado Pago.';
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data as { mpPaymentId: string; status: string; qrCode: string | null; qrCodeBase64: string | null; ticketUrl: string | null };
  },

  getMercadoPagoPaymentStatus: async (mpPaymentId: string) => {
    await requireCompanyUser();
    const { data, error } = await supabase
      .from('MercadoPagoPayment')
      .select('mpPaymentId,status,paidAt')
      .eq('mpPaymentId', mpPaymentId)
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Falha ao consultar status do pagamento.');
    return data ?? null;
  },

  getMyCompanyTableCount: async () => {
    const user = await requireCompanyUser();
    const { count, error } = await supabase
      .from('RestaurantTable')
      .select('id', { count: 'exact', head: true })
      .eq('companyId', user.companyId);
    if (error) throwSupabaseError(error, 'Falha ao contar mesas da empresa.');
    return count ?? 0;
  },

  // Adjusts the number of tables for the current user's company up or down to match `tableCount`.
  // Available to ADMIN/GERENTE (store owners/managers) for self-service from "Ajustes".
  // When increasing, appends new numbered tables after the current highest number.
  // When decreasing, removes the highest-numbered EMPTY tables first (never deletes occupied ones).
  setMyCompanyTableCount: async (tableCount: number) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'GERENTE']);
    const companyId = user.companyId;
    const target = Math.max(0, Math.floor(Number(tableCount) || 0));

    const { data: tables, error: fetchError } = await supabase
      .from('RestaurantTable')
      .select('id,number,status')
      .eq('companyId', companyId)
      .order('number', { ascending: true });
    if (fetchError) throwSupabaseError(fetchError, 'Falha ao carregar mesas da empresa.');

    const current = tables ?? [];
    const currentCount = current.length;

    if (target === currentCount) {
      return { success: true, added: 0, removed: 0, total: currentCount };
    }

    if (target > currentCount) {
      const highest = current.reduce((max, t: any) => Math.max(max, Number(t.number) || 0), 0);
      const toAdd = target - currentCount;
      const newRows = Array.from({ length: toAdd }, (_, index) => ({
        companyId,
        number: highest + index + 1,
        name: `Mesa ${highest + index + 1}`,
        capacity: 4
      }));
      const { error: insertError } = await supabase.from('RestaurantTable').insert(newRows);
      if (insertError) throwSupabaseError(insertError, 'Falha ao adicionar mesas.');
      return { success: true, added: toAdd, removed: 0, total: target };
    }

    // target < currentCount: remove highest-numbered tables that are not occupied
    const toRemove = currentCount - target;
    const removable = [...current]
      .filter((t: any) => String(t.status ?? '').toUpperCase() !== 'OCUPADA')
      .sort((a: any, b: any) => (Number(b.number) || 0) - (Number(a.number) || 0))
      .slice(0, toRemove);

    if (removable.length < toRemove) {
      throw new Error(`Não é possível remover ${toRemove} mesa(s): existem mesas ocupadas entre as que seriam removidas. Libere-as antes de diminuir a quantidade.`);
    }

    const idsToRemove = removable.map((t: any) => t.id);
    const { error: deleteError } = await supabase.from('RestaurantTable').delete().in('id', idsToRemove);
    if (deleteError) throwSupabaseError(deleteError, 'Falha ao remover mesas.');
    return { success: true, added: 0, removed: idsToRemove.length, total: target };
  },

  suspendCompany: async (companyId: string) => {
    await requireSuperUser();
    const { error } = await supabase.from('Company').update({ active: false }).eq('id', companyId);
    if (error) {
      throwSupabaseError(error, 'Falha ao suspender empresa.');
    }
    return { success: true };
  },

  reactivateCompany: async (companyId: string) => {
    await requireSuperUser();
    const { error } = await supabase.from('Company').update({ active: true }).eq('id', companyId);
    if (error) {
      throwSupabaseError(error, 'Falha ao reativar empresa.');
    }
    return { success: true };
  },

  suspendUser: async (userId: string) => {
    await requireSuperUser();
    const { error } = await supabase.from('User').update({ active: false }).eq('id', userId);
    if (error) {
      throwSupabaseError(error, 'Falha ao suspender usuario.');
    }
    return { success: true };
  },

  reactivateUser: async (userId: string) => {
    await requireSuperUser();
    const { error } = await supabase.from('User').update({ active: true }).eq('id', userId);
    if (error) {
      throwSupabaseError(error, 'Falha ao reativar usuario.');
    }
    return { success: true };
  },

  deleteCompany: async (companyId: string) => {
    await requireSuperUser();

    // Busca todos os usuários da empresa para remover do Supabase Auth
    const { data: users } = await supabase.from('User').select('id').eq('companyId', companyId);
    if (users && users.length > 0 && SUPABASE_SERVICE_KEY) {
      await Promise.all(users.map(async (u) => {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey': SUPABASE_SERVICE_KEY
          }
        });
      }));
    }

    const { error } = await supabase.from('Company').delete().eq('id', companyId);
    if (error) {
      throwSupabaseError(error, 'Falha ao excluir empresa.');
    }
    return { success: true };
  },

  deleteUser: async (userId: string) => {
    await requireSuperUser();
    const targetUser = await getUserRowById(userId);
    if (!targetUser) {
      throw new Error('Usuario nao encontrado.');
    }
    if (targetUser.role === 'SUPER') {
      throw new Error('Nao é permitido deletar super usuario.');
    }

    const { error } = await supabase.from('User').update({ active: false }).eq('id', userId);
    if (error) {
      throwSupabaseError(error, 'Falha ao deletar usuario.');
    }
    return { success: true };
  },

  listUsers: async (companyId?: string) => {
    const currentUser = await loadCurrentUser();
    const query = supabase.from('User').select('id,name,email,role,active,companyId,passwordHash,mustChangePassword');
    if (currentUser.role !== 'SUPER') {
      if (!currentUser.companyId) {
        throw new Error('Usuario sem empresa associada.');
      }
      query.eq('companyId', currentUser.companyId);
    } else if (companyId) {
      query.eq('companyId', companyId);
    }
    const { data, error } = await query;
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar usuarios.');
    }
    return data || [];
  },

  createCompanyUser: async (payload: { name: string; email: string; password: string; role?: string; active?: boolean; companyId?: string }) => {
    const currentUser = await loadCurrentUser();
    const isSuper = currentUser.role === 'SUPER';
    if (!payload.name || !payload.email || !payload.password) {
      throw new Error('Dados incompletos.');
    }
    let companyId = currentUser.companyId;
    if (isSuper) {
      companyId = payload.companyId;
      if (!companyId) {
        throw new Error('companyId é necessário para criar usuário como SUPER.');
      }
    }
    if (!companyId) {
      throw new Error('Usuario sem empresa associada.');
    }

    const { data: existing } = await supabase.from('User').select('id').eq('email', payload.email).maybeSingle();
    if (existing) {
      throw new Error('Usuario ja existe.');
    }

    const validRoles = ['ADMIN', 'GERENTE', 'CAIXA', 'GARCOM', 'COZINHA', 'ESTOQUE', 'FINANCEIRO'];
    const role = payload.role && validRoles.includes(payload.role) ? payload.role : 'CAIXA';

    const newAuthUser = await createAuthUser(payload.email, payload.password, { name: payload.name, role, companyId });

    const { error: insertError } = await supabase.from('User').insert([{
      id: newAuthUser.id,
      name: payload.name.trim(),
      email: payload.email.trim(),
      passwordHash: 'supabase-auth',
      role,
      active: payload.active ?? true,
      companyId,
      updatedAt: new Date().toISOString()
    }]);
    if (insertError) {
      throwSupabaseError(insertError, 'Falha ao criar registro interno de usuário.');
    }

    return {
      id: newAuthUser.id,
      name: payload.name,
      email: payload.email,
      role,
      active: payload.active ?? true,
      companyId
    };
  },

  updateUser: async (userId: string, payload: any) => {
    await requireSuperUser();
    const data: any = {};
    if (payload.name != null) data.name = payload.name;
    if (payload.email != null) data.email = payload.email;
    if (payload.active != null) data.active = payload.active;
    if (payload.role != null) data.role = payload.role;
    if (payload.companyId != null) data.companyId = payload.companyId;
    if (payload.password != null) {
      data.passwordHash = 'supabase-auth';
    }
    if (Object.keys(data).length === 0) {
      throw new Error('Nenhum dado para atualizar.');
    }

    const { data: updated, error } = await supabase
      .from('User')
      .update(data)
      .eq('id', userId)
      .select('id,name,email,role,active,companyId')
      .single();
    if (error) {
      throwSupabaseError(error, 'Falha ao atualizar usuário.');
    }

    return { success: true, user: updated };
  },

  renewSubscription: async (companyId: string, payload: { months?: number; days?: number; hours?: number; amount?: number; status?: string }) => {
    await requireSuperUser();

    const { data: subscription, error: subError } = await supabase
      .from('Subscription')
      .select('id,status,monthlyFee,expiresAt,lastRenewed')
      .eq('companyId', companyId)
      .single();
    if (subError) {
      throwSupabaseError(subError, 'Falha ao carregar assinatura.');
    }
    if (!subscription) {
      throw new Error('Assinatura nao encontrada.');
    }

    const now = new Date();
    const base = new Date(subscription.expiresAt) > now ? new Date(subscription.expiresAt) : now;
    const newDate = new Date(base);
    if (payload.months) newDate.setMonth(newDate.getMonth() + Number(payload.months));
    if (payload.days) newDate.setDate(newDate.getDate() + Number(payload.days));
    if (payload.hours) newDate.setHours(newDate.getHours() + Number(payload.hours));

    const { error: updateError } = await supabase
      .from('Subscription')
      .update({ expiresAt: newDate.toISOString(), status: 'ATIVO', lastRenewed: now.toISOString() })
      .eq('id', subscription.id);
    if (updateError) {
      throwSupabaseError(updateError, 'Falha ao renovar assinatura.');
    }

    // Reativa a empresa caso esteja suspensa por vencimento
    await supabase.from('Company').update({ active: true }).eq('id', companyId);

    const { error: paymentError } = await supabase.from('PaymentRecord').insert([{
      companyId,
      amount: Number(payload.amount ?? 0).toString(),
      status: payload.status ?? 'PAGO',
      dueDate: now.toISOString(),
      paidAt: payload.status === 'PAGO' ? now.toISOString() : null,
      renewalDate: now.toISOString(),
      updatedAt: now.toISOString()
    }]);
    if (paymentError) {
      throwSupabaseError(paymentError, 'Falha ao registrar pagamento.');
    }

    return { success: true, expiresAt: newDate.toISOString() };
  },

  markPaymentPaid: async (paymentId: string) => {
    await requireSuperUser();
    const { data: payment, error: paymentError } = await supabase
      .from('PaymentRecord')
      .select('id')
      .eq('id', paymentId)
      .single();
    if (paymentError) {
      throwSupabaseError(paymentError, 'Falha ao carregar pagamento.');
    }
    if (!payment) {
      throw new Error('Pagamento não encontrado.');
    }

    const { error: updateError } = await supabase
      .from('PaymentRecord')
      .update({ status: 'PAGO', paidAt: new Date().toISOString() })
      .eq('id', paymentId);
    if (updateError) {
      throwSupabaseError(updateError, 'Falha ao marcar pagamento como pago.');
    }
    return { success: true };
  },

  changePassword: async (newPassword: string, confirmPassword: string) => {
    if (!newPassword || !confirmPassword) {
      throw new Error('Dados incompletos.');
    }
    if (newPassword !== confirmPassword) {
      throw new Error('Confirmação de senha não corresponde.');
    }
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throwSupabaseError(error, 'Falha ao alterar senha.');
    }
    if (!data.user) {
      throw new Error('Usuário não encontrado.');
    }
    return { success: true };
  },

  fetch: async (path: string, params?: Record<string, any>) => {
    const normalizedPath = path.replace(/^\//, '');
    const queryString = buildReportQuery(params);

    switch (normalizedPath) {
      case 'reports/super/revenue':
        return api.exposeSuperRevenue(params?.period, params?.companyId);
      case 'reports/super/ticket-average':
        return api.exposeSuperTicketAverage(params?.companyId);
      case 'reports/super/top-products':
        return api.exposeSuperTopProducts(Number(params?.limit ?? 10), params?.companyId);
      case 'reports/super/payment-methods':
        return api.exposeSuperPaymentMethods(params?.companyId);
      case 'reports/super/user-activity':
        return api.exposeSuperUserActivity(params?.companyId);
      case 'reports/super/audit-log':
        return api.exposeSuperAuditLog(params?.companyId, params?.action, Number(params?.limit ?? 200));
      case 'reports/super/subscriptions':
        return api.exposeSuperSubscriptions();
      case 'reports/super/pending-payments':
        return api.exposeSuperPendingPayments();
      case 'reports/super/health':
        return api.exposeSuperHealth();
      case 'reports/super/low-performance-products':
        return api.exposeSuperLowPerformanceProducts(Number(params?.minQuantity ?? 5), params?.companyId);
      case 'reports/super/hourly-peaks':
        return api.exposeSuperHourlyPeaks(params?.companyId);
      case 'reports/company/products':
        return api.exposeCompanyProductsReport(params?.dateType ?? 'day', params?.dateValue);
      default:
        throw new Error(`Rota não reconhecida: ${path}`);
    }
  },

  exposeSuperRevenue: async (period: string = 'daily', companyId?: string) => {
    await requireSuperUser();
    const now = new Date();
    let startOfPeriod = new Date(now);
    let endOfPeriod = new Date(now);
    switch ((period || 'daily').toLowerCase()) {
      case 'weekly': {
        const day = now.getDay();
        const mondayOffset = (day + 6) % 7;
        startOfPeriod.setDate(now.getDate() - mondayOffset);
        startOfPeriod.setHours(0, 0, 0, 0);
        endOfPeriod = new Date(startOfPeriod);
        endOfPeriod.setDate(startOfPeriod.getDate() + 7);
        break;
      }
      case 'monthly':
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
        endOfPeriod = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'yearly':
        startOfPeriod = new Date(now.getFullYear(), 0, 1);
        endOfPeriod = new Date(now.getFullYear() + 1, 0, 1);
        break;
      default:
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    const orderQuery = supabase.from('Order').select('id,companyId').gte('createdAt', startOfPeriod.toISOString()).lt('createdAt', endOfPeriod.toISOString());
    if (companyId) {
      orderQuery.eq('companyId', companyId);
    }
    const { data: orders, error: ordersError } = await orderQuery;
    if (ordersError) {
      throwSupabaseError(ordersError, 'Falha ao carregar pedidos.');
    }

    const orderIds = (orders || []).map((order) => order.id);
    const { data: items, error: itemsError } = await supabase.from('OrderItem').select('orderId,quantity,unitPrice').in('orderId', orderIds);
    if (itemsError) {
      throwSupabaseError(itemsError, 'Falha ao carregar itens.');
    }

    const companies = await Promise.all(
      Array.from(new Set((orders || []).map((order) => order.companyId))).map(async (companyId) => {
        const { data: company } = await supabase.from('Company').select('id,name').eq('id', companyId).single();
        return company;
      })
    );

    const companyMap = (companies || []).reduce((acc, company) => {
      if (company) acc[company.id] = company;
      return acc;
    }, {} as Record<string, any>);

    const grouped = (orders || []).reduce((acc, order) => {
      acc[order.companyId] = acc[order.companyId] || { companyId: order.companyId, companyName: companyMap[order.companyId]?.name ?? '', totalValue: 0, totalOrders: 0, totalItems: 0 };
      const orderTotal = (items || [])
        .filter((item) => item.orderId === order.id)
        .reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
      acc[order.companyId].totalValue += orderTotal;
      acc[order.companyId].totalOrders += 1;
      acc[order.companyId].totalItems += (items || []).filter((item) => item.orderId === order.id).reduce((sum, item) => sum + item.quantity, 0);
      return acc;
    }, {} as Record<string, any>);

    const companiesReport = Object.values(grouped);
    const totalValue = companiesReport.reduce((sum, item) => sum + item.totalValue, 0);

    return {
      period,
      startDate: startOfPeriod.toISOString(),
      endDate: endOfPeriod.toISOString(),
      totalValue: Number(totalValue.toFixed(2)),
      totalOrders: companiesReport.reduce((sum, item) => sum + item.totalOrders, 0),
      totalItems: companiesReport.reduce((sum, item) => sum + item.totalItems, 0),
      companies: companiesReport.sort((a, b) => b.totalValue - a.totalValue)
    };
  },

  exposeSuperTicketAverage: async (companyId?: string) => {
    await requireSuperUser();
    const orderQuery = supabase.from('Order').select('id,companyId');
    if (companyId) orderQuery.eq('companyId', companyId);
    const { data: orders, error: orderError } = await orderQuery;
    if (orderError) {
      throwSupabaseError(orderError, 'Falha ao carregar pedidos.');
    }

    const orderIds = (orders || []).map((order) => order.id);
    const { data: items, error: itemsError } = await supabase.from('OrderItem').select('orderId,quantity,unitPrice');
    if (itemsError) {
      throwSupabaseError(itemsError, 'Falha ao carregar itens.');
    }

    const companies = await Promise.all(
      Array.from(new Set((orders || []).map((order) => order.companyId))).map(async (companyIdValue) => {
        const { data: company } = await supabase.from('Company').select('id,name').eq('id', companyIdValue).single();
        return company;
      })
    );
    const companyMap = (companies || []).reduce((acc, company) => { if (company) acc[company.id] = company; return acc; }, {} as Record<string, any>);

    const grouped = (orders || []).reduce((acc, order) => {
      acc[order.companyId] = acc[order.companyId] || { companyId: order.companyId, companyName: companyMap[order.companyId]?.name ?? '', orders: [] as number[] };
      const orderTotal = (items || []).filter((item) => item.orderId === order.id).reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
      acc[order.companyId].orders.push(orderTotal);
      return acc;
    }, {} as Record<string, any>);

    return {
      results: Object.values(grouped).map((company: any) => ({
        companyId: company.companyId,
        companyName: company.companyName,
        ticketAverage: company.orders.length > 0 ? company.orders.reduce((a: number, b: number) => a + b, 0) / company.orders.length : 0,
        totalOrders: company.orders.length,
        minValue: company.orders.length > 0 ? Math.min(...company.orders) : 0,
        maxValue: company.orders.length > 0 ? Math.max(...company.orders) : 0
      }))
    };
  },

  exposeSuperTopProducts: async (limit: number = 10, companyId?: string) => {
    await requireSuperUser();
    const orderItemsQuery = supabase.from('OrderItem').select('productId,quantity,unitPrice');
    if (companyId) {
      const { data: orders } = await supabase.from('Order').select('id').eq('companyId', companyId);
      orderItemsQuery.in('orderId', (orders || []).map((order) => order.id));
    }
    const { data: orderItems, error } = await orderItemsQuery;
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar itens de pedido.');
    }

    const productIds = Array.from(new Set((orderItems || []).map((item) => item.productId)));
    const { data: products, error: productsError } = await supabase.from('Product').select('id,name,companyId').in('id', productIds);
    if (productsError) {
      throwSupabaseError(productsError, 'Falha ao carregar produtos.');
    }

    const companyIds = Array.from(new Set((products || []).map((product) => product.companyId)));
    const { data: companies } = await supabase.from('Company').select('id,name').in('id', companyIds);
    const companyMap = (companies || []).reduce((acc, company) => { acc[company.id] = company; return acc; }, {} as Record<string, any>);
    const productMap = (products || []).reduce((acc, product) => { acc[product.id] = product; return acc; }, {} as Record<string, any>);

    const grouped = (orderItems || []).reduce((acc, item) => {
      const product = productMap[item.productId];
      if (!product) return acc;
      acc[item.productId] = acc[item.productId] || { productId: item.productId, productName: product.name, companyId: product.companyId, companyName: companyMap[product.companyId]?.name ?? '', quantity: 0, revenue: 0 };
      acc[item.productId].quantity += item.quantity;
      acc[item.productId].revenue += Number(item.unitPrice) * item.quantity;
      return acc;
    }, {} as Record<string, any>);

    return { limit, topProducts: Object.values(grouped).sort((a, b) => b.quantity - a.quantity).slice(0, limit) };
  },

  exposeSuperPaymentMethods: async (companyId?: string) => {
    await requireSuperUser();
    const paymentQuery = supabase.from('Payment').select('method,amount');
    if (companyId) {
      const { data: tabs } = await supabase.from('Tab').select('id').eq('companyId', companyId);
      paymentQuery.in('tabId', (tabs || []).map((tab) => tab.id));
    }
    const { data: payments, error } = await paymentQuery;
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar pagamentos.');
    }
    const grouped = (payments || []).reduce((acc, payment) => {
      acc[payment.method] = acc[payment.method] || { method: payment.method, totalAmount: 0, count: 0, percentage: 0 };
      acc[payment.method].totalAmount += Number(payment.amount);
      acc[payment.method].count += 1;
      return acc;
    }, {} as Record<string, any>);
    const methods = Object.values(grouped);
    const grandTotal = methods.reduce((sum, method) => sum + method.totalAmount, 0);
    return { methods: methods.map((method) => ({ ...method, percentage: grandTotal > 0 ? Number(((method.totalAmount / grandTotal) * 100).toFixed(2)) : 0, totalAmount: Number(method.totalAmount.toFixed(2)) })) };
  },

  exposeSuperUserActivity: async (companyId?: string) => {
    await requireSuperUser();
    const orderQuery = supabase.from('Order').select('id,userId');
    if (companyId) orderQuery.eq('companyId', companyId);
    const { data: orders, error } = await orderQuery;
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar pedidos.');
    }

    const userIds = Array.from(new Set((orders || []).map((order) => order.userId)));
    const { data: users, error: usersError } = await supabase.from('User').select('id,name,email,role').in('id', userIds);
    if (usersError) {
      throwSupabaseError(usersError, 'Falha ao carregar usuários.');
    }
    const userMap = (users || []).reduce((acc, user) => { acc[user.id] = user; return acc; }, {} as Record<string, any>);

    const grouped = (orders || []).reduce((acc, order) => {
      const user = userMap[order.userId];
      if (!user) return acc;
      acc[order.userId] = acc[order.userId] || { userId: user.id, userName: user.name, userEmail: user.email, userRole: user.role, ordersCreated: 0, itemsSold: 0 };
      acc[order.userId].ordersCreated += 1;
      return acc;
    }, {} as Record<string, any>);

    const orderIds = (orders || []).map((order) => order.id);
    const orderUserMap = (orders || []).reduce((acc, order) => {
      acc[order.id] = order.userId;
      return acc;
    }, {} as Record<string, string>);
    const { data: items, error: itemsError } = await supabase.from('OrderItem').select('orderId,quantity').in('orderId', orderIds);
    if (itemsError) {
      throwSupabaseError(itemsError, 'Falha ao carregar itens.');
    }
    (items || []).forEach((item) => {
      const userId = orderUserMap[item.orderId];
      if (userId && grouped[userId]) {
        grouped[userId].itemsSold += item.quantity ?? 0;
      }
    });

    return { users: Object.values(grouped) };
  },

  exposeSuperAuditLog: async (companyId?: string, action?: string, limit: number = 200) => {
    await requireSuperUser();
    const logQuery = supabase.from('AuditLog').select('id,userId,companyId,action,entity,entityId,dataJson,createdAt');
    if (companyId) logQuery.eq('companyId', companyId);
    if (action) logQuery.ilike('action', `%${action}%`);
    logQuery.order('createdAt', { ascending: false }).limit(limit);
    const { data: logs, error } = await logQuery;
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar logs de auditoria.');
    }

    const userIds = Array.from(new Set((logs || []).map((log) => log.userId).filter(Boolean)));
    const companyIds = Array.from(new Set((logs || []).map((log) => log.companyId)));
    const [{ data: users }, { data: companies }] = await Promise.all([
      userIds.length ? supabase.from('User').select('id,name').in('id', userIds) : Promise.resolve({ data: [] as any[] }),
      companyIds.length ? supabase.from('Company').select('id,name').in('id', companyIds) : Promise.resolve({ data: [] as any[] })
    ]);
    const userMap = (users || []).reduce((acc, u) => { acc[u.id] = u; return acc; }, {} as Record<string, any>);
    const companyMap = (companies || []).reduce((acc, c) => { acc[c.id] = c; return acc; }, {} as Record<string, any>);

    return {
      logs: (logs || []).map((log) => ({
        id: log.id,
        companyName: companyMap[log.companyId]?.name ?? '',
        userName: userMap[log.userId]?.name ?? 'Sistema',
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        createdAt: log.createdAt,
        data: log.dataJson ? JSON.parse(log.dataJson) : null
      }))
    };
  },

  exposeSuperSubscriptions: async () => {
    await requireSuperUser();
    const { data: subscriptions, error } = await supabase.from('Subscription').select('companyId,status,monthlyFee,expiresAt,company:Company(id,name)');
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar assinaturas.');
    }
    return {
      subscriptions: (subscriptions || []).map((sub) => ({
        status: sub.status,
        monthlyFee: Number(sub.monthlyFee),
        expiresAt: sub.expiresAt,
        companyId: sub.company?.id,
        companyName: sub.company?.name
      }))
    };
  },

  exposeSuperPendingPayments: async () => {
    await requireSuperUser();
    const { data: payments, error } = await supabase.from('PaymentRecord').select('id,companyId,amount,status,dueDate').eq('status', 'PENDENTE').order('dueDate', { ascending: true });
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar pagamentos pendentes.');
    }

    const companyIds = Array.from(new Set((payments || []).map((payment) => payment.companyId)));
    const { data: companies, error: companiesError } = await supabase.from('Company').select('id,name').in('id', companyIds);
    if (companiesError) {
      throwSupabaseError(companiesError, 'Falha ao carregar empresas.');
    }
    const companyMap = (companies || []).reduce((acc, company) => { acc[company.id] = company; return acc; }, {} as Record<string, any>);

    return {
      count: (payments || []).length,
      payments: (payments || []).map((payment) => ({
        id: payment.id,
        companyName: companyMap[payment.companyId]?.name ?? '',
        amount: Number(payment.amount),
        dueDate: payment.dueDate,
        status: payment.status,
        daysOverdue: Math.floor((new Date().getTime() - new Date(payment.dueDate).getTime()) / (1000 * 60 * 60 * 24))
      }))
    };
  },

  exposeSuperHealth: async () => {
    await requireSuperUser();
    const [totalCompanies, totalUsers, totalTables, totalProducts, totalOrders, activeSubscriptions] = await Promise.all([
      supabase.from('Company').select('id', { count: 'exact' }).then((result) => { if (result.error) throw result.error; return result.count ?? 0; }),
      supabase.from('User').select('id', { count: 'exact' }).then((result) => { if (result.error) throw result.error; return result.count ?? 0; }),
      supabase.from('RestaurantTable').select('id', { count: 'exact' }).then((result) => { if (result.error) throw result.error; return result.count ?? 0; }),
      supabase.from('Product').select('id', { count: 'exact' }).then((result) => { if (result.error) throw result.error; return result.count ?? 0; }),
      supabase.from('Order').select('id', { count: 'exact' }).then((result) => { if (result.error) throw result.error; return result.count ?? 0; }),
      supabase.from('Subscription').select('id', { count: 'exact' }).eq('status', 'ATIVO').then((result) => { if (result.error) throw result.error; return result.count ?? 0; })
    ]);

    const { data: companiesByStatus, error: companiesByStatusError } = await supabase.from('Company').select('active,count(id)').group('active');
    if (companiesByStatusError) {
      throwSupabaseError(companiesByStatusError, 'Falha ao carregar status de empresas.');
    }
    const { data: usersByRole, error: usersByRoleError } = await supabase.from('User').select('role,count(id)').group('role');
    if (usersByRoleError) {
      throwSupabaseError(usersByRoleError, 'Falha ao carregar usuários por cargo.');
    }

    return {
      companies: {
        total: totalCompanies,
        byStatus: (companiesByStatus || []).map((stat) => ({ status: stat.active ? 'Ativo' : 'Inativo', count: stat.count }))
      },
      users: {
        total: totalUsers,
        byRole: (usersByRole || []).map((stat) => ({ role: stat.role, count: stat.count }))
      },
      tables: totalTables,
      products: totalProducts,
      orders: totalOrders,
      subscriptions: {
        active: activeSubscriptions
      }
    };
  },

  exposeSuperLowPerformanceProducts: async (minQuantity: number = 5, companyId?: string) => {
    await requireSuperUser();
    const productQuery = supabase.from('Product').select('id,name,companyId,cost,price');
    if (companyId) productQuery.eq('companyId', companyId);
    const { data: products, error } = await productQuery;
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar produtos.');
    }

    const productIds = (products || []).map((product) => product.id);
    const { data: orderItems, error: itemsError } = await supabase.from('OrderItem').select('productId,quantity,unitPrice').in('productId', productIds);
    if (itemsError) {
      throwSupabaseError(itemsError, 'Falha ao carregar itens de pedido.');
    }

    const companyIds = Array.from(new Set((products || []).map((product) => product.companyId)));
    const { data: companies, error: companiesError } = await supabase.from('Company').select('id,name').in('id', companyIds);
    if (companiesError) {
      throwSupabaseError(companiesError, 'Falha ao carregar empresas.');
    }
    const companyMap = (companies || []).reduce((acc, company) => { acc[company.id] = company; return acc; }, {} as Record<string, any>);

    const grouped = (products || []).map((product) => {
      const sold = (orderItems || []).filter((item) => item.productId === product.id);
      const quantitySold = sold.reduce((sum, item) => sum + item.quantity, 0);
      return {
        productId: product.id,
        productName: product.name,
        companyId: product.companyId,
        companyName: companyMap[product.companyId]?.name ?? '',
        price: Number(product.price),
        cost: Number(product.cost),
        quantitySold,
        revenue: sold.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
      };
    }).filter((product) => product.quantitySold < minQuantity).sort((a, b) => a.quantitySold - b.quantitySold);

    return {
      minQuantity,
      lowPerformanceProducts: grouped
    };
  },

  exposeSuperHourlyPeaks: async (companyId?: string) => {
    await requireSuperUser();
    const orderQuery = supabase.from('Order').select('id,createdAt');
    if (companyId) orderQuery.eq('companyId', companyId);
    const { data: orders, error } = await orderQuery;
    if (error) {
      throwSupabaseError(error, 'Falha ao carregar pedidos.');
    }

    const { data: items, error: itemsError } = await supabase.from('OrderItem').select('orderId,quantity,unitPrice');
    if (itemsError) {
      throwSupabaseError(itemsError, 'Falha ao carregar itens.');
    }

    const grouped = (orders || []).reduce((acc, order) => {
      const hour = new Date(order.createdAt).getHours();
      acc[hour] = acc[hour] || { hour: `${String(hour).padStart(2, '0')}:00`, orders: 0, items: 0, revenue: 0 };
      const orderItems = (items || []).filter((item) => item.orderId === order.id);
      acc[hour].orders += 1;
      acc[hour].items += orderItems.length;
      acc[hour].revenue += orderItems.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
      return acc;
    }, {} as Record<number, any>);

    return {
      peakHours: Object.values(grouped).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    };
  },

  exposeCompanyProductsReport: async (dateType: 'day' | 'week' = 'day', dateValue?: string) => {
    const user = await requireCompanyUserWithRoles(['FINANCEIRO', 'GERENTE', 'ADMIN']);
    let startDate = new Date();
    let endDate = new Date();

    if (dateType === 'week' && dateValue) {
      const match = dateValue.match(/(\d{4})-W(\d{2})/);
      if (match) {
        const year = Number(match[1]);
        const week = Number(match[2]);
        const simple = new Date(year, 0, 1 + (week - 1) * 7);
        const dow = simple.getDay();
        const isoStart = new Date(simple);
        if (dow <= 4) isoStart.setDate(simple.getDate() - simple.getDay() + 1);
        else isoStart.setDate(simple.getDate() + 8 - simple.getDay());
        startDate = new Date(isoStart);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 7);
      } else {
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 1);
      }
    } else {
      const date = dateValue ? new Date(dateValue) : new Date();
      startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 1);
    }

    const { data: orders, error: ordersError } = await supabase
      .from('Order')
      .select('id')
      .eq('companyId', user.companyId)
      .gte('createdAt', startDate.toISOString())
      .lt('createdAt', endDate.toISOString());
    if (ordersError) {
      throwSupabaseError(ordersError, 'Falha ao carregar pedidos.');
    }

    const orderIds = (orders || []).map((order) => order.id);
    const { data: items, error: itemsError } = await supabase.from('OrderItem').select('productId,quantity,unitPrice').in('orderId', orderIds);
    if (itemsError) {
      throwSupabaseError(itemsError, 'Falha ao carregar itens.');
    }

    const productIds = Array.from(new Set((items || []).map((item) => item.productId)));
    const { data: products, error: productsError } = await supabase.from('Product').select('id,name').in('id', productIds);
    if (productsError) {
      throwSupabaseError(productsError, 'Falha ao carregar produtos.');
    }
    const productMap = (products || []).reduce((acc, product) => { acc[product.id] = product; return acc; }, {} as Record<string, any>);

    const topProducts = Object.values((items || []).reduce((acc, item) => {
      acc[item.productId] = acc[item.productId] || { productId: item.productId, productName: productMap[item.productId]?.name ?? '', quantity: 0, revenue: 0 };
      acc[item.productId].quantity += item.quantity;
      acc[item.productId].revenue += Number(item.unitPrice) * item.quantity;
      return acc;
    }, {} as Record<string, any>)).sort((a, b) => b.quantity - a.quantity);

    return {
      topProducts,
      lowProducts: [...topProducts].reverse().slice(0, 10),
      dateType,
      dateValue,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
  },

  reportSummary: async (period: string = 'daily', refDate?: string) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'FINANCEIRO', 'GERENTE']);

    const ref = refDate ? new Date(refDate) : new Date();
    let startDate: Date;
    let endDate: Date;
    let periodLabel = '';

    switch ((period || 'daily').toLowerCase()) {
      case 'weekly': {
        const day = ref.getDay();
        const mondayOffset = (day + 6) % 7;
        startDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - mondayOffset);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 7);
        const endDisplay = new Date(endDate); endDisplay.setDate(endDisplay.getDate() - 1);
        periodLabel = `${startDate.toLocaleDateString('pt-BR')} – ${endDisplay.toLocaleDateString('pt-BR')}`;
        break;
      }
      case 'monthly':
        startDate = new Date(ref.getFullYear(), ref.getMonth(), 1);
        endDate = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
        periodLabel = startDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        break;
      case 'yearly':
        startDate = new Date(ref.getFullYear(), 0, 1);
        endDate = new Date(ref.getFullYear() + 1, 0, 1);
        periodLabel = String(ref.getFullYear());
        break;
      default: // daily
        startDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
        endDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1);
        periodLabel = startDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    // Pedidos de mesa
    const { data: orders, error: ordersError } = await supabase
      .from('Order')
      .select('id,tabId,status,createdAt')
      .eq('companyId', user.companyId)
      .neq('status', 'CANCELADO')
      .gte('createdAt', startDate.toISOString())
      .lt('createdAt', endDate.toISOString());
    if (ordersError) throwSupabaseError(ordersError, 'Falha ao carregar pedidos.');

    // Pedidos de delivery no mesmo período — só pedidos confirmados/pagos
    // (exclui AGUARDANDO_PAGAMENTO, que ainda não foi efetivado pelo cliente).
    const { data: deliveryOrders } = await supabase
      .from('DeliveryOrder')
      .select('id,total,status,createdAt,customerName')
      .eq('companyId', user.companyId)
      .neq('status', 'CANCELADO')
      .eq('paymentStatus', 'PAGO')
      .gte('createdAt', startDate.toISOString())
      .lt('createdAt', endDate.toISOString());

    const orderIds = (orders || []).map((o) => o.id);
    const tabIds = Array.from(new Set((orders || []).map((o) => o.tabId)));

    const [itemsResult, tabsResult] = await Promise.all([
      orderIds.length > 0
        ? supabase.from('OrderItem').select('orderId,productId,quantity,unitPrice').in('orderId', orderIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      tabIds.length > 0
        ? supabase.from('Tab').select('id,tableId').in('id', tabIds)
        : Promise.resolve({ data: [] as any[], error: null })
    ]);

    const items = itemsResult.data || [];
    const tabs = tabsResult.data || [];
    const tableIds = Array.from(new Set(tabs.map((t: any) => t.tableId)));
    const { data: tableRows } = tableIds.length > 0
      ? await supabase.from('RestaurantTable').select('id,name').in('id', tableIds)
      : { data: [] as any[] };

    const tabMap = tabs.reduce((acc: any, t: any) => { acc[t.id] = t; return acc; }, {});
    const tableMap = (tableRows || []).reduce((acc: any, t: any) => { acc[t.id] = t; return acc; }, {});
    const itemsByOrder = items.reduce((acc: any, item: any) => {
      acc[item.orderId] = acc[item.orderId] || [];
      acc[item.orderId].push(item);
      return acc;
    }, {});

    const tableGroups: Record<string, { tableId: string; tableName: string; orders: any[]; totalValue: number; totalItems: number }> = {};
    for (const order of (orders || [])) {
      const tab = tabMap[order.tabId];
      const tableId = tab?.tableId ?? 'sem-mesa';
      const tableName = tableMap[tableId]?.name ?? 'Mesa desconhecida';
      if (!tableGroups[tableId]) {
        tableGroups[tableId] = { tableId, tableName, orders: [], totalValue: 0, totalItems: 0 };
      }
      const orderItems = itemsByOrder[order.id] || [];
      const orderValue = orderItems.reduce((s: number, i: any) => s + Number(i.unitPrice) * i.quantity, 0);
      const orderItemCount = orderItems.reduce((s: number, i: any) => s + i.quantity, 0);
      tableGroups[tableId].orders.push({ ...order, items: orderItems });
      tableGroups[tableId].totalValue += orderValue;
      tableGroups[tableId].totalItems += orderItemCount;
    }

    // Delivery como grupo especial
    const deliveryList = deliveryOrders || [];
    if (deliveryList.length > 0) {
      const deliveryTotal = deliveryList.reduce((s: number, d: any) => s + Number(d.total), 0);
      tableGroups['__delivery__'] = {
        tableId: '__delivery__',
        tableName: 'Delivery',
        orders: deliveryList,
        totalValue: deliveryTotal,
        totalItems: deliveryList.length,
      };
    }

    const mesaItems = items.reduce((s: number, i: any) => s + i.quantity, 0);
    const mesaValue = items.reduce((s: number, i: any) => s + Number(i.unitPrice) * i.quantity, 0);
    const deliveryValue = deliveryList.reduce((s: number, d: any) => s + Number(d.total), 0);

    return {
      period,
      periodLabel,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalOrders: (orders || []).length + deliveryList.length,
      totalItems: mesaItems + deliveryList.length,
      totalValue: mesaValue + deliveryValue,
      tables: Object.values(tableGroups),
    };
  },

  // Retorna faturamento dia-a-dia para o mês/ano informado (para gráfico de barras)
  reportDailyBreakdown: async (year: number, month: number) => {
    const user = await requireCompanyUserWithRoles(['ADMIN', 'CAIXA', 'FINANCEIRO', 'GERENTE']);
    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 1);

    const [ordersRes, deliveryRes] = await Promise.all([
      supabase.from('OrderItem')
        .select('quantity,unitPrice,order:Order!inner(createdAt,status,companyId)')
        .eq('order.companyId', user.companyId)
        .neq('order.status', 'CANCELADO')
        .gte('order.createdAt', startDate.toISOString())
        .lt('order.createdAt', endDate.toISOString()),
      supabase.from('DeliveryOrder')
        .select('total,createdAt')
        .eq('companyId', user.companyId)
        .neq('status', 'CANCELADO')
        .eq('paymentStatus', 'PAGO')
        .gte('createdAt', startDate.toISOString())
        .lt('createdAt', endDate.toISOString()),
    ]);

    const daysInMonth = new Date(year, month, 0).getDate();
    const byDay: Record<number, number> = {};
    for (let d = 1; d <= daysInMonth; d++) byDay[d] = 0;

    for (const item of (ordersRes.data ?? [])) {
      const day = new Date((item.order as any).createdAt).getDate();
      byDay[day] = (byDay[day] ?? 0) + Number(item.unitPrice) * Number(item.quantity);
    }
    for (const order of (deliveryRes.data ?? [])) {
      const day = new Date(order.createdAt).getDate();
      byDay[day] = (byDay[day] ?? 0) + Number(order.total);
    }

    return Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, value: byDay[i + 1] ?? 0 }));
  },

  // --- Carteira (wallet) — saldo da própria empresa ---
  wallet: {
    get: async () => {
      const user = await requireCompanyUser();
      const { data, error } = await supabase
        .from('Wallet')
        .select('companyId,balance,deliveryFeePercent,payoutPixKey,updatedAt')
        .eq('companyId', user.companyId)
        .maybeSingle();
      if (error) throwSupabaseError(error, 'Falha ao carregar carteira.');
      return data;
    },

    listTransactions: async (limit = 30) => {
      const user = await requireCompanyUser();
      const { data, error } = await supabase
        .from('WalletTransaction')
        .select('id,type,amount,balanceAfter,description,deliveryOrderId,tabId,createdAt')
        .eq('companyId', user.companyId)
        .order('createdAt', { ascending: false })
        .limit(limit);
      if (error) throwSupabaseError(error, 'Falha ao carregar extrato da carteira.');
      return data ?? [];
    },

    listWithdrawals: async () => {
      const user = await requireCompanyUser();
      const { data, error } = await supabase
        .from('WalletWithdrawal')
        .select('id,amount,status,pixKeyUsed,isAutomatic,requestedAt,paidAt,note')
        .eq('companyId', user.companyId)
        .order('requestedAt', { ascending: false });
      if (error) throwSupabaseError(error, 'Falha ao carregar saques.');
      return data ?? [];
    },

    setPayoutPixKey: async (pixKey: string) => {
      await requireCompanyUserWithRoles(['ADMIN', 'GERENTE']);
      const { error } = await supabase.rpc('set_payout_pix_key', { p_pix_key: pixKey });
      if (error) throwSupabaseError(error, 'Falha ao salvar chave Pix de repasse.');
      return { success: true };
    },

    requestWithdrawal: async (amount: number) => {
      await requireCompanyUserWithRoles(['ADMIN', 'GERENTE']);
      const { data, error } = await supabase.rpc('request_wallet_withdrawal', { p_amount: amount });
      if (error) throwSupabaseError(error, 'Falha ao solicitar saque.');

      // Notifica o suporte via WhatsApp
      fetch(`${SUPABASE_URL}/functions/v1/whatsapp-notify`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SAQUE_SOLICITADO', withdrawalId: data, amount }),
      }).catch(() => {});

      return { success: true, withdrawalId: data as string };
    }
  },

  // --- Carteiras — visão do AdminSuper sobre todas as empresas ---
  listCompanyWallets: async () => {
    await requireSuperUser();
    const [{ data: wallets, error: walletsError }, { data: companies, error: companiesError }] = await Promise.all([
      supabase.from('Wallet').select('companyId,balance,deliveryFeePercent,payoutPixKey,updatedAt'),
      supabase.from('Company').select('id,name')
    ]);
    if (walletsError) throwSupabaseError(walletsError, 'Falha ao carregar carteiras.');
    if (companiesError) throwSupabaseError(companiesError, 'Falha ao carregar empresas.');
    const nameById = (companies ?? []).reduce((acc: Record<string, string>, c: any) => { acc[c.id] = c.name; return acc; }, {});
    return (wallets ?? []).map((w: any) => ({ ...w, companyName: nameById[w.companyId] ?? w.companyId }));
  },

  setCompanyDeliveryFee: async (companyId: string, percent: number) => {
    await requireSuperUser();
    const { error } = await supabase.rpc('set_company_delivery_fee', {
      p_company_id: companyId,
      p_percent: percent
    });
    if (error) throwSupabaseError(error, 'Falha ao atualizar taxa da plataforma.');
    return { success: true };
  },

  listPendingWithdrawals: async () => {
    await requireSuperUser();
    const { data: withdrawals, error } = await supabase
      .from('WalletWithdrawal')
      .select('id,companyId,amount,status,pixKeyUsed,isAutomatic,requestedAt')
      .eq('status', 'SOLICITADO')
      .order('requestedAt', { ascending: true });
    if (error) throwSupabaseError(error, 'Falha ao carregar solicitações de saque.');
    if (!withdrawals || withdrawals.length === 0) return [];
    const companyIds = Array.from(new Set(withdrawals.map((w: any) => w.companyId)));
    const { data: companies } = await supabase.from('Company').select('id,name').in('id', companyIds);
    const nameById = (companies ?? []).reduce((acc: Record<string, string>, c: any) => { acc[c.id] = c.name; return acc; }, {});
    return withdrawals.map((w: any) => ({ ...w, companyName: nameById[w.companyId] ?? w.companyId }));
  },

  resolveWithdrawal: async (withdrawalId: string, approve: boolean, note?: string) => {
    await requireSuperUser();
    const { error } = await supabase.rpc('resolve_wallet_withdrawal', {
      p_withdrawal_id: withdrawalId,
      p_approve: approve,
      p_note: note ?? null
    });
    if (error) throwSupabaseError(error, 'Falha ao resolver solicitação de saque.');
    return { success: true };
  },

  // --- Configuração Mercado Pago da plataforma (conta master, AdminSuper) ---
  setPlatformMercadoPagoToken: async (accessToken: string, publicKey?: string) => {
    await requireSuperUser();
    const { error } = await supabase.rpc('set_platform_mercado_pago_token', {
      p_access_token: accessToken,
      p_public_key: publicKey ?? null
    });
    if (error) throwSupabaseError(error, 'Falha ao salvar configuração do Mercado Pago.');
    return { success: true };
  },

  getPlatformMercadoPagoStatus: async () => {
    await requireSuperUser();
    const { data, error } = await supabase.rpc('get_platform_mercado_pago_status');
    if (error) throwSupabaseError(error, 'Falha ao carregar status do Mercado Pago.');
    const row = Array.isArray(data) ? data[0] : data;
    return {
      connected: !!row?.connected,
      publicKey: row?.public_key ?? null,
      connectedAt: row?.connected_at ?? null
    };
  }
};
