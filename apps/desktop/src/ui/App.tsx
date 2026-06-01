import { type FormEvent, type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, ChefHat, LayoutDashboard, LogOut, ReceiptText, Settings, ShoppingBag, Utensils, Users, AlertTriangle, CheckCircle, Clock, TrendingUp, DollarSign, ShoppingCart, Target, MoreVertical } from 'lucide-react';
import { api } from './api.js';
import { supabase } from './supabase.ts';
import type { Order, Product, RestaurantTable } from './types.js';
import { printReceipt } from './receipt';

type ActiveModule = 'mesas' | 'comandas' | 'cozinha' | 'cardapio' | 'caixa' | 'ajustes' | 'menu' | 'financeiro' | 'cadastros' | 'usuarios';
type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

const reportPeriods: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'daily', label: 'Dia' },
  { value: 'weekly', label: 'Semana' },
  { value: 'monthly', label: 'Mês' },
  { value: 'yearly', label: 'Ano' }
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);

const getWeekNumber = (date: Date): string => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
};

const tableStatusLabel: Record<string, string> = {
  LIVRE: 'Livre',
  AMARELO: 'Novo',
  VERMELHO: 'Ocupada',
  OCUPADA: 'Ocupada',
  RESERVADA: 'Reservada',
  FECHANDO_CONTA: 'Fechando'
};

const orderStatusLabel: Record<string, string> = {
  ENVIADO: 'Novo',
  EM_PREPARO: 'Preparo',
  PRONTO: 'Pronto',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado'
};

const moduleConfig: Record<ActiveModule, { eyebrow: string; title: string }> = {
  mesas: { eyebrow: 'PDV local', title: 'Painel de atendimento' },
  comandas: { eyebrow: 'Atendimento', title: 'Comandas abertas' },
  cozinha: { eyebrow: 'KDS', title: 'Fila da cozinha' },
  cardapio: { eyebrow: 'Produtos', title: 'Cardapio' },
  caixa: { eyebrow: 'Financeiro', title: 'Caixa' },
  ajustes: { eyebrow: 'Administracao', title: 'Ajustes do sistema' },
  financeiro: { eyebrow: 'Financeiro', title: 'Resumo Financeiro' },
  cadastros: { eyebrow: 'Cadastros', title: 'Gestão de clientes' },
  usuarios: { eyebrow: 'Usuários', title: 'Gestão de usuários' },
  menu: { eyebrow: 'Menu', title: 'Peça para sua mesa' }
};
const roleAllowedModules: Record<string, ActiveModule[]> = {
  SUPER: ['financeiro', 'cadastros', 'usuarios'],
  ADMIN: ['mesas', 'comandas', 'cozinha', 'cardapio', 'caixa', 'ajustes', 'menu'],
  GERENTE: ['mesas', 'comandas', 'cozinha', 'cardapio', 'caixa', 'ajustes', 'menu'],
  CAIXA: ['mesas', 'comandas', 'cozinha'],
  GARCOM: ['mesas', 'comandas'],
  COZINHA: ['cozinha'],
  FINANCEIRO: ['financeiro', 'caixa', 'mesas', 'comandas'],
  ESTOQUE: ['cardapio', 'mesas', 'comandas']
};

const getAllowedModules = (role?: string): ActiveModule[] => {
  if (!role) {
    return ['mesas', 'comandas', 'cozinha', 'cardapio', 'caixa', 'ajustes', 'menu', 'financeiro', 'cadastros', 'usuarios'];
  }
  return roleAllowedModules[role] ?? ['mesas', 'comandas', 'cozinha', 'cardapio', 'caixa', 'ajustes', 'menu', 'financeiro', 'cadastros', 'usuarios'];
};

const getNavItems = (role?: string) => {
  const allowedModuleIds = getAllowedModules(role);
  const moduleOptions: Record<string, { id: ActiveModule; label: string; icon: any }> = {
    mesas: { id: 'mesas', label: 'Mesas', icon: LayoutDashboard },
    comandas: { id: 'comandas', label: 'Comandas', icon: ReceiptText },
    cozinha: { id: 'cozinha', label: 'Cozinha', icon: ChefHat },
    cardapio: { id: 'cardapio', label: 'Cardápio', icon: ShoppingBag },
    caixa: { id: 'caixa', label: 'Caixa', icon: Banknote },
    ajustes: { id: 'ajustes', label: 'Ajustes', icon: Settings },
    menu: { id: 'menu', label: 'Menu', icon: Utensils },
    financeiro: { id: 'financeiro', label: 'Financeiro', icon: Banknote },
    cadastros: { id: 'cadastros', label: 'Cadastros', icon: Settings },
    usuarios: { id: 'usuarios', label: 'Usuários', icon: Users }
  };

  return allowedModuleIds.map((moduleId) => moduleOptions[moduleId]).filter((item) => item !== undefined);
};

export function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentCompany, setCurrentCompany] = useState<any>(null);
  const [loginEmail, setLoginEmail] = useState('super@sistema.local');
  const [loginPassword, setLoginPassword] = useState('admin');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // App state
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>('mesa_1');
  const [apiStatus, setApiStatus] = useState<'online' | 'offline'>('offline');
  const [activeModule, setActiveModule] = useState<ActiveModule>('mesas');
  const [newProductName, setNewProductName] = useState('');
  const [newProductDescription, setNewProductDescription] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductPreparationMinutes, setNewProductPreparationMinutes] = useState('10');
  const [menuTableId, setMenuTableId] = useState<string | null>(null);
  const [menuCart, setMenuCart] = useState<Array<{ product: Product; quantity: number; note: string }>>([]);
  const [menuModalTable, setMenuModalTable] = useState<RestaurantTable | null>(null);
  const [qrModalTable, setQrModalTable] = useState<RestaurantTable | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  // Super user panel state
  const [companies, setCompanies] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<any | null>(null);
  const [editAdminId, setEditAdminId] = useState<string | null>(null);
  const [editAdminName, setEditAdminName] = useState('');
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [editAdminPassword, setEditAdminPassword] = useState('');
  const [renewMonths, setRenewMonths] = useState('1');
  const [renewDays, setRenewDays] = useState('0');
  const [renewHours, setRenewHours] = useState('0');
  const [renewAmount, setRenewAmount] = useState('0.00');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editMonthlyFee, setEditMonthlyFee] = useState('0.00');
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showInvoicesModal, setShowInvoicesModal] = useState(false);
  const [invoiceCompany, setInvoiceCompany] = useState<any | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [confirmationRequest, setConfirmationRequest] = useState<{
    message: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [companyFilterStatus, setCompanyFilterStatus] = useState<'all' | 'overdue' | 'pending' | 'paid'>('all');
  const [companySearch, setCompanySearch] = useState('');
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUsersCompany, setSelectedUsersCompany] = useState<any | null>(null);
  const [userSectionTab, setUserSectionTab] = useState<'list' | 'photo'>('list');
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('CAIXA');
  const [newUserActive, setNewUserActive] = useState(true);
  const [profilePhoto, setProfilePhoto] = useState('');
  const [storeName, setStoreName] = useState('Integra360');
  const [storeCnpj, setStoreCnpj] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storePixKey, setStorePixKey] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dailyReceipts, setDailyReceipts] = useState<any[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [searchReceiptNumber, setSearchReceiptNumber] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  // New company / admin creation state
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyCnpj, setNewCompanyCnpj] = useState('');
  const [newCompanyEmail, setNewCompanyEmail] = useState('');
  const [newCompanyPhone, setNewCompanyPhone] = useState('');
  const [newCompanyAddress, setNewCompanyAddress] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newCompanyMonths, setNewCompanyMonths] = useState('1');
  const [newCompanyMonthlyFee, setNewCompanyMonthlyFee] = useState('0.00');
  const [newCompanyTableCount, setNewCompanyTableCount] = useState('10');

  // Super user reports state
  const [reportsTab, setReportsTab] = useState<'revenue' | 'products' | 'payments' | 'users' | 'audit' | 'health'>('revenue');
  const [reportPeriod, setReportPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [revenueReport, setRevenueReport] = useState<any>(null);
  const [ticketAverageReport, setTicketAverageReport] = useState<any>(null);
  const [topProductsReport, setTopProductsReport] = useState<any>(null);
  const [paymentMethodsReport, setPaymentMethodsReport] = useState<any>(null);
  const [userActivityReport, setUserActivityReport] = useState<any>(null);
  const [auditLogReport, setAuditLogReport] = useState<any>(null);
  const [subscriptionReport, setSubscriptionReport] = useState<any>(null);
  const [pendingPaymentsReport, setPendingPaymentsReport] = useState<any>(null);
  const [healthReport, setHealthReport] = useState<any>(null);
  const [lowPerformanceReport, setLowPerformanceReport] = useState<any>(null);
  const [hourlyPeaksReport, setHourlyPeaksReport] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [selectedReportCompany, setSelectedReportCompany] = useState<string>('all');

  // Company individual reports state
  const [companyReportDateType, setCompanyReportDateType] = useState<'day' | 'week'>('day');
  const [companyReportSelectedDate, setCompanyReportSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [companyReportSelectedWeek, setCompanyReportSelectedWeek] = useState(getWeekNumber(new Date()));
  const [companyTopProducts, setCompanyTopProducts] = useState<any>(null);
  const [companyLowProducts, setCompanyLowProducts] = useState<any>(null);
  const [loadingCompanyReport, setLoadingCompanyReport] = useState(false);

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) ?? tables[0],
    [selectedTableId, tables]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tableId = params.get('tableId');
    if (tableId) {
      setMenuTableId(tableId);
      setActiveModule('menu');
    }
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      const storedPhoto = localStorage.getItem(`profilePhoto_${currentUser.id}`);
      if (storedPhoto) {
        setProfilePhoto(storedPhoto);
      }
    }

    if (currentUser?.companyId) {
      void loadCurrentCompany();
      return;
    }

    setCurrentCompany(null);
    setStoreName(localStorage.getItem('storeName') ?? 'Integra360');
    setStoreCnpj(localStorage.getItem('storeCnpj') ?? '');
    setStoreAddress(localStorage.getItem('storeAddress') ?? '');
    setStorePhone(localStorage.getItem('storePhone') ?? '');
  }, [currentUser]);

  useEffect(() => {
    if (currentCompany) {
      setStoreName(currentCompany.name ?? 'Integra360');
      setStoreCnpj(currentCompany.cnpj ?? '');
      setStoreAddress(currentCompany.address ?? '');
      setStorePhone(currentCompany.phone ?? '');
      setStorePixKey(currentCompany.pixKey ?? '');
    }
  }, [currentCompany]);

  useEffect(() => {
    if (activeModule === 'cadastros') {
      void loadCompanies();
    }
  }, [activeModule]);

  const formatRemaining = (ms: number | null) => {
    if (ms == null) return '—';
    if (ms <= 0) return 'Expirado';
    const secs = Math.floor(ms / 1000);
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const loadCurrentCompany = async () => {
    if (!currentUser?.companyId) {
      setCurrentCompany(null);
      return;
    }

    try {
      const response = await api.getCompanyProfile();
      setCurrentCompany(response.company);
    } catch (error) {
      console.error('Falha ao carregar dados da empresa', error);
      setCurrentCompany(null);
    }
  };

  async function loadCompanies() {
    setLoadingCompanies(true);
    try {
      const list = await api.listCompanies();
      setCompanies(list || []);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Erro ao carregar empresas', e);
      alert('Falha ao carregar empresas. Veja o console.');
    } finally {
      setLoadingCompanies(false);
    }
  }

  const confirmAction = (message: string, action: () => Promise<void> | void) => {
    setConfirmationRequest({ message, onConfirm: action });
  };

  const handleConfirmation = async () => {
    if (!confirmationRequest) return;
    setConfirmationLoading(true);
    try {
      await confirmationRequest.onConfirm();
    } finally {
      setConfirmationLoading(false);
      setConfirmationRequest(null);
    }
  };

  const submitCreateCompany = async () => {
    if (!newCompanyName.trim() || !newAdminEmail.trim() || !newAdminPassword.trim()) {
      return alert('Preencha o nome da empresa e credenciais do administrador.');
    }

    try {
      await api.createCompany({
        name: newCompanyName,
        cnpj: newCompanyCnpj || '00000000000000',
        email: newCompanyEmail || newAdminEmail,
        phone: newCompanyPhone || undefined,
        address: newCompanyAddress || undefined,
        adminName: newAdminName || newAdminEmail,
        adminEmail: newAdminEmail,
        adminPassword: newAdminPassword,
        months: Number(newCompanyMonths) || 1,
        monthlyFee: Number(newCompanyMonthlyFee.replace(',', '.')) || 0,
        tableCount: Number(newCompanyTableCount) || 10
      });

      setNewCompanyName('');
      setNewCompanyCnpj('');
      setNewCompanyEmail('');
      setNewCompanyPhone('');
      setNewCompanyAddress('');
      setNewAdminName('');
      setNewAdminEmail('');
      setNewAdminPassword('');
      setNewCompanyMonths('1');
      setNewCompanyMonthlyFee('0.00');
      setNewCompanyTableCount('10');

      await loadCompanies();
      alert('Empresa criada com sucesso. Credenciais do admin criadas.');
    } catch (e) {
      console.error('Erro ao criar empresa', e);
      alert('Falha ao criar empresa. Veja o console.');
    }
  };

  const handleSuspendCompany = async (id: string) => {
    confirmAction('Suspender essa empresa e desativar usuários?', async () => {
      try {
        await api.suspendCompany(id);
        await loadCompanies();
        alert('Empresa suspensa.');
      } catch (e) {
        console.error(e);
        alert('Falha ao suspender empresa.');
      }
    });
  };

  const handleReactivateCompany = async (id: string) => {
    confirmAction('Reativar essa empresa?', async () => {
      try {
        await api.reactivateCompany(id);
        await loadCompanies();
        alert('Empresa reativada.');
      } catch (e) {
        console.error(e);
        alert('Falha ao reativar empresa.');
      }
    });
  };

  const openRenewModal = (company: any) => {
    setSelectedCompany(company);
    setRenewMonths('1');
    setRenewDays('0');
    setRenewHours('0');
    setRenewAmount(String(company.monthlyFee ?? '0.00'));
    setShowRenewModal(true);
  };

  const handleRenew = (company: any) => openRenewModal(company);

  const submitRenewModal = async () => {
    if (!selectedCompany) return;
    const months = Number(renewMonths) || 0;
    const days = Number(renewDays) || 0;
    const hours = Number(renewHours) || 0;
    const amount = Number(renewAmount.replace(',', '.')) || 0;
    try {
      await api.renewSubscription(selectedCompany.id, { months, days, hours, amount, status: 'PAGO' });
      await loadCompanies();
      setShowRenewModal(false);
      alert('Assinatura renovada.');
    } catch (e) {
      console.error(e);
      alert('Falha ao renovar assinatura.');
    }
  };

  const openEditModal = (company: any) => {
    setSelectedCompany(company);
    setEditName(company.name ?? '');
    setEditEmail(company.email ?? '');
    setEditPhone(company.phone ?? '');
    setEditAddress(company.address ?? '');
    setEditMonthlyFee(String(company.monthlyFee ?? '0.00'));
    setShowEditModal(true);
  };

  // Enhance edit modal to include admin (first ADMIN user of company)
  const openEditModalWithAdmin = async (company: any) => {
    setSelectedCompany(company);
    setEditName(company.name ?? '');
    setEditEmail(company.email ?? '');
    setEditPhone(company.phone ?? '');
    setEditAddress(company.address ?? '');
    setEditMonthlyFee(String(company.monthlyFee ?? '0.00'));
    // load users and find ADMIN for this company
    try {
      setLoadingUsers(true);
      const all = await api.listUsers();
      const admin = (all || []).find((u: any) => u.companyId === company.id && u.role === 'ADMIN');
      if (admin) {
        setEditAdminId(admin.id);
        setEditAdminName(admin.name ?? '');
        setEditAdminEmail(admin.email ?? '');
        setEditAdminPassword('');
      } else {
        setEditAdminId(null);
        setEditAdminName('');
        setEditAdminEmail('');
        setEditAdminPassword('');
      }
    } catch (e) {
      console.error('Erro ao carregar usuarios para edição', e);
    } finally {
      setLoadingUsers(false);
    }
    setShowEditModal(true);
  };

  const openUsersModal = async (company?: any) => {
    setSelectedUsersCompany(company ?? null);
    setShowUsersModal(true);
    setLoadingUsers(true);
    try {
      const res = await api.listUsers(company?.id);
      setUsersList(res || []);
    } catch (e) {
      console.error('Erro ao listar usuarios', e);
      alert('Falha ao carregar usuarios. Veja o console.');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSuspendUser = async (id: string) => {
    confirmAction('Suspender este usuário?', async () => {
      try {
        await api.suspendUser(id);
        await openUsersModal();
        alert('Usuário suspenso.');
      } catch (e) {
        console.error(e);
        alert('Falha ao suspender usuário.');
      }
    });
  };

  const handleReactivateUser = async (id: string) => {
    confirmAction('Reativar este usuário?', async () => {
      try {
        await api.reactivateUser(id);
        await openUsersModal();
        alert('Usuário reativado.');
      } catch (e) {
        console.error(e);
        alert('Falha ao reativar usuário.');
      }
    });
  };

  const handleDeleteUser = async (id: string) => {
    confirmAction('Excluir este usuário e todos os seus dados? Esta ação é irreversível.', async () => {
      try {
        await api.deleteUser(id);
        await openUsersModal();
        alert('Usuário excluído.');
      } catch (e) {
        console.error(e);
        alert('Falha ao excluir usuário.');
      }
    });
  };

  const markPaymentAsPaid = async (paymentId: string) => {
    confirmAction('Marcar este pagamento como PAGO?', async () => {
      try {
        await api.markPaymentPaid(paymentId);
        await loadCompanies();
        // refresh invoiceCompany payments if modal open
        if (invoiceCompany) {
          const updated = (companies || []).find((c) => c.id === invoiceCompany.id);
          setInvoiceCompany(updated ?? null);
        }
        alert('Pagamento marcado como pago.');
      } catch (e) {
        console.error(e);
        alert('Falha ao marcar pagamento.');
      }
    });
  };

  const handleCreateCompanyUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) {
      alert('Preencha nome, e-mail e senha.');
      return;
    }

    if (currentUser?.role === 'SUPER' && !selectedUsersCompany) {
      alert('Selecione uma empresa antes de criar um usuário.');
      return;
    }

    try {
      await api.createCompanyUser({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        password: newUserPassword,
        role: newUserRole,
        active: newUserActive,
        companyId: selectedUsersCompany?.id
      });
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('CAIXA');
      setNewUserActive(true);
      await openUsersModal(selectedUsersCompany ?? undefined);
      alert('Usuário criado com sucesso.');
    } catch (e) {
      console.error(e);
      alert(`Falha ao criar usuário: ${(e as Error).message}`);
    }
  };

  const handleProfilePhotoSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setProfilePhoto(dataUrl);
      if (currentUser?.id) {
        localStorage.setItem(`profilePhoto_${currentUser.id}`, dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveStoreSettings = async () => {
    if (currentCompany?.id) {
      try {
        const response = await api.updateCompanyProfile({
          name: storeName,
          pixKey: storePixKey,
          cnpj: storeCnpj,
          phone: storePhone,
          address: storeAddress
        });
        setCurrentCompany(response.company);
        alert('Configurações salvas.');
        return;
      } catch (error) {
        console.error('Erro ao salvar configurações da empresa', error);
        alert('Falha ao salvar configurações da empresa. Veja o console.');
        return;
      }
    }

    localStorage.setItem('storeName', storeName);
    localStorage.setItem('storeCnpj', storeCnpj);
    localStorage.setItem('storeAddress', storeAddress);
    localStorage.setItem('storePhone', storePhone);
    alert('Configurações salvas.');
  };

  const submitPasswordChange = async () => {
    if (!newPassword || !confirmPassword) {
      return alert('Preencha a nova senha e a confirmação.');
    }

    if (newPassword !== confirmPassword) {
      return alert('A confirmação não corresponde.');
    }

    try {
      await api.changePassword(newPassword, confirmPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      alert('Senha alterada com sucesso.');
    } catch (e) {
      console.error(e);
      alert('Falha ao alterar senha.');
    }
  };

  const loadDailyReceipts = async () => {
    setLoadingReceipts(true);
    try {
      const receipts = await api.listDailyReceipts();
      setDailyReceipts(receipts || []);
    } catch (e) {
      console.error(e);
      alert('Falha ao carregar recibos do dia.');
    } finally {
      setLoadingReceipts(false);
    }
  };

  const searchReceiptByNumber = async () => {
    if (!searchReceiptNumber) {
      return alert('Informe o número do recibo.');
    }

    setLoadingReceipts(true);
    try {
      const receipt = await api.getReceiptByNumber(Number(searchReceiptNumber));
      if ('error' in receipt) {
        return alert(receipt.error);
      }
      setSelectedReceipt(receipt);
    } catch (e) {
      console.error(e);
      alert('Falha ao buscar recibo.');
    } finally {
      setLoadingReceipts(false);
    }
  };

  const submitEditModal = async () => {
    if (!selectedCompany) return;
    try {
      // update company
      await requestUpdateCompany(selectedCompany.id, {
        name: editName,
        email: editEmail,
        phone: editPhone,
        address: editAddress,
        monthlyFee: Number(editMonthlyFee.replace(',', '.')) || 0
      });

      // update admin user if present
      if (editAdminId) {
        const payload: any = { name: editAdminName, email: editAdminEmail };
        if (editAdminPassword && editAdminPassword.trim().length > 0) payload.password = editAdminPassword;
        await api.updateUser(editAdminId, payload);
      }

      await loadCompanies();
      setShowEditModal(false);
      alert('Empresa e usuário atualizados.');
    } catch (e) {
      console.error(e);
      alert('Falha ao atualizar empresa/usuario.');
    }
  };

  const requestUpdateCompany = async (companyId: string, payload: any) => {
    return api.updateCompanyAsSuperAdmin(companyId, payload);
  };

  const exportCompaniesCSV = () => {
    if (!companies || companies.length === 0) return alert('Nenhuma empresa para exportar.');
    const headers = ['id', 'name', 'email', 'cnpj', 'active', 'subscriptionStatus', 'expiresAt', 'monthlyFee'];
    const rows = companies.map((c) => headers.map((h) => JSON.stringify(c[h] ?? '')).join(','));
    const csv = `${headers.join(',')}\n${rows.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'companies.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCompaniesPdf = () => {
    if (!companies || companies.length === 0) return alert('Nenhuma empresa para exportar.');
    const html = `
      <html><head><meta charset="utf-8"><title>Empresas</title>
      <style>body{font-family:Arial,sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left}</style>
      </head><body>
      <h1>Empresas</h1>
      <table><thead><tr><th>Empresa</th><th>Email</th><th>CNPJ</th><th>Status</th><th>Expira</th><th>Mensalidade</th></tr></thead><tbody>
      ${companies
        .map((c) => `<tr><td>${c.name}</td><td>${c.email}</td><td>${c.cnpj}</td><td>${c.active ? 'Ativa' : 'Inativa'}</td><td>${c.expiresAt ?? ''}</td><td>${c.monthlyFee ?? 0}</td></tr>`)
        .join('')}
      </tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return alert('Bloqueador de janelas impediu a abertura.');
    w.document.write(html);
    w.document.close();
    // give the window a moment to render then print
    setTimeout(() => { w.print(); }, 500);
  };

  const menuTable = useMemo(
    () => (menuTableId ? tables.find((table) => table.id === menuTableId) ?? null : null),
    [menuTableId, tables]
  );

  const selectedTableOrders = useMemo(
    () => orders.filter((order) => order.tableId === selectedTable?.id && order.tabStatus === 'ABERTA'),
    [orders, selectedTable]
  );

  const groupedMenuSections = useMemo(() => {
    const sections: Record<string, Product[]> = {
      Shawarmas: [],
      Pasteis: [],
      Cuscuz: [],
      Espaguete: [],
      Bebidas: [],
      Outros: []
    };

    products.forEach((product) => {
      const name = product.name.toLowerCase();
      if (name.includes('shawarma')) {
        sections['Shawarmas']?.push(product);
      } else if (name.includes('pastel')) {
        sections['Pasteis']?.push(product);
      } else if (name.includes('cuscuz')) {
        sections['Cuscuz']?.push(product);
      } else if (name.includes('espaguete') || name.includes('espaguete')) {
        sections['Espaguete']?.push(product);
      } else if (name.includes('refrigerante') || name.includes('suco') || name.includes('bebida') || name.includes('água') || name.includes('agua') || name.includes('cerveja')) {
        sections['Bebidas']?.push(product);
      } else {
        sections['Outros']?.push(product);
      }
    });

    return sections;
  }, [products]);

  const openTableMenuModal = (table: RestaurantTable) => {
    setSelectedTableId(table.id);
    setMenuModalTable(table);
  };

  const closeTableMenuModal = () => setMenuModalTable(null);

  const addProductToMenuCart = (product: Product) => {
    setMenuCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1, note: '' }];
    });
  };

  const updateMenuCartItem = (productId: string, updates: Partial<{ quantity: number; note: string }>) => {
    setMenuCart((prev) =>
      prev
        .map((item) =>
          item.product.id === productId ? { ...item, ...updates } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeMenuCartItem = (productId: string) => {
    setMenuCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const submitMenuOrder = async () => {
    if (!menuTableId) {
      alert('Mesa não encontrada.');
      return;
    }
    if (menuCart.length === 0) {
      alert('Adicione itens ao pedido antes de enviar.');
      return;
    }

    try {
      await api.createOrder(menuTableId, menuCart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        note: item.note || undefined
      })));
      alert('Pedido enviado com sucesso!');
      setMenuCart([]);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao enviar pedido', error);
      alert('Falha ao enviar o pedido.');
    }
  };

  const openTabs = useMemo(() => {
    const grouped = new Map<string, {
      tabId: string;
      tableId: string;
      tableName: string;
      orders: Order[];
    }>();

    orders
      .filter((order) => order.tabStatus === 'ABERTA')
      .forEach((order) => {
        const key = order.tabId ?? order.tableId;
        const existing = grouped.get(key);
        if (existing) {
          existing.orders.push(order);
        } else {
          grouped.set(key, {
            tabId: order.tabId ?? order.tableId,
            tableId: order.tableId,
            tableName: order.tableName,
            orders: [order]
          });
        }
      });

    return Array.from(grouped.values());
  }, [orders]);

  const getMenuLinkForTable = (table: RestaurantTable) => {
    const baseUrl = window.location.protocol === 'file:' ? 'http://127.0.0.1:5173' : window.location.origin;
    return `${baseUrl}${window.location.pathname}?tableId=${encodeURIComponent(table.id)}`;
  };

  const getQrCodeSrc = (url: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`;

  const formatPixField = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

  const computeCrc16 = (value: string) => {
    let crc = 0xffff;
    for (let i = 0; i < value.length; i += 1) {
      crc ^= value.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j += 1) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      }
    }
    return crc & 0xffff;
  };

  const getPixBrCode = (pixKey: string, amount: number, txid: string, merchantName: string, merchantCity: string) => {
    const sanitizedMerchantName = merchantName.trim().substring(0, 25).toUpperCase();
    const sanitizedMerchantCity = merchantCity.trim().substring(0, 15).toUpperCase() || 'SAO PAULO';
    const txidValue = txid.replace(/[^A-Za-z0-9]/g, '').substring(0, 25) || '***';
    const payloadWithoutCrc = [
      formatPixField('00', '01'),
      formatPixField('01', '11'),
      formatPixField('26', `${formatPixField('00', 'BR.GOV.BCB.PIX')}${formatPixField('01', pixKey)}`),
      formatPixField('52', '0000'),
      formatPixField('53', '986'),
      formatPixField('54', amount.toFixed(2)),
      formatPixField('58', 'BR'),
      formatPixField('59', sanitizedMerchantName),
      formatPixField('60', sanitizedMerchantCity),
      formatPixField('62', formatPixField('05', txidValue)),
      '6304'
    ].join('');

    const crc = computeCrc16(payloadWithoutCrc);
    return `${payloadWithoutCrc}${crc.toString(16).toUpperCase().padStart(4, '0')}`;
  };

  const openQrModal = (table: RestaurantTable) => {
    const url = getMenuLinkForTable(table);
    setQrUrl(url);
    setQrModalTable(table);
  };

  const closeQrModal = () => setQrModalTable(null);

  const todaySummary = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const todayOrders = orders.filter((order) => {
      const createdAt = new Date(order.createdAt);
      return createdAt >= startOfDay && createdAt < endOfDay;
    });

    return {
      count: todayOrders.length,
      totalValue: todayOrders.reduce(
        (sum, order) => sum + order.items.reduce((itemsSum, item) => itemsSum + item.quantity * item.unitPrice, 0),
        0
      )
    };
  }, [orders]);

  const totalOpenOrders = useMemo(
    () => orders
      .filter((order) => order.tabStatus === 'ABERTA')
      .reduce((sum, order) => sum + order.items.reduce((itemsSum, item) => itemsSum + item.quantity * item.unitPrice, 0), 0),
    [orders]
  );

  // Estado para modal de fechamento de mesa
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closePaymentMethod, setClosePaymentMethod] = useState('DINHEIRO');
  const [closePaidValue, setClosePaidValue] = useState('');
  const [cashRegister, setCashRegister] = useState<{
    id: string;
    status: string;
    openedAt: string;
    closedAt: string | null;
    initialAmount: number;
    closingAmount: number | null;
    openedBy: string;
    closedBy: string | null;
    paymentsCount: number;
    totalPayments: number;
  } | null>(null);
  const [currentCashClosingAmount, setCurrentCashClosingAmount] = useState('');
  const [initialCashAmount, setInitialCashAmount] = useState('100.00');
  const [reportSummary, setReportSummary] = useState<{
    period: string;
    periodLabel: string;
    startDate: string;
    endDate: string;
    totalOrders: number;
    totalItems: number;
    totalValue: number;
    tables: Array<{
      tableId: string;
      tableName: string;
      orders: Array<any>;
      totalValue: number;
      totalItems: number;
    }>;
  } | null>(null);

  const openCloseModal = () => setShowCloseModal(true);
  const [pixQrUrl, setPixQrUrl] = useState<string | null>(null);
  const [pixPayload, setPixPayload] = useState<string | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [pixPaymentStatus, setPixPaymentStatus] = useState<string | null>(null);
  const [pixAmount, setPixAmount] = useState<number | null>(null);
  const [pixPendingTabId, setPixPendingTabId] = useState<string | null>(null);
  const [showPixModal, setShowPixModal] = useState(false);

  const closeCloseModal = () => {
    setShowCloseModal(false);
    setPixQrUrl(null);
    setPixPayload(null);
    setPixPaymentId(null);
    setPixPaymentStatus(null);
    setPixAmount(null);
    setPixPendingTabId(null);
    setShowPixModal(false);
  };

  const finishPixClose = async (tabId: string, total: number) => {
    try {
      const closeResult = await api.closeTab(tabId, 'PIX', total);
      const tableOrders = selectedTableOrders;
      const map = new Map<string, { quantity: number; unitPrice: number }>();
      for (const o of tableOrders) {
        for (const it of o.items) {
          const prev = map.get(it.productName);
          if (prev) prev.quantity += it.quantity;
          else map.set(it.productName, { quantity: it.quantity, unitPrice: it.unitPrice });
        }
      }
      const items = Array.from(map.entries()).map(([name, v]) => ({ name, quantity: v.quantity, unitPrice: v.unitPrice, total: v.quantity * v.unitPrice }));
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const totalValue = subtotal;
      printReceipt({
        companyName: storeName,
        cnpj: storeCnpj ? `CNPJ: ${storeCnpj}` : undefined,
        address: storeAddress,
        phone: storePhone,
        receiptNumber: closeResult?.receiptNumber,
        tableName: selectedTable?.name ?? '',
        items,
        subtotal,
        total: totalValue,
        paid: total,
        change: 0,
        paymentMethod: 'PIX'
      });
      await reloadTablesAndOrders();
      setShowPixModal(false);
      setShowCloseModal(false);
      setPixPaymentStatus('PAGO');
    } catch (err) {
      console.error('Erro ao fechar comanda após Pix', err);
      alert('Erro ao encerrar comanda: ' + ((err as any)?.message ?? String(err)));
    }
  };

  const startPixPayment = async (tabId: string, total: number) => {
    try {
      const response = await api.initiatePixPayment(tabId, total);
      setPixPaymentId(response.paymentId);
      setPixPaymentStatus('PENDENTE');
      setPixAmount(response.amount);
      setPixPendingTabId(tabId);
      const payload = getPixBrCode(storePixKey, response.amount, response.paymentId ?? tabId, storeName, storeAddress || 'SAO PAULO');
      setPixPayload(payload);
      setPixQrUrl(getQrCodeSrc(payload));
      setShowPixModal(true);
    } catch (err) {
      console.error('Erro ao iniciar pagamento PIX', err);
      alert('Falha ao iniciar pagamento PIX: ' + ((err as any)?.message ?? String(err)));
    }
  };

  const handleConfirmClose = async () => {
    if (!selectedTable) return;
    try {
      const tableOrders = selectedTableOrders;
      if (tableOrders.length === 0) {
        return alert('Não há comanda aberta para esta mesa.');
      }

      const tabId = tableOrders[0]?.tabId;
      if (!tabId) {
        return alert('Comanda sem identificação válida.');
      }

      const map = new Map<string, { quantity: number; unitPrice: number }>();
      for (const o of tableOrders) {
        for (const it of o.items) {
          const prev = map.get(it.productName);
          if (prev) prev.quantity += it.quantity;
          else map.set(it.productName, { quantity: it.quantity, unitPrice: it.unitPrice });
        }
      }

      const items = Array.from(map.entries()).map(([name, v]) => ({ name, quantity: v.quantity, unitPrice: v.unitPrice, total: v.quantity * v.unitPrice }));
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const total = subtotal;

      const paid = Number(closePaidValue.replace(',', '.')) || undefined;
      const change = paid != null && !Number.isNaN(paid) ? paid - total : undefined;

      if (closePaymentMethod === 'PIX') {
        await startPixPayment(tabId, total);
        return;
      }

      const closeResult = await api.closeTab(tabId, closePaymentMethod, paid);

      printReceipt({
        companyName: storeName,
        cnpj: storeCnpj ? `CNPJ: ${storeCnpj}` : undefined,
        address: storeAddress,
        phone: storePhone,
        receiptNumber: closeResult?.receiptNumber,
        tableName: selectedTable.name,
        items,
        subtotal,
        total,
        paid,
        change,
        paymentMethod: closePaymentMethod
      });

      await reloadTablesAndOrders();
      setShowCloseModal(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao encerrar mesa', err);
      alert('Erro ao encerrar mesa. Veja o console.');
    }
  };

  const exportReportPdf = async () => {
    if (!reportSummary) {
      return alert('Relatório ainda não foi carregado.');
    }
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Relatório ${reportSummary.periodLabel}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
            h1, h2, h3 { margin: 0 0 12px; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
            .summary-card { padding: 14px 16px; border: 1px solid #ddd; border-radius: 10px; }
            .summary-card strong { display: block; margin-bottom: 6px; }
            .table-list { width: 100%; border-collapse: collapse; margin-top: 16px; }
            .table-list th, .table-list td { padding: 10px 12px; border: 1px solid #ddd; }
            .table-list th { background: #f7f7f7; text-align: left; }
            .footer { margin-top: 26px; font-size: 13px; color: #555; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1>Relatório ${reportSummary.periodLabel}</h1>
              <div>${new Date(reportSummary.startDate).toLocaleDateString()} — ${new Date(reportSummary.endDate).toLocaleDateString()}</div>
            </div>
          </div>
          <div class="summary">
            <div class="summary-card"><strong>Pedidos</strong><span>${reportSummary.totalOrders}</span></div>
            <div class="summary-card"><strong>Itens vendidos</strong><span>${reportSummary.totalItems}</span></div>
            <div class="summary-card"><strong>Faturamento</strong><span>${formatCurrency(reportSummary.totalValue)}</span></div>
          </div>
          <table class="table-list">
            <thead>
              <tr>
                <th>Mesa</th>
                <th>Itens</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              ${reportSummary.tables.map((table) => `
                <tr>
                  <td>${table.tableName}</td>
                  <td>${table.totalItems}</td>
                  <td>${formatCurrency(table.totalValue)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="footer">Gerado em ${new Date().toLocaleString()}</div>
        </body>
      </html>
    `;

    if (!window.sistema?.saveReportPdf) {
      console.warn('API de PDF indisponível: window.sistema.saveReportPdf não encontrada, usando fallback de navegador');
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const popup = window.open(url, '_blank');
      if (!popup) {
        return alert('Exportação de PDF não está disponível no ambiente atual e a abertura de nova janela foi bloqueada pelo navegador.');
      }
      popup.focus();
      try {
        popup.print();
      } catch (e) {
        // ignore
      }
      // revoke after a short delay to allow the popup to load
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }

    try {
      const result = await window.sistema.saveReportPdf(html);
      if (result.canceled) {
        return;
      }
      alert(`Relatório salvo em ${result.filePath}`);
    } catch (error) {
      console.error('Erro ao exportar PDF', error);
      alert('Falha ao gerar o arquivo PDF. Veja o console.');
    }
  };

  const previewReportPdf = async () => {
    if (!reportSummary) {
      return alert('Relatório ainda não foi carregado.');
    }

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Relatório ${reportSummary.periodLabel}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
            h1, h2, h3 { margin: 0 0 12px; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
            .summary-card { padding: 14px 16px; border: 1px solid #ddd; border-radius: 10px; }
            .summary-card strong { display: block; margin-bottom: 6px; }
            .table-list { width: 100%; border-collapse: collapse; margin-top: 16px; }
            .table-list th, .table-list td { padding: 10px 12px; border: 1px solid #ddd; }
            .table-list th { background: #f7f7f7; text-align: left; }
            .footer { margin-top: 26px; font-size: 13px; color: #555; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1>Relatório ${reportSummary.periodLabel}</h1>
              <div>${new Date(reportSummary.startDate).toLocaleDateString()} — ${new Date(reportSummary.endDate).toLocaleDateString()}</div>
            </div>
          </div>
          <div class="summary">
            <div class="summary-card"><strong>Pedidos</strong><span>${reportSummary.totalOrders}</span></div>
            <div class="summary-card"><strong>Itens vendidos</strong><span>${reportSummary.totalItems}</span></div>
            <div class="summary-card"><strong>Faturamento</strong><span>${formatCurrency(reportSummary.totalValue)}</span></div>
          </div>
          <table class="table-list">
            <thead>
              <tr>
                <th>Mesa</th>
                <th>Itens</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              ${reportSummary.tables.map((table) => `
                <tr>
                  <td>${table.tableName}</td>
                  <td>${table.totalItems}</td>
                  <td>${formatCurrency(table.totalValue)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="footer">Gerado em ${new Date().toLocaleString()}</div>
        </body>
      </html>
    `;

    if (!window.sistema?.previewReportPdf) {
      console.warn('API de PDF indisponível: window.sistema.previewReportPdf não encontrada, usando fallback de navegador');
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const popup = window.open(url, '_blank');
      if (!popup) {
        return alert('Visualização de PDF não está disponível no ambiente atual e a abertura de nova janela foi bloqueada pelo navegador.');
      }
      popup.focus();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }

    try {
      const result = await window.sistema.previewReportPdf(html);
      if (result.canceled) {
        return;
      }
    } catch (error) {
      console.error('Erro ao pré-visualizar PDF', error);
      alert('Falha ao visualizar o PDF. Veja o console.');
    }
  };

  // Função para obter a classe CSS e o status visual da mesa
  const getTableStateClass = (table: RestaurantTable): string => {
    const statusMap: Record<string, string> = {
      LIVRE: 'livre',
      AMARELO: 'amarelo',
      VERMELHO: 'vermelho'
    };
    return statusMap[table.status] || table.status.toLowerCase();
  };

  // Retorna o texto de status a ser exibido na tile da mesa
  const getTableDisplayStatus = (table: RestaurantTable): string => {
    return tableStatusLabel[table.status] || table.status;
  };

  // Check if user is already logged in (session persisted by Supabase)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        api.me().then((response) => {
          if (response.user) {
            setCurrentUser(response.user);
            setCurrentCompany(response.company ?? null);
            setIsAuthenticated(true);
          }
        }).catch(() => {
          // session exists but user load failed — stay on login screen
        });
      }
    });
  }, []);

  // Listen for unauthorized events emitted by the API layer (e.g. token expired or invalid)
  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setCurrentCompany(null);
      // notify user to re-login
      try {
        alert('Sessão expirada. Faça login novamente.');
      } catch (err) {
        // ignore in non-browser env
      }
    };

    window.addEventListener('sistema:unauthorized', onUnauthorized as EventListener);
    return () => window.removeEventListener('sistema:unauthorized', onUnauthorized as EventListener);
  }, []);

  // Close action menu when clicking outside
  useEffect(() => {
    if (!openActionMenuId) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside the menu container
      const menuElement = document.querySelector(`[data-action-menu-id="${openActionMenuId}"]`);
      if (menuElement && !menuElement.contains(target)) {
        setOpenActionMenuId(null);
      }
    };
    
    // Use a small timeout to avoid catching the same click that opened the menu
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [openActionMenuId]);

  // Ensure SUPER users land on the cadastros module and avoid flashes of PDV
  useEffect(() => {
    if (currentUser?.role) {
      const allowedModules = getAllowedModules(currentUser.role);
      if (!allowedModules.includes(activeModule)) {
        setActiveModule(allowedModules[0] ?? 'mesas');
      }
    }
  }, [isAuthenticated, currentUser]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      const result = await api.login(loginEmail, loginPassword);
      
      if ('error' in result) {
        setLoginError(result.error);
      } else if (result.user && result.accessToken) {
        setCurrentUser(result.user);
        setCurrentCompany(result.company ?? null);
        setIsAuthenticated(true);
        setLoginEmail('');
        setLoginPassword('');
        const allowedModules = getAllowedModules(result.user.role);
        setActiveModule(allowedModules[0] ?? 'mesas');
      }
    } catch (error) {
      setLoginError('Erro ao conectar com a API');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const role = currentUser?.role;
  const hasReportAccess = role ? ['CAIXA', 'FINANCEIRO', 'GERENTE', 'SUPER', 'ADMIN'].includes(role) : false;

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
    setIsAuthenticated(false);
    setCurrentUser(null);
    setLoginEmail('');
    setLoginPassword('');
  };

  // Recarrega apenas mesas + pedidos (mais frequente — após criar/fechar pedido)
  const reloadTablesAndOrders = async () => {
    const hasOrdersAccess = role ? ['GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'ESTOQUE', 'SUPER', 'ADMIN'].includes(role) : false;
    const hasKitchenAccess = role ? ['COZINHA', 'CAIXA', 'GERENTE', 'SUPER', 'ADMIN'].includes(role) : false;

    const [tablesResult, ordersResult, kitchenResult] = await Promise.allSettled([
      api.tables(),
      hasOrdersAccess ? api.orders() : Promise.resolve([] as Order[]),
      hasKitchenAccess ? api.kitchenQueue() : Promise.resolve([] as Order[]),
    ]);

    if (tablesResult.status === 'fulfilled') setTables(tablesResult.value);
    if (ordersResult.status === 'fulfilled') setOrders(ordersResult.value);
    if (kitchenResult.status === 'fulfilled') setKitchenOrders(kitchenResult.value);
  };

  const loadData = async () => {
    const hasKitchenAccess = role ? ['COZINHA', 'CAIXA', 'GERENTE', 'SUPER', 'ADMIN'].includes(role) : false;
    const hasCashAccess = role ? ['CAIXA', 'FINANCEIRO', 'GERENTE', 'SUPER', 'ADMIN'].includes(role) : false;
    const hasOrdersAccess = role ? ['GARCOM', 'CAIXA', 'GERENTE', 'FINANCEIRO', 'ESTOQUE', 'SUPER', 'ADMIN'].includes(role) : false;

    try {
      const [tablesResult, productsResult, ordersResult, kitchenResult, cashResult, reportResult] = await Promise.allSettled([
        api.tables(),
        api.products(),
        hasOrdersAccess ? api.orders() : Promise.resolve([] as Order[]),
        hasKitchenAccess ? api.kitchenQueue() : Promise.resolve([] as Order[]),
        hasCashAccess ? api.cashRegisterCurrent() : Promise.resolve(null),
        hasReportAccess ? api.reportSummary(reportPeriod) : Promise.resolve(null)
      ]);

      setApiStatus('online');
      if (tablesResult.status === 'fulfilled') setTables(tablesResult.value);
      if (productsResult.status === 'fulfilled') setProducts(productsResult.value);
      if (ordersResult.status === 'fulfilled') setOrders(ordersResult.value);
      if (kitchenResult.status === 'fulfilled') setKitchenOrders(kitchenResult.value);
      if (cashResult.status === 'fulfilled') setCashRegister(cashResult.value ?? null);
      if (reportResult.status === 'fulfilled') setReportSummary(reportResult.value ?? null);
    } catch {
      setApiStatus('offline');
    }
  };

  const loadSuperReports = async () => {
    setLoadingReport(true);
    try {
      const companyIdParam = selectedReportCompany !== 'all' ? selectedReportCompany : undefined;
      
      const [revenue, ticketAvg, topProducts, paymentMethods, userActivity, auditLog, subscriptions, pendingPayments, health, lowPerf, hourlyPeaks] = await Promise.allSettled([
        api.fetch('reports/super/revenue', { period: reportPeriod, ...(companyIdParam && { companyId: companyIdParam }) }),
        api.fetch('reports/super/ticket-average', companyIdParam ? { companyId: companyIdParam } : {}),
        api.fetch('reports/super/top-products', { limit: '10', ...(companyIdParam && { companyId: companyIdParam }) }),
        api.fetch('reports/super/payment-methods', companyIdParam ? { companyId: companyIdParam } : {}),
        api.fetch('reports/super/user-activity', companyIdParam ? { companyId: companyIdParam } : {}),
        api.fetch('reports/super/audit-log', { limit: '100', ...(companyIdParam && { companyId: companyIdParam }) }),
        api.fetch('reports/super/subscriptions'),
        api.fetch('reports/super/pending-payments'),
        api.fetch('reports/super/health'),
        api.fetch('reports/super/low-performance-products', { minQuantity: '5', ...(companyIdParam && { companyId: companyIdParam }) }),
        api.fetch('reports/super/hourly-peaks', companyIdParam ? { companyId: companyIdParam } : {})
      ]);

      if (revenue.status === 'fulfilled') setRevenueReport(revenue.value);
      if (ticketAvg.status === 'fulfilled') setTicketAverageReport(ticketAvg.value);
      if (topProducts.status === 'fulfilled') setTopProductsReport(topProducts.value);
      if (paymentMethods.status === 'fulfilled') setPaymentMethodsReport(paymentMethods.value);
      if (userActivity.status === 'fulfilled') setUserActivityReport(userActivity.value);
      if (auditLog.status === 'fulfilled') setAuditLogReport(auditLog.value);
      if (subscriptions.status === 'fulfilled') setSubscriptionReport(subscriptions.value);
      if (pendingPayments.status === 'fulfilled') setPendingPaymentsReport(pendingPayments.value);
      if (health.status === 'fulfilled') setHealthReport(health.value);
      if (lowPerf.status === 'fulfilled') setLowPerformanceReport(lowPerf.value);
      if (hourlyPeaks.status === 'fulfilled') setHourlyPeaksReport(hourlyPeaks.value);
    } catch (error) {
      console.error('Erro ao carregar relatórios:', error);
    } finally {
      setLoadingReport(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      if (currentUser?.role === 'SUPER') {
        // For SUPER users avoid loading PDV data; just check health and defer company loading to cadastros view
        api.health().then((h) => setApiStatus(h.status === 'ok' ? 'online' : 'offline')).catch(() => setApiStatus('offline'));
        if (activeModule === 'financeiro') {
          void loadSuperReports();
        } else if (activeModule === 'usuarios' || activeModule === 'cadastros') {
          void loadCompanies();
        }
      } else {
        void loadData().catch(() => {
          // keep API status from health only; optional role-limited endpoints may reject without making the app offline
        });
      }
    }
  }, [isAuthenticated, reportPeriod, currentUser, activeModule, selectedReportCompany]);

  const createOrder = async (productId: string) => {
    if (!selectedTable) {
      return;
    }

    await api.createOrder(selectedTable.id, [{ productId, quantity: 1 }]);
    await reloadTablesAndOrders();
  };

  const advanceOrder = async (order: Order) => {
    try {
      const nextStatus = order.status === 'ENVIADO' ? 'EM_PREPARO' : order.status === 'EM_PREPARO' ? 'PRONTO' : 'ENTREGUE';
      await api.updateOrderStatus(order.id, nextStatus);
      await reloadTablesAndOrders();
    } catch (err: any) {
      alert('Erro ao avançar pedido: ' + (err?.message ?? String(err)));
    }
  };

  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedPrice = Number(newProductPrice.replace(',', '.'));

    if (!newProductName.trim() || Number.isNaN(normalizedPrice) || normalizedPrice <= 0) {
      return;
    }

    await api.createProduct({
      name: newProductName,
      description: newProductDescription,
      price: normalizedPrice,
      preparationMinutes: Number(newProductPreparationMinutes || 0)
    });

    setNewProductName('');
    setNewProductDescription('');
    setNewProductPrice('');
    setNewProductPreparationMinutes('10');
    await loadData();
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <main className="app-shell login-screen">
        <div style={{
          background: '#eef2ef'
        }}>
          <div style={{
            width: 'min(400px, calc(100vw - 32px))',
            background: '#ffffff',
            border: '1px solid #dbe3de',
            borderRadius: '8px',
            padding: '40px'
          }}>
            <div style={{ marginBottom: '24px', textAlign: 'center' }}>
              <div style={{
                width: '48px',
                height: '48px',
                background: '#f1c44e',
                borderRadius: '8px',
                display: 'grid',
                placeItems: 'center',
                fontSize: '24px',
                fontWeight: 'bold',
                margin: '0 auto 16px'
              }}>
                S
              </div>
              <h1 style={{ margin: '0 0 8px', fontSize: '28px', color: '#18201d' }}>Integra360</h1>
              <p style={{ margin: '0', color: '#52625b' }}>Operacao local</p>
            </div>

            <form onSubmit={handleLogin} style={{ display: 'grid', gap: '16px' }}>
              <div>
                <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: '#18201d' }}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="super@sistema.local"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #dbe3de',
                    borderRadius: '4px',
                    fontFamily: 'inherit'
                  }}
                  disabled={isLoggingIn}
                />
              </div>

              <div>
                <label htmlFor="password" style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: '#18201d' }}>
                  Senha
                </label>
                <input
                  id="password"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="admin"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #dbe3de',
                    borderRadius: '4px',
                    fontFamily: 'inherit'
                  }}
                  disabled={isLoggingIn}
                />
              </div>

              {loginError && (
                <div style={{
                  background: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '4px',
                  padding: '10px',
                  color: '#c33'
                }}>
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                style={{
                  background: '#f1c44e',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '12px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                  opacity: isLoggingIn ? 0.6 : 1
                }}
              >
                {isLoggingIn ? 'Conectando...' : 'Conectar'}
              </button>
            </form>

            <p style={{ fontSize: '12px', color: '#52625b', marginTop: '16px', textAlign: 'center' }}>
              Demo: use super@sistema.local / Herick159@
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Menu mode for customer QR access
  if (activeModule === 'menu' && !currentUser) {
    return (
      <main className="app-shell menu-mode">
        <section className="workspace" style={{ minHeight: '100vh', padding: '20px' }}>
          <header className="topbar" style={{ justifyContent: 'center' }}>
            <div>
              <span className="eyebrow">Menu Interativo</span>
              <h1>{menuTable ? `Mesa ${menuTable.name}` : 'Mesa não encontrada'}</h1>
            </div>
          </header>
          <section className="content-grid" style={{ gridTemplateColumns: '1fr', gap: 20, marginTop: 20 }}>
            <div className="panel">
              {!menuTable ? (
                <div style={{ padding: 24 }}>
                  <p>Link inválido ou mesa não encontrada.</p>
                </div>
              ) : (
                <div className="product-list">
                  {products.map((product) => (
                    <div key={product.id} className="product-row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <strong>{product.name}</strong>
                        <small>{product.description}</small>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong>{formatCurrency(product.price)}</strong>
                        <button type="button" className="secondary-button" onClick={() => addProductToMenuCart(product)}>
                          Adicionar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Seu pedido</span>
                  <h2>Resumo</h2>
                </div>
              </div>
              {menuCart.length === 0 ? (
                <div style={{ padding: 24 }}>
                  <p>Adicione itens para montar seu pedido.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {menuCart.map((item) => (
                    <div key={item.product.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{item.product.name}</strong>
                          <div style={{ fontSize: 12, color: '#666' }}>{formatCurrency(item.product.price)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button type="button" className="secondary-button" onClick={() => updateMenuCartItem(item.product.id, { quantity: item.quantity - 1 })}>-</button>
                          <span>{item.quantity}</span>
                          <button type="button" className="secondary-button" onClick={() => updateMenuCartItem(item.product.id, { quantity: item.quantity + 1 })}>+</button>
                        </div>
                      </div>
                      <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                        Observação
                        <textarea
                          rows={2}
                          value={item.note}
                          onChange={(event) => updateMenuCartItem(item.product.id, { note: event.target.value })}
                          placeholder="Sem cebola, sem lactose..."
                          style={{ width: '100%' }}
                        />
                      </label>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#555' }}>
                        <span>Subtotal</span>
                        <strong>{formatCurrency(item.quantity * item.product.price)}</strong>
                      </div>
                      <button type="button" className="secondary-button" style={{ width: '100%', marginTop: 10 }} onClick={() => removeMenuCartItem(item.product.id)}>
                        Remover
                      </button>
                    </div>
                  ))}
                  <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span>Total</span>
                      <strong>{formatCurrency(menuCart.reduce((sum, item) => sum + item.quantity * item.product.price, 0))}</strong>
                    </div>
                    <button type="button" className="primary-button" onClick={() => void submitMenuOrder()}>
                      Enviar pedido
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </section>
      </main>
    );
  }

  // Main app screen
  return (
    <main className="app-shell authenticated">
      {showCloseModal && selectedTable && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 60 }}>
          <div style={{ width: 'min(560px, 92%)', background: '#fff', borderRadius: 8, padding: 20 }}>
            <h3>Fechar comanda - {selectedTable.name}</h3>
            <div style={{ maxHeight: '50vh', overflow: 'auto', marginBottom: 12 }}>
              {/* Lista de itens agregados */}
              {(() => {
                const tableOrders = selectedTableOrders;
                const map = new Map<string, { quantity: number; unitPrice: number }>();
                for (const o of tableOrders) for (const it of o.items) {
                  const prev = map.get(it.productName);
                  if (prev) prev.quantity += it.quantity;
                  else map.set(it.productName, { quantity: it.quantity, unitPrice: it.unitPrice });
                }
                const items = Array.from(map.entries()).map(([name, v]) => ({ name, quantity: v.quantity, unitPrice: v.unitPrice, total: v.quantity * v.unitPrice }));
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                        <th>Produto</th>
                        <th style={{ width: 80 }}>Qtd</th>
                        <th style={{ width: 120 }}>V. Unit</th>
                        <th style={{ width: 120 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.name} style={{ borderBottom: '1px solid #f4f4f4' }}>
                          <td>{it.name}</td>
                          <td>{it.quantity}</td>
                          <td>{formatCurrency(it.unitPrice)}</td>
                          <td>{formatCurrency(it.total)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={3} style={{ fontWeight: 700 }}>TOTAL</td>
                        <td style={{ fontWeight: 700 }}>{formatCurrency(items.reduce((s, i) => s + i.total, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                Forma de pagamento
                <select value={closePaymentMethod} onChange={(e) => setClosePaymentMethod(e.target.value)}>
                  <option value="DINHEIRO">Dinheiro</option>
                  <option value="CREDITO">Cartão Crédito</option>
                  <option value="DEBITO">Cartão Débito</option>
                  <option value="PIX">PIX</option>
                  <option value="VOUCHER">Voucher</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', width: 180 }}>
                Valor pago
                <input value={closePaidValue} onChange={(e) => setClosePaidValue(e.target.value)} placeholder="0.00" />
              </label>
            </div>

            {closePaymentMethod === 'PIX' && storePixKey && (() => {
              const tableOrders = selectedTableOrders;
              const map = new Map<string, { quantity: number; unitPrice: number }>();
              for (const o of tableOrders) for (const it of o.items) {
                const prev = map.get(it.productName);
                if (prev) prev.quantity += it.quantity;
                else map.set(it.productName, { quantity: it.quantity, unitPrice: it.unitPrice });
              }
              const items = Array.from(map.entries()).map(([name, v]) => ({ name, quantity: v.quantity, unitPrice: v.unitPrice, total: v.quantity * v.unitPrice }));
              const total = items.reduce((s, i) => s + i.total, 0);
              const tabId = tableOrders[0]?.tabId ?? '';

              return (
                <div style={{ marginBottom: 12 }}>
                  <strong>PIX disponível:</strong>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <button type="button" className="secondary-button" onClick={() => {
                      const payload = getPixBrCode(storePixKey, total, tabId, storeName, storeAddress || 'SÃO PAULO');
                      setPixPayload(payload);
                      setPixQrUrl(getQrCodeSrc(payload));
                      setShowPixModal(true);
                    }}>
                      Abrir QR PIX ({formatCurrency(total)})
                    </button>
                    <button type="button" className="secondary-button" onClick={() => {
                      const payload = getPixBrCode(storePixKey, total, tabId, storeName, storeAddress || 'SÃO PAULO');
                      navigator.clipboard.writeText(payload);
                      alert('Payload PIX copiado.');
                    }}>
                      Copiar payload
                    </button>
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="secondary-button" onClick={() => closeCloseModal()}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void handleConfirmClose()}>Confirmar e Encerrar</button>
            </div>
          </div>
        </div>
      )}

      {qrModalTable && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 65 }} onClick={closeQrModal}>
          <div style={{ width: 'min(360px, 92%)', background: '#fff', borderRadius: 8, padding: 20, textAlign: 'center' }} onClick={(event) => event.stopPropagation()}>
            <h3>QR Code - {qrModalTable.name}</h3>
            <p style={{ fontSize: 12, marginTop: 8, marginBottom: 12 }}>
              Aponte o QR code para abrir o menu desta mesa.
            </p>
            <img
              src={getQrCodeSrc(qrUrl)}
              alt={`QR code da mesa ${qrModalTable.name}`}
              style={{ width: 260, height: 260, marginBottom: 12 }}
            />
            <div style={{ wordBreak: 'break-word', fontSize: 11, marginBottom: 12 }}>{qrUrl}</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  navigator.clipboard.writeText(qrUrl);
                  alert('Link do QR code copiado.');
                }}
              >
                Copiar link
              </button>
              <button type="button" className="secondary-button" onClick={closeQrModal}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      {showPixModal && pixPayload && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 80 }}>
          <div style={{ width: 'min(420px, 96%)', background: '#fff', borderRadius: 8, padding: 20, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <h3>Pagamento PIX</h3>
            <p style={{ fontSize: 13 }}>Apresente o QR code ao cliente. Após confirmar o recebimento no seu banco, clique em <strong>Confirmar PIX recebido</strong>.</p>
            <div style={{ marginTop: 12 }}>
              <img src={pixQrUrl ?? undefined} alt="PIX QR" style={{ width: 260, height: 260 }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 11, wordBreak: 'break-word', color: '#666' }}>{pixPayload}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  if (pixPendingTabId && pixAmount != null) {
                    void finishPixClose(pixPendingTabId, pixAmount);
                  }
                }}
              >
                Confirmar PIX recebido
              </button>
              <button type="button" className="secondary-button" onClick={() => {
                navigator.clipboard.writeText(pixPayload ?? '');
                alert('Payload PIX copiado.');
              }}>Copiar Pix Copia e Cola</button>
              <button type="button" className="secondary-button" onClick={() => setShowPixModal(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong>Integra360</strong>
            <span>{currentUser?.name}</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Principal">
          {getNavItems(currentUser?.role).map((item) => {
            const Icon = item.icon;

            return (
              <button
                className={`nav-item ${activeModule === item.id ? 'active' : ''}`}
                key={item.id}
                type="button"
                onClick={() => setActiveModule(item.id)}
              >
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </nav>

        <button className="logout-button" type="button" onClick={handleLogout}><LogOut size={18} /> Sair</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{moduleConfig[activeModule].eyebrow}</span>
            <h1>{moduleConfig[activeModule].title}</h1>
          </div>
          <div className={`connection ${apiStatus}`}>{apiStatus === 'online' ? 'API online' : 'API offline'}</div>
        </header>

        {activeModule === 'mesas' && (
          <section className="content-grid">
            <div className="panel tables-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Salao</span>
                  <h2>Mesas</h2>
                </div>
                <button className="secondary-button" type="button" onClick={() => void loadData()}>Atualizar</button>
              </div>

              <div className="tables-grid">
                {tables.map((table) => (
                  <div
                    className={`table-tile ${getTableStateClass(table)} ${table.id === selectedTable?.id ? 'selected' : ''}`}
                    key={table.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTableId(table.id)}
                    onDoubleClick={() => openTableMenuModal(table)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        setSelectedTableId(table.id);
                      }
                    }}
                    style={{ position: 'relative' }}
                  >
                    <strong>{table.name}</strong>
                    <span>{getTableDisplayStatus(table)}</span>
                    <small>{table.capacity} lugares</small>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openQrModal(table);
                      }}
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        padding: '4px 8px',
                        fontSize: 11,
                        borderRadius: 6,
                        border: '1px solid #ccc',
                        background: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      QR
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel order-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Mesa</span>
                  <h2>{selectedTable?.name ?? 'Selecione uma mesa'}</h2>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="secondary-button" onClick={() => {
                    if (!selectedTable) return alert('Selecione uma mesa');
                    openTableMenuModal(selectedTable);
                  }}>
                    Abrir cardápio
                  </button>
                  {currentUser?.role !== 'GARCOM' && (
                    <button type="button" className="secondary-button" onClick={() => {
                      if (!selectedTable) return alert('Selecione uma mesa');
                      if (selectedTableOrders.length === 0) return alert('Não há comanda ativa para encerrar.');
                      openCloseModal();
                    }}>
                      Encerrar Mesa
                    </button>
                  )}
                </div>
              </div>

              <div className="order-summary">
                <h3>Itens da mesa</h3>
                {selectedTableOrders.length === 0 ? (
                  <p>Nenhum pedido lancado.</p>
                ) : (
                  selectedTableOrders.map((order) => (
                    <div className="order-card" key={order.id}>
                      <div>
                        <strong>{order.items.map((item) => `${item.productName} x${item.quantity}`).join(', ')}</strong>
                        <span>{orderStatusLabel[order.status]}</span>
                      </div>
                      <button type="button" onClick={() => void advanceOrder(order)}>Avançar</button>
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginTop: 20 }}>
                <button type="button" className="secondary-button" onClick={() => {
                  if (!selectedTable) return alert('Selecione uma mesa');
                  if (selectedTableOrders.length === 0) return alert('Nenhum pedido para a mesa.');
                  const map = new Map<string, { quantity: number; unitPrice: number }>();
                  for (const o of selectedTableOrders) {
                    for (const it of o.items) {
                      const prev = map.get(it.productName);
                      if (prev) {
                        prev.quantity += it.quantity;
                      } else {
                        map.set(it.productName, { quantity: it.quantity, unitPrice: it.unitPrice });
                      }
                    }
                  }
                  const items = Array.from(map.entries()).map(([name, v]) => ({ name, quantity: v.quantity, unitPrice: v.unitPrice, total: v.quantity * v.unitPrice }));
                  const subtotal = items.reduce((s, i) => s + i.total, 0);
                  const total = subtotal;
                  const paymentMethod = window.prompt('Forma de pagamento (ex: Dinheiro, Cartão)') ?? '';
                  const paidStr = window.prompt('Valor pago (ex: 50.00)') ?? '';
                  const paid = Number(paidStr.replace(',', '.')) || undefined;
                  const change = paid != null && !Number.isNaN(paid) ? paid - total : undefined;
                  printReceipt({
                    companyName: storeName,
                    cnpj: storeCnpj ? `CNPJ: ${storeCnpj}` : undefined,
                    address: storeAddress,
                    phone: storePhone,
                    tableName: selectedTable.name,
                    items,
                    subtotal,
                    total,
                    paid,
                    change,
                    paymentMethod
                  });
                }}>
                  Visualizar comprovante
                </button>
              </div>
            </div>

            {menuModalTable && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.35)', zIndex: 80, display: 'grid', placeItems: 'center', padding: 20 }} onClick={closeTableMenuModal}>
                <div style={{ width: 'min(800px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.18)' }} onClick={(event) => event.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                    <div>
                      <span className="eyebrow">Cardápio</span>
                      <h2 style={{ margin: 0 }}>{menuModalTable.name}</h2>
                      <p style={{ margin: '6px 0 0', color: '#5d6c66' }}>Duplo clique em uma mesa para abrir o cardápio.</p>
                    </div>
                    <button type="button" className="secondary-button" onClick={closeTableMenuModal}>Fechar</button>
                  </div>
                  {Object.entries(groupedMenuSections).map(([section, items]) => items.length > 0 ? (
                    <div key={section} style={{ marginBottom: 24 }}>
                      <h3 style={{ marginBottom: 12 }}>{section}</h3>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {items.map((product) => (
                          <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', border: '1px solid #ececec', borderRadius: 10 }}>
                            <div>
                              <strong>{product.name}</strong>
                              <div style={{ marginTop: 4, color: '#5d6c66', fontSize: 13 }}>{product.description}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <strong>{formatCurrency(product.price)}</strong>
                              <button type="button" className="secondary-button" onClick={() => {
                                setSelectedTableId(menuModalTable.id);
                                void createOrder(product.id);
                              }}>Pedir</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null)}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Users modal */}
        {showUsersModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 120 }} onClick={() => setShowUsersModal(false)}>
            <div style={{ background: '#fff', padding: 20, borderRadius: 10, minWidth: 480, maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <h3>{selectedUsersCompany ? `Usuários — ${selectedUsersCompany.name}` : 'Usuários'}</h3>
              {selectedUsersCompany ? (
                <p style={{ marginTop: 4, color: '#5d6c66' }}>Empresa: {selectedUsersCompany.name} ({selectedUsersCompany.cnpj})</p>
              ) : (
                <p style={{ marginTop: 4, color: '#9ca3af' }}>Selecione uma empresa na lista para criar novos usuários para essa empresa.</p>
              )}
              <div style={{ display: 'grid', gap: 10, marginBottom: 20, padding: 12, background: '#fafafa', borderRadius: 10, border: '1px solid #ececec' }}>
                <strong>Criar novo usuário</strong>
                <div style={{ display: 'grid', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Nome"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
                  />
                  <input
                    type="email"
                    placeholder="E-mail"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
                  />
                  <input
                    type="password"
                    placeholder="Senha"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
                  />
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
                    <select
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="GERENTE">GERENTE</option>
                      <option value="CAIXA">CAIXA</option>
                      <option value="GARCOM">GARCOM</option>
                      <option value="COZINHA">COZINHA</option>
                      <option value="ESTOQUE">ESTOQUE</option>
                      <option value="FINANCEIRO">FINANCEIRO</option>
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={newUserActive}
                        onChange={(e) => setNewUserActive(e.target.checked)}
                      />
                      Ativo
                    </label>
                  </div>
                  <button className="primary-button" type="button" onClick={() => void handleCreateCompanyUser()}>
                    Criar usuário
                  </button>
                </div>
              </div>
              {loadingUsers ? (
                <p>Carregando...</p>
              ) : usersList.length === 0 ? (
                <p>Nenhum usuário encontrado.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>E-mail</th>
                      <th>Role</th>
                      <th>Ativo</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersList.map((u) => (
                      <tr key={u.id} style={{ borderTop: '1px solid #eee' }}>
                        <td style={{ padding: 8 }}>{u.name}</td>
                        <td style={{ padding: 8 }}>{u.email}</td>
                        <td style={{ padding: 8 }}>{u.role}</td>
                        <td style={{ padding: 8 }}>{u.active ? 'Sim' : 'Não'}</td>
                        <td style={{ padding: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {u.active ? (
                            <button className="secondary-button" onClick={() => void handleSuspendUser(u.id)}>Suspender</button>
                          ) : (
                            <button className="primary-button" onClick={() => void handleReactivateUser(u.id)}>Reativar</button>
                          )}
                          <button className="secondary-button" onClick={() => void handleDeleteUser(u.id)}>Excluir</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="secondary-button" onClick={() => setShowUsersModal(false)}>Fechar</button>
              </div>
            </div>
          </div>
        )}

        {confirmationRequest && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 130 }}>
            <div style={{ width: 'min(420px, 92%)', background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 18px 40px rgba(0,0,0,0.18)' }} role="dialog" aria-modal="true">
              <h3 style={{ margin: 0, marginBottom: 12, fontSize: 20 }}>Confirmação</h3>
              <p style={{ margin: 0, color: '#4b5563', marginBottom: 24, lineHeight: 1.6 }}>{confirmationRequest.message}</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button className="secondary-button" type="button" onClick={() => setConfirmationRequest(null)} style={{ minWidth: 96 }} disabled={confirmationLoading}>
                  Cancelar
                </button>
                <button className="primary-button" type="button" onClick={() => void handleConfirmation()} style={{ minWidth: 96 }} disabled={confirmationLoading}>
                  {confirmationLoading ? 'Confirmando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeModule === 'comandas' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Abertas</span>
                  <h2>Comandas em atendimento</h2>
                </div>
                <ReceiptText size={22} />
              </div>
              <div className="kitchen-list">
                {openTabs.length === 0 ? (
                  <p>Nenhuma comanda aberta.</p>
                ) : (
                  openTabs.map((tab) => {
                    const orderItems = tab.orders.flatMap((order) => order.items);
                    const itemsMap = new Map<string, { quantity: number; unitPrice: number }>();
                    orderItems.forEach((item) => {
                      const prev = itemsMap.get(item.productName);
                      if (prev) {
                        prev.quantity += item.quantity;
                      } else {
                        itemsMap.set(item.productName, { quantity: item.quantity, unitPrice: item.unitPrice });
                      }
                    });
                    const groupedItems = Array.from(itemsMap.entries()).map(([name, value]) => ({
                      name,
                      quantity: value.quantity,
                      unitPrice: value.unitPrice,
                      total: value.quantity * value.unitPrice
                    }));
                    const totalValue = groupedItems.reduce((sum, item) => sum + item.total, 0);

                    return (
                      <div className="kitchen-row" key={tab.tabId}>
                        <div style={{ flex: 1 }}>
                          <strong>{tab.tableName}</strong>
                          <div style={{ marginTop: 6, color: '#5d6c66', fontSize: 13 }}>
                            {groupedItems.map((item) => `${item.name} x${item.quantity}`).join(', ')}
                          </div>
                        </div>
                        <b>{formatCurrency(totalValue)}</b>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="panel metric-panel">
              <span className="eyebrow">Resumo</span>
              <strong>{openTabs.length}</strong>
              <p>comandas ativas</p>
              <div style={{ marginTop: 10, color: '#5d6c66', fontSize: 14 }}>
                <div>{todaySummary.count} pedidos hoje</div>
                <div>{formatCurrency(todaySummary.totalValue)}</div>
              </div>
            </div>
          </section>
        )}

        {activeModule === 'cozinha' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">KDS</span>
                  <h2>Pedidos em producao</h2>
                </div>
                <Utensils size={22} />
              </div>

              <div className="kitchen-list">
                {kitchenOrders.length === 0 ? (
                  <p>Fila vazia.</p>
                ) : (
                  kitchenOrders.map((order) => (
                    <div className="kitchen-row" key={order.id}>
                      <strong>{order.tableName}</strong>
                      <span>{order.items.map((item) => item.productName).join(', ')}</span>
                      <b>{orderStatusLabel[order.status]}</b>
                      <button type="button" onClick={() => void advanceOrder(order)}>Avancar</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {activeModule === 'menu' && (
          <section className="module-grid two-columns">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Mesa</span>
                  <h2>{menuTable ? menuTable.name : 'Mesa não encontrada'}</h2>
                </div>
                <ShoppingBag size={22} />
              </div>

              {!menuTable ? (
                <div style={{ padding: 24 }}>
                  <p>Link inválido ou mesa não encontrada.</p>
                  <p>Verifique o QR code e tente novamente.</p>
                </div>
              ) : (
                <>
                  <div className="product-list">
                    {products.map((product) => (
                      <div key={product.id} className="product-row" style={{ justifyContent: 'space-between' }}>
                        <div>
                          <strong>{product.name}</strong>
                          <small>{product.description}</small>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <strong>{formatCurrency(product.price)}</strong>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => addProductToMenuCart(product)}
                          >
                            Adicionar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Carrinho</span>
                  <h2>Pedidos</h2>
                </div>
                <ShoppingBag size={22} />
              </div>

              {menuCart.length === 0 ? (
                <div style={{ padding: 24 }}>
                  <p>Seu pedido está vazio. Escolha itens do menu.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {menuCart.map((item) => (
                    <div key={item.product.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{item.product.name}</strong>
                          <div style={{ fontSize: 12, color: '#666' }}>{formatCurrency(item.product.price)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => updateMenuCartItem(item.product.id, { quantity: item.quantity - 1 })}
                          >
                            -
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => updateMenuCartItem(item.product.id, { quantity: item.quantity + 1 })}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                        Observação
                        <textarea
                          rows={2}
                          value={item.note}
                          onChange={(event) => updateMenuCartItem(item.product.id, { note: event.target.value })}
                          placeholder="Ex: sem cebola, maionese a parte"
                          style={{ width: '100%' }}
                        />
                      </label>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                        <span style={{ fontSize: 12, color: '#555' }}>Subtotal</span>
                        <strong>{formatCurrency(item.quantity * item.product.price)}</strong>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ width: '100%', marginTop: 10 }}
                        onClick={() => removeMenuCartItem(item.product.id)}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                  <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span>Total</span>
                      <strong>{formatCurrency(menuCart.reduce((sum, item) => sum + item.quantity * item.product.price, 0))}</strong>
                    </div>
                    <button type="button" className="primary-button" onClick={() => void submitMenuOrder()}>
                      Enviar pedido
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeModule === 'cardapio' && (
          <section className="module-grid two-columns">
            <form className="panel product-form" onSubmit={(event) => void createProduct(event)}>
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Novo item</span>
                  <h2>Inserir no cardapio</h2>
                </div>
                <ShoppingBag size={22} />
              </div>

              <label>
                Nome
                <input
                  placeholder="Ex: Shawarma de cordeiro"
                  value={newProductName}
                  onChange={(event) => setNewProductName(event.target.value)}
                />
              </label>

              <label>
                Descricao
                <textarea
                  placeholder="Ingredientes, tamanho ou observacoes"
                  rows={3}
                  value={newProductDescription}
                  onChange={(event) => setNewProductDescription(event.target.value)}
                />
              </label>

              <div className="form-grid">
                <label>
                  Preco
                  <input
                    inputMode="decimal"
                    placeholder="29,90"
                    value={newProductPrice}
                    onChange={(event) => setNewProductPrice(event.target.value)}
                  />
                </label>

                <label>
                  Preparo min.
                  <input
                    inputMode="numeric"
                    value={newProductPreparationMinutes}
                    onChange={(event) => setNewProductPreparationMinutes(event.target.value)}
                  />
                </label>
              </div>

              <button className="primary-button" type="submit">Salvar item</button>
            </form>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Produtos</span>
                  <h2>Itens cadastrados</h2>
                </div>
                <ShoppingBag size={22} />
              </div>
              <div className="product-list catalog-list">
                {Object.entries(groupedMenuSections).map(([section, items]) => (
                  items.length > 0 ? (
                    <div key={section} style={{ marginBottom: 24 }}>
                      <h3 style={{ margin: '0 0 12px' }}>{section}</h3>
                      {items.map((product) => (
                        <div className="product-row static" key={product.id}>
                          <span>
                            <strong>{product.name}</strong>
                            <small>{product.description}</small>
                          </span>
                          <b>{formatCurrency(product.price)}</b>
                        </div>
                      ))}
                    </div>
                  ) : null
                ))}
              </div>
            </div>
          </section>
        )}

        {activeModule === 'cadastros' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Novo cliente</span>
                  <h2>Criar restaurante / login</h2>
                </div>
              </div>

              <div style={{ padding: 12 }} className="product-form">
                <div className="form-grid">
                  <label>
                    Nome da empresa
                    <input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Nome da empresa" />
                  </label>
                  <label>
                    Meses iniciais
                    <input value={newCompanyMonths} onChange={(e) => setNewCompanyMonths(e.target.value)} placeholder="1" />
                  </label>
                  <label>
                    Mesas iniciais
                    <input value={newCompanyTableCount} onChange={(e) => setNewCompanyTableCount(e.target.value)} placeholder="10" />
                  </label>
                  <label>
                    CNPJ
                    <input value={newCompanyCnpj} onChange={(e) => setNewCompanyCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
                  </label>
                  <label>
                    Mensalidade (R$)
                    <input value={newCompanyMonthlyFee} onChange={(e) => setNewCompanyMonthlyFee(e.target.value)} placeholder="0.00" />
                  </label>
                  <label>
                    Email empresa
                    <input value={newCompanyEmail} onChange={(e) => setNewCompanyEmail(e.target.value)} placeholder="contato@exemplo.com" />
                  </label>
                  <label>
                    Telefone
                    <input value={newCompanyPhone} onChange={(e) => setNewCompanyPhone(e.target.value)} placeholder="(00) 00000-0000" />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>
                    Endereço
                    <input value={newCompanyAddress} onChange={(e) => setNewCompanyAddress(e.target.value)} placeholder="Rua, número, bairro" />
                  </label>
                </div>

                <hr />

                <div style={{ display: 'grid', gap: 8 }}>
                  <h3 style={{ margin: 0 }}>Administrador</h3>
                  <div className="form-grid">
                    <label>
                      Nome do administrador
                      <input value={newAdminName} onChange={(e) => setNewAdminName(e.target.value)} placeholder="Nome completo" />
                    </label>
                    <label>
                      E-mail do administrador
                      <input value={newAdminEmail} onChange={(e) => setNewAdminEmail(e.target.value)} placeholder="admin@empresa.com" />
                    </label>
                    <label>
                      Senha do administrador
                      <input type="password" value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} placeholder="Senha forte" />
                    </label>
                    <div />
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                    <button className="primary-button" type="button" onClick={() => void submitCreateCompany()}>Criar</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Users management (moved from Cadastros) */}
        {activeModule === 'usuarios' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Painel</span>
                  <h2>Super Usuário — Gestão de clientes</h2>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="secondary-button" type="button" onClick={() => void loadCompanies()}>Atualizar</button>
                  <button className="secondary-button" type="button" onClick={() => exportCompaniesCSV()}>Exportar CSV</button>
                  <button className="secondary-button" type="button" onClick={() => exportCompaniesPdf()}>Exportar PDF</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                <button
                  type="button"
                  className={`secondary-button ${userSectionTab === 'list' ? 'active' : ''}`}
                  onClick={() => setUserSectionTab('list')}
                >
                  Lista de usuários
                </button>
                <button
                  type="button"
                  className={`secondary-button ${userSectionTab === 'photo' ? 'active' : ''}`}
                  onClick={() => setUserSectionTab('photo')}
                >
                  Foto de perfil
                </button>
              </div>
              {/* Superuser metrics summary */}
              {(() => {
                const totalCompanies = companies.length;
                const activeSubs = companies.filter((c) => (c.subscriptionStatus ?? '').toUpperCase() === 'ATIVO').length;
                const totalMonthly = companies.reduce((sum, c) => sum + Number(c.monthlyFee || 0), 0);
                const avgMonthly = totalCompanies ? totalMonthly / totalCompanies : 0;
                const now = Date.now();
                const overduePayments = companies.flatMap((c) => c.payments || []).filter((p: any) => {
                  if (!p.dueDate) return false;
                  const due = new Date(p.dueDate).getTime();
                  return due < now && (p.status || '').toUpperCase() !== 'PAGO';
                });
                const overdueCount = overduePayments.length;
                const overdueAmount = overduePayments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                      {[
                        { title: 'Empresas', value: totalCompanies },
                        { title: 'Assinaturas ativas', value: activeSubs },
                        { title: 'Receita mensal total', value: formatCurrency(totalMonthly) },
                        { title: 'Média mensal por empresa', value: formatCurrency(avgMonthly) }
                      ].map((m) => (
                        <div key={m.title} className="panel" style={{ padding: 12 }}>
                          <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>{m.title}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{m.value}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
                      <div className="panel" style={{ padding: 12, flex: 1 }}>
                        <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>Pagamentos atrasados</div>
                        <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>{overdueCount} itens — {formatCurrency(overdueAmount)}</div>
                      </div>
                    </div>
                  </>
                );
              })()}

              {userSectionTab === 'list' ? (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 240 }}>
                      Buscar
                      <input value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="Nome da empresa" style={{ flex: 1 }} />
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      Status
                      <select value={companyFilterStatus} onChange={(e) => setCompanyFilterStatus(e.target.value as any)}>
                        <option value="all">Todas</option>
                        <option value="overdue">Atrasadas</option>
                        <option value="pending">Pendentes</option>
                        <option value="paid">Pagas</option>
                      </select>
                    </label>
                  </div>

                  <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9fafb' }}>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Empresa</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>E-mail</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>CNPJ</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Status</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' }}>Tempo restante</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Mensalidade</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingCompanies ? (
                        <tr><td colSpan={7} style={{ padding: 12, textAlign: 'center' }}>Carregando...</td></tr>
                      ) : (companies || []).filter((c) => {
                        // apply search
                        if (companySearch && !(c.name || '').toLowerCase().includes(companySearch.toLowerCase())) return false;
                        const now = Date.now();
                        const payments = c.payments || [];
                        const hasOverdue = payments.some((p: any) => {
                          const due = p.dueDate ? new Date(p.dueDate).getTime() : null;
                          return due && due < now && (String(p.status || '').toUpperCase() !== 'PAGO');
                        });
                        const hasPending = payments.some((p: any) => String((p.status || '').toUpperCase()) === 'PENDENTE');
                        const allPaid = payments.length > 0 && payments.every((p: any) => String((p.status || '').toUpperCase()) === 'PAGO');
                        if (companyFilterStatus === 'overdue' && !hasOverdue) return false;
                        if (companyFilterStatus === 'pending' && !hasPending) return false;
                        if (companyFilterStatus === 'paid' && !allPaid) return false;
                        return true;
                      }).length === 0 ? (
                        <tr><td colSpan={7} style={{ padding: 12, textAlign: 'center' }}>Nenhuma empresa cadastrada.</td></tr>
                      ) : (companies || []).filter((c) => {
                        if (companySearch && !(c.name || '').toLowerCase().includes(companySearch.toLowerCase())) return false;
                        const now = Date.now();
                        const payments = c.payments || [];
                        const hasOverdue = payments.some((p: any) => {
                          const due = p.dueDate ? new Date(p.dueDate).getTime() : null;
                          return due && due < now && (String(p.status || '').toUpperCase() !== 'PAGO');
                        });
                        const hasPending = payments.some((p: any) => String((p.status || '').toUpperCase()) === 'PENDENTE');
                        const allPaid = payments.length > 0 && payments.every((p: any) => String((p.status || '').toUpperCase()) === 'PAGO');
                        if (companyFilterStatus === 'overdue' && !hasOverdue) return false;
                        if (companyFilterStatus === 'pending' && !hasPending) return false;
                        if (companyFilterStatus === 'paid' && !allPaid) return false;
                        return true;
                      }).map((c) => {
                        const now = Date.now();
                        const payments = c.payments || [];
                        const hasOverdue = payments.some((p: any) => {
                          const due = p.dueDate ? new Date(p.dueDate).getTime() : null;
                          return due && due < now && (String(p.status || '').toUpperCase() !== 'PAGO');
                        });
                        return (
                        <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0', background: hasOverdue ? '#fff6f6' : undefined }}>
                          <td style={{ padding: 12 }}>{c.name}</td>
                          <td style={{ padding: 12, fontSize: 13 }}>{c.email}</td>
                          <td style={{ padding: 12 }}>{c.cnpj}</td>
                          <td style={{ padding: 12 }}>
                            {hasOverdue ? <><AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6, color: '#b91c1c' }} /> </> : null}
                            {c.active ? 'Ativa' : 'Inativa'} / {c.subscriptionStatus ?? '—'}
                          </td>
                          <td style={{ padding: 12, whiteSpace: 'nowrap', fontSize: 13 }}>{formatRemaining(c.remainingMs)}</td>
                          <td style={{ padding: 12 }}>{formatCurrency(Number(c.monthlyFee ?? 0))}</td>
                          <td style={{ padding: 12 }}>
                            <div style={{ position: 'relative' }} data-action-menu-id={c.id}>
                              <button 
                                type="button"
                                className="secondary-button"
                                onClick={() => setOpenActionMenuId(openActionMenuId === c.id ? null : c.id)}
                                style={{ padding: '6px 8px' }}
                              >
                                <MoreVertical size={16} />
                              </button>
                              {openActionMenuId === c.id && (
                                <div style={{
                                  position: 'absolute',
                                  top: '100%',
                                  right: 0,
                                  background: '#fff',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: 8,
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                  minWidth: 160,
                                  zIndex: 1000,
                                  marginTop: 4
                                }}>
                                  <button 
                                    type="button"
                                    onClick={() => { void handleRenew(c); setOpenActionMenuId(null); }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '8px 12px',
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      fontSize: 14,
                                      color: '#18201d',
                                      borderBottom: '1px solid #f0f0f0'
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                  >
                                    Renovar
                                  </button>
                                  <button 
                                    type="button"
                                    onClick={() => { openEditModalWithAdmin(c); setOpenActionMenuId(null); }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '8px 12px',
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      fontSize: 14,
                                      color: '#18201d',
                                      borderBottom: '1px solid #f0f0f0'
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                  >
                                    Editar
                                  </button>
                                  <button 
                                    type="button"
                                    onClick={() => { void openUsersModal(c); setOpenActionMenuId(null); }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '8px 12px',
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      fontSize: 14,
                                      color: '#18201d',
                                      borderBottom: '1px solid #f0f0f0'
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                  >
                                    Usuários
                                  </button>
                                  {c.active ? (
                                    <>
                                      <button 
                                        type="button"
                                        onClick={() => { void handleSuspendCompany(c.id); setOpenActionMenuId(null); }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          textAlign: 'left',
                                          padding: '8px 12px',
                                          border: 'none',
                                          background: 'transparent',
                                          cursor: 'pointer',
                                          fontSize: 14,
                                          color: '#18201d',
                                          borderBottom: '1px solid #f0f0f0'
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                      >
                                        Suspender
                                      </button>
                                      <button 
                                        type="button"
                                        onClick={() => { setInvoiceCompany(c); setShowInvoicesModal(true); setOpenActionMenuId(null); }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          textAlign: 'left',
                                          padding: '8px 12px',
                                          border: 'none',
                                          background: 'transparent',
                                          cursor: 'pointer',
                                          fontSize: 14,
                                          color: '#18201d'
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                      >
                                        Faturas
                                      </button>
                                    </>
                                  ) : (
                                    <button 
                                      type="button"
                                      onClick={() => { void handleReactivateCompany(c.id); setOpenActionMenuId(null); }}
                                      style={{
                                        display: 'block',
                                        width: '100%',
                                        textAlign: 'left',
                                        padding: '8px 12px',
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        fontSize: 14,
                                        color: '#059669'
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f0fdf4')}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                    >
                                      Reativar
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </>
            ) : (
              <div style={{ padding: 18, display: 'grid', gap: 16, alignItems: 'center' }}>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  {profilePhoto ? (
                    <img
                      src={profilePhoto}
                      alt="Foto de perfil"
                      style={{ width: 140, height: 140, borderRadius: '50%', objectFit: 'cover', border: '1px solid #ddd' }}
                    />
                  ) : (
                    <div style={{ width: 140, height: 140, borderRadius: '50%', background: '#f2f5f0', display: 'grid', placeItems: 'center', color: '#67716a', fontWeight: 700 }}>
                      Sem foto
                    </div>
                  )}
                </div>
                <label style={{ display: 'grid', gap: 6 }}>
                  Carregar nova foto
                  <input type="file" accept="image/*" onChange={handleProfilePhotoSelect} />
                </label>
                <button className="secondary-button" type="button" onClick={() => {
                  setProfilePhoto('');
                  if (currentUser?.id) {
                    localStorage.removeItem(`profilePhoto_${currentUser.id}`);
                  }
                }}>
                  Remover foto
                </button>
                <p style={{ color: '#5d6c66', fontSize: 13, margin: 0 }}>
                  A foto de perfil é salva localmente para o usuário atual.
                </p>
              </div>
            )}
          </div>
        </section>
        )}

        {/* Financial Reports */}
        {activeModule === 'financeiro' && currentUser?.role === 'SUPER' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Análise</span>
                  <h2>Relatórios Financeiros</h2>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={selectedReportCompany} onChange={(e) => setSelectedReportCompany(e.target.value)} style={{ padding: '10px 14px', borderRadius: 8, border: '2px solid #e5e7eb', fontSize: 14, fontWeight: 500 }}>
                    <option value="all">Todos os restaurantes</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  
                  <div style={{ display: 'flex', gap: 6, padding: '6px', backgroundColor: '#f3f4f6', borderRadius: 8 }}>
                    {reportPeriods.map((period) => (
                      <button
                        key={period.value}
                        type="button"
                        onClick={() => setReportPeriod(period.value)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 6,
                          border: 'none',
                          backgroundColor: reportPeriod === period.value ? '#ffffff' : 'transparent',
                          color: reportPeriod === period.value ? '#1f2937' : '#6b7280',
                          fontWeight: reportPeriod === period.value ? 600 : 500,
                          cursor: 'pointer',
                          boxShadow: reportPeriod === period.value ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          transition: 'all 0.2s'
                        }}
                      >
                        {period.label}
                      </button>
                    ))}
                  </div>
                  
                  <button className="secondary-button" type="button" onClick={() => void loadSuperReports()} disabled={loadingReport} style={{ whiteSpace: 'nowrap' }}>
                    {loadingReport ? 'Carregando...' : 'Atualizar'}
                  </button>
                </div>
              </div>

              {/* Report tabs */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 18, overflowX: 'auto', paddingBottom: 8 }}>
                {[
                  { id: 'revenue', label: 'Faturamento' },
                  { id: 'products', label: 'Produtos' },
                  { id: 'payments', label: 'Pagamentos' },
                  { id: 'users', label: 'Usuários' },
                  { id: 'audit', label: 'Auditoria' },
                  { id: 'health', label: 'Saúde do Sistema' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`secondary-button ${reportsTab === tab.id ? 'active' : ''}`}
                    onClick={() => setReportsTab(tab.id as any)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Revenue Report */}
              {reportsTab === 'revenue' && revenueReport && (
                <div>
                  <h3 style={{ marginBottom: 18, fontSize: 18, fontWeight: 700 }}>Faturamento por Período</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 28 }}>
                    <div className="panel" style={{ padding: 20, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#ffffff', borderRadius: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, marginBottom: 8 }}>Total de Faturamento</div>
                          <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(revenueReport.totalValue)}</div>
                        </div>
                        <DollarSign size={32} style={{ opacity: 0.7 }} />
                      </div>
                    </div>
                    <div className="panel" style={{ padding: 20, background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', color: '#ffffff', borderRadius: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, marginBottom: 8 }}>Total de Pedidos</div>
                          <div style={{ fontSize: 28, fontWeight: 800 }}>{revenueReport.totalOrders}</div>
                        </div>
                        <ShoppingCart size={32} style={{ opacity: 0.7 }} />
                      </div>
                    </div>
                    <div className="panel" style={{ padding: 20, background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', color: '#ffffff', borderRadius: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, marginBottom: 8 }}>Total de Itens</div>
                          <div style={{ fontSize: 28, fontWeight: 800 }}>{revenueReport.totalItems}</div>
                        </div>
                        <ShoppingBag size={32} style={{ opacity: 0.7 }} />
                      </div>
                    </div>
                    <div className="panel" style={{ padding: 20, background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', color: '#ffffff', borderRadius: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, marginBottom: 8 }}>Ticket Médio</div>
                          <div style={{ fontSize: 28, fontWeight: 800 }}>
                            {formatCurrency(revenueReport.totalOrders > 0 ? revenueReport.totalValue / revenueReport.totalOrders : 0)}
                          </div>
                        </div>
                        <TrendingUp size={32} style={{ opacity: 0.7 }} />
                      </div>
                    </div>
                  </div>

                  <h4 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>Por Restaurante</h4>
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                          <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Restaurante</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Total</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Pedidos</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Itens</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Ticket Médio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenueReport.companies?.map((company: any, idx: number) => (
                          <tr key={company.companyId} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb', transition: 'background-color 0.2s' }}>
                            <td style={{ padding: 16, color: '#1f2937', fontWeight: 500 }}>{company.companyName}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 700, fontSize: 15 }}>{formatCurrency(company.totalValue)}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#6b7280' }}>{company.totalOrders}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#6b7280' }}>{company.totalItems}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#6b7280', fontWeight: 600 }}>{formatCurrency(company.totalValue / (company.totalOrders || 1))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Products Report */}
              {reportsTab === 'products' && (
                <div>
                  <div style={{ display: 'grid', gap: 24 }}>
                    {topProductsReport && (
                      <div>
                        <h3 style={{ marginBottom: 18, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Target size={24} style={{ color: '#667eea' }} />
                          Top 10 Produtos Mais Vendidos
                        </h3>
                        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                                <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Produto</th>
                                <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Restaurante</th>
                                <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Quantidade</th>
                                <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Receita</th>
                              </tr>
                            </thead>
                            <tbody>
                              {topProductsReport.topProducts?.map((product: any, idx: number) => (
                                <tr key={product.productId} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                                  <td style={{ padding: 16, color: '#1f2937', fontWeight: 500 }}>{product.productName}</td>
                                  <td style={{ padding: 16, color: '#6b7280' }}>{product.companyName}</td>
                                  <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 600 }}>
                                    <span style={{ backgroundColor: '#dbeafe', color: '#1e40af', padding: '4px 8px', borderRadius: 6, fontSize: 13 }}>
                                      {product.quantity}x
                                    </span>
                                  </td>
                                  <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 700, fontSize: 15 }}>{formatCurrency(product.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {lowPerformanceReport && (
                      <div>
                        <h3 style={{ marginBottom: 18, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <AlertTriangle size={24} style={{ color: '#f59e0b' }} />
                          Produtos com Baixo Desempenho (menos de 5 vendas)
                        </h3>
                        <div style={{ overflowX: 'auto', borderRadius: 10, border: '2px solid #fbbf24' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid #fbbf24', backgroundColor: '#fffbeb' }}>
                                <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Produto</th>
                                <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Restaurante</th>
                                <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Preço</th>
                                <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Custo</th>
                                <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Vendidas</th>
                                <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Receita</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lowPerformanceReport.lowPerformanceProducts?.slice(0, 15).map((product: any, idx: number) => (
                                <tr key={product.productId} style={{ borderBottom: '1px solid #fcd34d', background: idx % 2 === 0 ? '#fffbeb' : '#fef3c7' }}>
                                  <td style={{ padding: 16, color: '#1f2937', fontWeight: 500 }}>{product.productName}</td>
                                  <td style={{ padding: 16, color: '#6b7280' }}>{product.companyName}</td>
                                  <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 600 }}>{formatCurrency(product.price)}</td>
                                  <td style={{ padding: 16, textAlign: 'right', color: '#6b7280' }}>{formatCurrency(product.cost)}</td>
                                  <td style={{ padding: 16, textAlign: 'right', color: '#d97706', fontWeight: 700 }}>{product.quantitySold}</td>
                                  <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 700 }}>{formatCurrency(product.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Payments Report */}
              {reportsTab === 'payments' && (
                <div>
                  <div style={{ display: 'grid', gap: 24 }}>
                    {paymentMethodsReport && (
                      <div>
                        <h3 style={{ marginBottom: 18, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Banknote size={24} style={{ color: '#10b981' }} />
                          Distribuição de Formas de Pagamento
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
                          {paymentMethodsReport.methods?.map((method: any) => (
                            <div key={method.method} className="panel" style={{ padding: 18, borderRadius: 10, border: '2px solid #e5e7eb' }}>
                              <div style={{ color: '#10b981', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{method.method}</div>
                              <div style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>{formatCurrency(method.totalAmount)}</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: '#6b7280', fontSize: 12 }}>{method.count} transações</span>
                                <span style={{ backgroundColor: '#d1fae5', color: '#065f46', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{method.percentage}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {pendingPaymentsReport && (
                      <div>
                        <h3 style={{ marginBottom: 18, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Clock size={24} style={{ color: '#ef4444' }} />
                          Pagamentos Pendentes de Restaurantes
                        </h3>
                        {pendingPaymentsReport.count === 0 ? (
                          <div style={{ padding: 24, backgroundColor: '#f0fdf4', borderRadius: 10, border: '2px solid #86efac', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <CheckCircle size={24} style={{ color: '#22c55e' }} />
                            <p style={{ color: '#166534', fontSize: 15, margin: 0 }}>Nenhum pagamento pendente no momento. Excelente!</p>
                          </div>
                        ) : (
                          <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                                  <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Restaurante</th>
                                  <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Valor</th>
                                  <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Vencimento</th>
                                  <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pendingPaymentsReport.payments?.map((payment: any, idx: number) => (
                                  <tr key={payment.id} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: payment.daysOverdue > 0 ? '#fef2f2' : (idx % 2 === 0 ? '#ffffff' : '#f9fafb') }}>
                                    <td style={{ padding: 16, color: '#1f2937', fontWeight: 500 }}>{payment.companyName}</td>
                                    <td style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 15 }}>{formatCurrency(payment.amount)}</td>
                                    <td style={{ padding: 16, color: '#6b7280' }}>{new Date(payment.dueDate).toLocaleDateString('pt-BR')}</td>
                                    <td style={{ padding: 16, textAlign: 'right' }}>
                                      {payment.daysOverdue > 0 ? (
                                        <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
                                          {payment.daysOverdue} dias de atraso
                                        </span>
                                      ) : (
                                        <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
                                          No prazo
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Users Report */}
              {reportsTab === 'users' && (
                <div>
                  <div style={{ display: 'grid', gap: 24 }}>
                    {userActivityReport && (
                      <div>
                        <h3>Usuários Mais Ativos</h3>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Usuário</th>
                                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Email</th>
                                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Função</th>
                                <th style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>Pedidos</th>
                                <th style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>Itens Vendidos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {userActivityReport.users?.map((user: any) => (
                                <tr key={user.userId} style={{ borderBottom: '1px solid #ececec' }}>
                                  <td style={{ padding: 12 }}>{user.userName}</td>
                                  <td style={{ padding: 12 }}>{user.userEmail}</td>
                                  <td style={{ padding: 12 }}>{user.userRole}</td>
                                  <td style={{ padding: 12, textAlign: 'right' }}>{user.ordersCreated}</td>
                                  <td style={{ padding: 12, textAlign: 'right' }}>{user.itemsSold}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {subscriptionReport && (
                      <div>
                        <h3>Status de Assinaturas</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
                          {subscriptionReport.subscriptions?.map((sub: any) => (
                            <div key={sub.status} className="panel" style={{ padding: 16 }}>
                              <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>{sub.status} ({sub.count})</div>
                              <div style={{ marginTop: 8, fontSize: 12, color: '#5d6c66' }}>
                                {sub.companies?.slice(0, 3).map((c: any) => (
                                  <div key={c.companyId}>{c.companyName}</div>
                                ))}
                                {sub.companies?.length > 3 && <div style={{ fontStyle: 'italic' }}>+ {sub.companies.length - 3} mais</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Audit Report */}
              {reportsTab === 'audit' && auditLogReport && (
                <div>
                  <h3>Histórico de Auditoria (últimas 100 ações)</h3>
                  <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0, background: '#f9fafb' }}>
                          <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Data/Hora</th>
                          <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Usuário</th>
                          <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Ação</th>
                          <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Entidade</th>
                          <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Restaurante</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogReport.logs?.map((log: any) => (
                          <tr key={log.id} style={{ borderBottom: '1px solid #ececec' }}>
                            <td style={{ padding: 12, fontSize: 12 }}>{new Date(log.createdAt).toLocaleString('pt-BR')}</td>
                            <td style={{ padding: 12 }}>{log.userName}</td>
                            <td style={{ padding: 12 }}><span style={{ background: '#dbeafe', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>{log.action}</span></td>
                            <td style={{ padding: 12, fontSize: 12 }}>{log.entity}</td>
                            <td style={{ padding: 12 }}>{log.companyName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Health Report */}
              {reportsTab === 'health' && healthReport && (
                <div>
                  <h3>Saúde do Sistema</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
                    <div className="panel" style={{ padding: 16 }}>
                      <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>Empresas</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{healthReport.companies?.total}</div>
                      <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>
                        {healthReport.companies?.byStatus?.map((s: any) => (
                          <div key={s.status}>{s.status}: {s.count}</div>
                        ))}
                      </div>
                    </div>
                    <div className="panel" style={{ padding: 16 }}>
                      <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>Usuários Totais</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{healthReport.users?.total}</div>
                      <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4, maxHeight: 60, overflowY: 'auto' }}>
                        {healthReport.users?.byRole?.map((r: any) => (
                          <div key={r.role}>{r.role}: {r.count}</div>
                        ))}
                      </div>
                    </div>
                    <div className="panel" style={{ padding: 16 }}>
                      <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>Mesas Cadastradas</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{healthReport.tables}</div>
                    </div>
                    <div className="panel" style={{ padding: 16 }}>
                      <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>Produtos Cadastrados</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{healthReport.products}</div>
                    </div>
                    <div className="panel" style={{ padding: 16 }}>
                      <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>Pedidos Processados</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{healthReport.orders}</div>
                    </div>
                    <div className="panel" style={{ padding: 16 }}>
                      <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>Assinaturas Ativas</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{healthReport.subscriptions?.active}</div>
                    </div>
                  </div>
                  
                  {hourlyPeaksReport && (
                    <div>
                      <h4>Horários de Pico (Top 8)</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                        {hourlyPeaksReport.peakHours?.map((peak: any) => (
                          <div key={peak.hour} className="panel" style={{ padding: 12 }}>
                            <div style={{ fontWeight: 600 }}>{peak.hour}</div>
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                              <div>Pedidos: {peak.orders}</div>
                              <div>Itens: {peak.items}</div>
                              <div style={{ fontWeight: 600, marginTop: 4 }}>{formatCurrency(peak.revenue)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Company Individual Reports */}
        {activeModule === 'financeiro' && currentUser?.companyId && currentUser?.role !== 'SUPER' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Análise</span>
                  <h2>Relatório de Produtos</h2>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 6, padding: '6px', backgroundColor: '#f3f4f6', borderRadius: 8 }}>
                    <button
                      type="button"
                      onClick={() => setCompanyReportDateType('day')}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: companyReportDateType === 'day' ? '#ffffff' : 'transparent',
                        color: companyReportDateType === 'day' ? '#1f2937' : '#6b7280',
                        fontWeight: companyReportDateType === 'day' ? 600 : 500,
                        cursor: 'pointer',
                        boxShadow: companyReportDateType === 'day' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        transition: 'all 0.2s'
                      }}
                    >
                      Por Dia
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompanyReportDateType('week')}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: companyReportDateType === 'week' ? '#ffffff' : 'transparent',
                        color: companyReportDateType === 'week' ? '#1f2937' : '#6b7280',
                        fontWeight: companyReportDateType === 'week' ? 600 : 500,
                        cursor: 'pointer',
                        boxShadow: companyReportDateType === 'week' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        transition: 'all 0.2s'
                      }}
                    >
                      Por Semana
                    </button>
                  </div>

                  {companyReportDateType === 'day' && (
                    <input
                      type="date"
                      value={companyReportSelectedDate}
                      onChange={(e) => setCompanyReportSelectedDate(e.target.value)}
                      style={{ padding: '10px 14px', borderRadius: 8, border: '2px solid #e5e7eb', fontSize: 14 }}
                    />
                  )}

                  {companyReportDateType === 'week' && (
                    <input
                      type="week"
                      value={companyReportSelectedWeek}
                      onChange={(e) => setCompanyReportSelectedWeek(e.target.value)}
                      style={{ padding: '10px 14px', borderRadius: 8, border: '2px solid #e5e7eb', fontSize: 14 }}
                    />
                  )}

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setLoadingCompanyReport(true);
                      const dateStr = companyReportDateType === 'day' 
                        ? companyReportSelectedDate 
                        : `${companyReportSelectedWeek}`;
                      api.fetch('reports/company/products', { 
                        dateType: companyReportDateType, 
                        dateValue: dateStr 
                      })
                        .then(data => {
                          setCompanyTopProducts(data.topProducts);
                          setCompanyLowProducts(data.lowProducts);
                        })
                        .catch(err => console.error('Erro ao carregar relatório:', err))
                        .finally(() => setLoadingCompanyReport(false));
                    }}
                    disabled={loadingCompanyReport}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {loadingCompanyReport ? 'Carregando...' : 'Carregar'}
                  </button>
                </div>
              </div>

              {/* Top Products */}
              {companyTopProducts && (
                <div style={{ marginTop: 24 }}>
                  <h3 style={{ marginBottom: 18, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TrendingUp size={24} style={{ color: '#10b981' }} />
                    Produtos Mais Vendidos
                  </h3>
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                          <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Produto</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Quantidade</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Preço Unitário</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 14 }}>Total Vendido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companyTopProducts?.map((product: any, idx: number) => (
                          <tr key={product.productId} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                            <td style={{ padding: 16, color: '#1f2937', fontWeight: 500 }}>{product.name}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 600 }}>
                              <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>
                                {product.quantity}x
                              </span>
                            </td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#6b7280' }}>{formatCurrency(product.price)}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 700, fontSize: 15 }}>{formatCurrency(product.quantity * product.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Low Products */}
              {companyLowProducts && (
                <div style={{ marginTop: 28 }}>
                  <h3 style={{ marginBottom: 18, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <AlertTriangle size={24} style={{ color: '#f59e0b' }} />
                    Produtos Menos Vendidos
                  </h3>
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: '2px solid #fbbf24' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #fbbf24', backgroundColor: '#fffbeb' }}>
                          <th style={{ padding: 16, textAlign: 'left', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Produto</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Quantidade</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Preço Unitário</th>
                          <th style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: '#92400e', fontSize: 14 }}>Total Vendido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companyLowProducts?.map((product: any, idx: number) => (
                          <tr key={product.productId} style={{ borderBottom: '1px solid #fcd34d', backgroundColor: idx % 2 === 0 ? '#fffbeb' : '#fef3c7' }}>
                            <td style={{ padding: 16, color: '#1f2937', fontWeight: 500 }}>{product.name}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#d97706', fontWeight: 700 }}>
                              <span style={{ backgroundColor: '#fef08a', color: '#713f12', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>
                                {product.quantity}x
                              </span>
                            </td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#6b7280' }}>{formatCurrency(product.price)}</td>
                            <td style={{ padding: 16, textAlign: 'right', color: '#1f2937', fontWeight: 700, fontSize: 15 }}>{formatCurrency(product.quantity * product.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Renew modal */}
        {showRenewModal && selectedCompany && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 120 }} onClick={() => setShowRenewModal(false)}>
            <div style={{ background: '#fff', padding: 20, borderRadius: 10, minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
              <h3>Renovar — {selectedCompany.name}</h3>
              <label>Meses<input value={renewMonths} onChange={(e) => setRenewMonths(e.target.value)} /></label>
              <label>Dias<input value={renewDays} onChange={(e) => setRenewDays(e.target.value)} /></label>
              <label>Horas<input value={renewHours} onChange={(e) => setRenewHours(e.target.value)} /></label>
              <label>Valor pago<input value={renewAmount} onChange={(e) => setRenewAmount(e.target.value)} /></label>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="primary-button" onClick={() => void submitRenewModal()}>Confirmar</button>
                <button className="secondary-button" onClick={() => setShowRenewModal(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* Edit modal */}
        {showEditModal && selectedCompany && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 120 }} onClick={() => setShowEditModal(false)}>
            <div style={{ background: '#fff', padding: 20, borderRadius: 10, minWidth: 360 }} onClick={(e) => e.stopPropagation()}>
              <h3>Editar — {selectedCompany.name}</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <label>Nome<input value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
                <label>Email<input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></label>
                <label>Telefone<input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} /></label>
                <label>Endereco<input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} /></label>
                <label>Mensalidade<input value={editMonthlyFee} onChange={(e) => setEditMonthlyFee(e.target.value)} /></label>
                <hr />
                <h4>Administrador</h4>
                <label>Nome admin<input value={editAdminName} onChange={(e) => setEditAdminName(e.target.value)} /></label>
                <label>Email admin<input value={editAdminEmail} onChange={(e) => setEditAdminEmail(e.target.value)} /></label>
                <label>Senha admin (preencha para alterar)<input type="password" value={editAdminPassword} onChange={(e) => setEditAdminPassword(e.target.value)} /></label>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="primary-button" onClick={() => void submitEditModal()}>Salvar</button>
                  <button className="secondary-button" onClick={() => setShowEditModal(false)}>Cancelar</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Invoices modal */}
        {showInvoicesModal && invoiceCompany && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 120 }} onClick={() => setShowInvoicesModal(false)}>
            <div style={{ background: '#fff', padding: 20, borderRadius: 10, minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
              <h3>Faturas — {invoiceCompany.name}</h3>
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 8 }}>ID</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Valor</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Vencimento</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!invoiceCompany.payments || invoiceCompany.payments.length === 0) ? (
                      <tr><td colSpan={5} style={{ padding: 12 }}>Nenhuma fatura encontrada.</td></tr>
                    ) : (invoiceCompany.payments.map((p: any) => {
                      const now = Date.now();
                      const due = p.dueDate ? new Date(p.dueDate).getTime() : null;
                      const isOverdue = due && due < now && String((p.status || '').toUpperCase()) !== 'PAGO';
                      const isPaid = String((p.status || '').toUpperCase()) === 'PAGO';
                      const isPending = String((p.status || '').toUpperCase()) === 'PENDENTE';
                      return (
                      <tr key={p.id} style={{ borderTop: '1px solid #eee', background: isOverdue ? '#fff6f6' : undefined }}>
                        <td style={{ padding: 8 }}>{p.id}</td>
                        <td style={{ padding: 8 }}>{formatCurrency(Number(p.amount || 0))}</td>
                        <td style={{ padding: 8 }}>{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : '—'}</td>
                        <td style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                          {isPaid ? <CheckCircle size={16} color="#15803d" /> : isOverdue ? <AlertTriangle size={16} color="#b91c1c" /> : isPending ? <Clock size={16} color="#b45309" /> : null}
                          <span>{p.status}</span>
                        </td>
                        <td style={{ padding: 8 }}>
                          {String((p.status || '').toUpperCase()) !== 'PAGO' && (
                            <button className="primary-button" onClick={() => void markPaymentAsPaid(p.id)}>Marcar como pago</button>
                          )}
                        </td>
                      </tr>
                    );}))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="secondary-button" onClick={() => setShowInvoicesModal(false)}>Fechar</button>
              </div>
            </div>
          </div>
        )}

        {activeModule === 'caixa' && (
          <section className="module-grid two-columns">
            <div className="panel metric-panel">
              <span className="eyebrow">Pedidos ativos</span>
              <strong>{formatCurrency(totalOpenOrders)}</strong>
              <p>valor em comandas abertas</p>
            </div>
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Operacao</span>
                  <h2>Controle de caixa</h2>
                </div>
                <Banknote size={22} />
              </div>
              <div style={{ display: 'grid', gap: 16 }}>
                {cashRegister ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <strong>Caixa aberto</strong>
                        <p>Aberto em {new Date(cashRegister.openedAt).toLocaleString()}</p>
                      </div>
                      <div>
                        <strong>Status</strong>
                        <p>{cashRegister.status}</p>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <strong>Saldo inicial</strong>
                        <p>{formatCurrency(cashRegister.initialAmount)}</p>
                      </div>
                      <div>
                        <strong>Pagamentos</strong>
                        <p>{formatCurrency(cashRegister.totalPayments)} ({cashRegister.paymentsCount})</p>
                      </div>
                    </div>
                    <label>
                      Valor de fechamento
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={currentCashClosingAmount}
                        onChange={(event) => setCurrentCashClosingAmount(event.target.value)}
                      />
                    </label>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={async () => {
                        const value = Number(currentCashClosingAmount.replace(',', '.'));
                        if (Number.isNaN(value)) {
                          return alert('Informe um valor de fechamento válido.');
                        }
                        try {
                          await api.closeCashRegister(value);
                          await loadData();
                          setCurrentCashClosingAmount('');
                          alert('Caixa fechado com sucesso.');
                        } catch (error) {
                          console.error(error);
                          alert('Erro ao fechar o caixa.');
                        }
                      }}
                    >
                      Fechar caixa
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <label>
                      Saldo inicial
                      <input
                        inputMode="decimal"
                        placeholder="100.00"
                        value={initialCashAmount}
                        onChange={(event) => setInitialCashAmount(event.target.value)}
                      />
                    </label>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={async () => {
                        const value = Number(initialCashAmount.replace(',', '.'));
                        if (Number.isNaN(value)) {
                          return alert('Informe um valor inicial válido.');
                        }
                        try {
                          await api.openCashRegister(value);
                          await loadData();
                          alert('Caixa aberto com sucesso.');
                        } catch (error) {
                          console.error(error);
                          alert('Erro ao abrir o caixa.');
                        }
                      }}
                    >
                      Abrir caixa
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div>
                  <span className="eyebrow">Relatório</span>
                  <h2>Resumo {reportSummary?.periodLabel ?? 'diário'}</h2>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>Período</span>
                  <select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value as ReportPeriod)}>
                    {reportPeriods.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ height: 34 }}
                    onClick={() => void previewReportPdf()}
                  >
                    Visualizar PDF
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ height: 34 }}
                    onClick={() => void exportReportPdf()}
                  >
                    Exportar PDF
                  </button>
                </div>
                <ReceiptText size={22} />
              </div>
              {reportSummary ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <strong>Pedidos</strong>
                        <p>{reportSummary.totalOrders}</p>
                      </div>
                      <div>
                        <strong>Itens vendidos</strong>
                        <p>{reportSummary.totalItems}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <strong>Faturamento</strong>
                    <p>{formatCurrency(reportSummary.totalValue)}</p>
                  </div>
                  <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                    <strong>Por mesa</strong>
                    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                      {reportSummary.tables.map((table) => (
                        <div key={table.tableId} style={{ padding: 10, border: '1px solid #e5e7eb', borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{table.tableName}</span>
                            <strong>{formatCurrency(table.totalValue)}</strong>
                          </div>
                          <div style={{ marginTop: 6, color: '#6b7280', fontSize: 13 }}>
                            {table.totalItems} itens
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : hasReportAccess ? (
                <p>Carregando relatório...</p>
              ) : (
                <p>Seu perfil não tem acesso ao relatório financeiro.</p>
              )}
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Histórico</span>
                  <h2>Recibos do dia</h2>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Nº do recibo"
                    value={searchReceiptNumber}
                    onChange={(e) => setSearchReceiptNumber(e.target.value)}
                    inputMode="numeric"
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void searchReceiptByNumber()}
                    disabled={loadingReceipts}
                  >
                    Buscar
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void loadDailyReceipts()}
                    disabled={loadingReceipts}
                  >
                    Carregar dia
                  </button>
                </div>

                {selectedReceipt && (
                  <div style={{ padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <strong>Recibo Nº</strong>
                        <p style={{ margin: 0 }}>{String(selectedReceipt.receiptNumber).padStart(6, '0')}</p>
                      </div>
                      <div>
                        <strong>Mesa</strong>
                        <p style={{ margin: 0 }}>{selectedReceipt.tableName}</p>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <strong>Subtotal</strong>
                        <p style={{ margin: 0 }}>{formatCurrency(selectedReceipt.subtotal)}</p>
                      </div>
                      <div>
                        <strong>Total</strong>
                        <p style={{ margin: 0, fontWeight: 700 }}>{formatCurrency(selectedReceipt.total)}</p>
                      </div>
                    </div>
                    {selectedReceipt.orders && selectedReceipt.orders.length > 0 && (
                      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                        <strong style={{ display: 'block', marginBottom: 8 }}>Itens</strong>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {selectedReceipt.orders.flatMap((order: any) =>
                            order.items.map((item: any) => (
                              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span>{item.productName} x{item.quantity}</span>
                                <span>{formatCurrency(item.total)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setSelectedReceipt(null)}
                      style={{ marginTop: 12, width: '100%' }}
                    >
                      Fechar
                    </button>
                  </div>
                )}

                {!selectedReceipt && (
                  <div style={{ overflowY: 'auto', maxHeight: 300 }}>
                    {loadingReceipts ? (
                      <p>Carregando recibos...</p>
                    ) : dailyReceipts.length === 0 ? (
                      <p>Nenhum recibo encontrado.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {dailyReceipts.map((receipt) => (
                          <button
                            key={receipt.id}
                            type="button"
                            className="secondary-button"
                            onClick={() => setSelectedReceipt(receipt)}
                            style={{ textAlign: 'left', padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>
                                <strong>Nº {String(receipt.receiptNumber).padStart(6, '0')}</strong> - {receipt.tableName}
                              </span>
                              <span style={{ fontWeight: 700 }}>{formatCurrency(receipt.total)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeModule === 'ajustes' && (
          <section className="module-grid two-columns">
            <div className="panel settings-list">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Sistema</span>
                  <h2>Configurações da loja</h2>
                </div>
                <Settings size={22} />
              </div>
              <label>
                Nome da loja
                <input value={storeName} onChange={(e) => setStoreName(e.target.value)} />
              </label>
              <label>
                CNPJ
                <input value={storeCnpj} onChange={(e) => setStoreCnpj(e.target.value)} placeholder="00.000.000/0001-00" />
              </label>
              <label>
                Endereço
                <input value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} placeholder="Rua, número - Cidade/Estado" />
              </label>
              <label>
                Telefone
                <input value={storePhone} onChange={(e) => setStorePhone(e.target.value)} placeholder="(00) 0000-0000" />
              </label>
              <label>
                Chave PIX (para recebimentos)
                <input value={storePixKey} onChange={(e) => setStorePixKey(e.target.value)} placeholder="ex: email, celular ou chave aleatoria" />
              </label>
              <button className="primary-button" type="button" onClick={saveStoreSettings}>Salvar configurações</button>
            </div>
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Segurança</span>
                  <h2>Alterar senha de acesso</h2>
                </div>
              </div>
              <label>
                Nova senha
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
              <label>
                Confirmar nova senha
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </label>
              <button className="primary-button" type="button" onClick={() => void submitPasswordChange()}>Alterar senha</button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
