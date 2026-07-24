import { type FormEvent, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, ChefHat, LayoutDashboard, LogOut, ReceiptText, Settings, ShoppingBag, Utensils, Users, AlertTriangle, CheckCircle, Clock, TrendingUp, DollarSign, ShoppingCart, Target, MoreVertical, X, Info, AlertCircle, Bike, Phone, MapPin, User, Plus, Trash2, Package, Building, Activity, Wallet } from 'lucide-react';
import type { DeliveryOrder } from './types.js';
import { generateKitchenTicketHTML, generateThermalHTML } from './receipt';

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; removing?: boolean; }
import { api, publicDeliveryApi } from './api.js';
import { supabase, supabaseAnon } from './supabase.ts';
import type { Order, Product, RestaurantTable } from './types.js';
import { printReceipt } from './receipt';

type ActiveModule = 'mesas' | 'comandas' | 'cozinha' | 'cardapio' | 'caixa' | 'ajustes' | 'menu' | 'financeiro' | 'cadastros' | 'usuarios' | 'delivery' | 'carteiras';
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
  delivery: { eyebrow: 'Delivery', title: 'Pedidos de entrega' },
  caixa: { eyebrow: 'Financeiro', title: 'Caixa' },
  ajustes: { eyebrow: 'Administracao', title: 'Ajustes do sistema' },
  financeiro: { eyebrow: 'Financeiro', title: 'Resumo Financeiro' },
  cadastros: { eyebrow: 'Cadastros', title: 'Gestão de clientes' },
  usuarios: { eyebrow: 'Usuários', title: 'Gestão de usuários' },
  menu: { eyebrow: 'Menu', title: 'Peça para sua mesa' },
  carteiras: { eyebrow: 'Plataforma', title: 'Carteiras das empresas' }
};
const roleAllowedModules: Record<string, ActiveModule[]> = {
  SUPER: ['financeiro', 'cadastros', 'usuarios', 'carteiras'],
  ADMIN: ['mesas', 'comandas', 'cozinha', 'cardapio', 'delivery', 'caixa', 'ajustes', 'menu'],
  GERENTE: ['mesas', 'comandas', 'cozinha', 'cardapio', 'delivery', 'caixa', 'ajustes', 'menu'],
  CAIXA: ['mesas', 'comandas', 'cozinha', 'delivery'],
  GARCOM: ['mesas', 'comandas', 'delivery'],
  COZINHA: ['cozinha'],
  FINANCEIRO: ['financeiro', 'caixa', 'mesas', 'comandas'],
  ESTOQUE: ['cardapio', 'mesas', 'comandas']
};

const getAllowedModules = (role?: string): ActiveModule[] => {
  if (!role) {
    return ['mesas', 'comandas', 'cozinha', 'cardapio', 'delivery', 'caixa', 'ajustes', 'menu', 'financeiro', 'cadastros', 'usuarios'];
  }
  return roleAllowedModules[role] ?? ['mesas', 'comandas', 'cozinha', 'cardapio', 'delivery', 'caixa', 'ajustes', 'menu', 'financeiro', 'cadastros', 'usuarios'];
};

const getNavItems = (role?: string) => {
  const allowedModuleIds = getAllowedModules(role);
  const moduleOptions: Record<string, { id: ActiveModule; label: string; icon: any }> = {
    mesas: { id: 'mesas', label: 'Mesas', icon: LayoutDashboard },
    comandas: { id: 'comandas', label: 'Comandas', icon: ReceiptText },
    cozinha: { id: 'cozinha', label: 'Cozinha', icon: ChefHat },
    cardapio: { id: 'cardapio', label: 'Cardápio', icon: ShoppingBag },
    delivery: { id: 'delivery', label: 'Delivery', icon: Bike },
    caixa: { id: 'caixa', label: 'Caixa', icon: Banknote },
    ajustes: { id: 'ajustes', label: 'Ajustes', icon: Settings },
    menu: { id: 'menu', label: 'Menu', icon: Utensils },
    financeiro: { id: 'financeiro', label: 'Financeiro', icon: Banknote },
    cadastros: { id: 'cadastros', label: 'Cadastros', icon: Settings },
    usuarios: { id: 'usuarios', label: 'Usuários', icon: Users },
    carteiras: { id: 'carteiras', label: 'Carteiras', icon: Wallet }
  };

  return allowedModuleIds.map((moduleId) => moduleOptions[moduleId]).filter((item) => item !== undefined && item.id !== 'menu');
};

// ── Persistência local do pedido do cardápio público (sobrevive a fechar o
// site/app — o cliente reabre e continua de onde parou: pagamento, acompanhamento etc.) ──
type PublicDeliverySavedState = {
  savedAt: number;
  step: string;
  cart: Array<{ product: { id: string; name: string; price: number }; quantity: number; note: string }>;
  name: string;
  phone: string;
  address: string;
  payment: string;
  notes: string;
  orderId: string | null;
  receiptNumber: number | null;
  trackingStatus: string;
  snapshot: { items: Array<{ name: string; quantity: number; unitPrice: number; note: string }>; paymentMethod: string; grandTotal: number } | null;
};

const PUBLIC_DELIVERY_STATE_TTL_MS = 48 * 60 * 60 * 1000; // 48h — depois disso descarta (pedido provavelmente já resolvido)

const publicDeliveryStorageKey = (companyId: string) => `integra360_delivery_state_${companyId}`;

const loadPublicDeliveryState = (companyId: string): PublicDeliverySavedState | null => {
  try {
    const raw = localStorage.getItem(publicDeliveryStorageKey(companyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicDeliverySavedState;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > PUBLIC_DELIVERY_STATE_TTL_MS) {
      localStorage.removeItem(publicDeliveryStorageKey(companyId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const savePublicDeliveryState = (companyId: string, state: Omit<PublicDeliverySavedState, 'savedAt'>) => {
  try {
    localStorage.setItem(publicDeliveryStorageKey(companyId), JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch { /* localStorage indisponível (modo privado, quota etc.) — ignora silenciosamente */ }
};

const clearPublicDeliveryState = (companyId: string) => {
  try { localStorage.removeItem(publicDeliveryStorageKey(companyId)); } catch { /* ignore */ }
};

// Perfil do cliente no cardápio público — salvo globalmente (não por empresa)
// para pré-preencher nome/telefone/endereço em visitas futuras.
const CUSTOMER_PROFILE_KEY = 'integra360_customer_profile';
type CustomerProfile = { name: string; phone: string; address: string };
const loadCustomerProfile = (): CustomerProfile | null => {
  try {
    const raw = localStorage.getItem(CUSTOMER_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CustomerProfile;
  } catch { return null; }
};
const saveCustomerProfile = (profile: CustomerProfile) => {
  try { localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
};

// ── Splash screen ────────────────────────────────────────────────────────────
type SplashState = 'checking' | 'downloading' | 'ready' | 'done';

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<SplashState>('checking');
  const [label, setLabel]   = useState('Verificando atualizações...');
  const [progress, setProgress] = useState(0);
  const [exiting, setExiting]   = useState(false);
  const isElectron = typeof window !== 'undefined' && !!(window as any).sistema?.onUpdaterStatus;

  const finish = useCallback(() => {
    setExiting(true);
    setTimeout(onDone, 480);
  }, [onDone]);

  useEffect(() => {
    if (isElectron) {
      // Electron: ouve eventos reais do electron-updater
      const unsub = (window as any).sistema.onUpdaterStatus((data: any) => {
        switch (data.event) {
          case 'checking-for-update':
            setLabel('Verificando atualizações...');
            setProgress(15);
            break;
          case 'update-available':
            setStatus('downloading');
            setLabel(`Nova versão ${data.version} encontrada! Baixando...`);
            setProgress(30);
            break;
          case 'download-progress':
            setStatus('downloading');
            setLabel(`Baixando atualização... ${data.percent}%`);
            setProgress(30 + Math.floor(data.percent * 0.6));
            break;
          case 'update-downloaded':
            setStatus('ready');
            setLabel('Atualização concluída! Reiniciando...');
            setProgress(100);
            break;
          case 'update-not-available':
            setStatus('ready');
            setLabel('Sistema atualizado.');
            setProgress(100);
            setTimeout(finish, 800);
            break;
          case 'error':
            setLabel('Não foi possível verificar atualizações.');
            setProgress(100);
            setTimeout(finish, 1200);
            break;
        }
      });
      // Timeout de segurança: se não receber nada em 8s, segue
      const timeout = setTimeout(() => {
        setLabel('Sistema pronto.');
        setProgress(100);
        setTimeout(finish, 600);
      }, 8000);
      return () => { unsub(); clearTimeout(timeout); };
    } else {
      // Web: sequência simulada de boot
      const steps: Array<{ label: string; progress: number; delay: number }> = [
        { label: 'Iniciando Integra360...', progress: 20,  delay: 0   },
        { label: 'Verificando conexão...',  progress: 50,  delay: 600 },
        { label: 'Carregando recursos...',  progress: 80,  delay: 1100 },
        { label: 'Tudo pronto!',            progress: 100, delay: 1600 },
      ];
      const timers: ReturnType<typeof setTimeout>[] = [];
      steps.forEach(({ label: l, progress: p, delay }) => {
        timers.push(setTimeout(() => { setLabel(l); setProgress(p); }, delay));
      });
      timers.push(setTimeout(finish, 2200));
      return () => timers.forEach(clearTimeout);
    }
  }, [isElectron, finish]);

  const isIndeterminate = status === 'checking' && progress < 15;

  return (
    <div className={`splash${exiting ? ' exiting' : ''}`}>
      <div className="splash-brand">
        <div className="splash-mark"><img src="/logo.png" alt="Integra360" /></div>
        <span className="splash-name">Integra360</span>
      </div>
      <div className="splash-progress-area">
        <div className="splash-status">{label}</div>
        <div className="splash-bar-track">
          <div
            className={`splash-bar-fill${isIndeterminate ? ' indeterminate' : ''}`}
            style={{ width: isIndeterminate ? undefined : `${progress}%` }}
          />
        </div>
        <div className="splash-version">v{APP_VERSION}</div>
      </div>
    </div>
  );
}

// Versão injetada automaticamente pelo Vite a partir do package.json
declare const __APP_VERSION__: string;
const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
// ─────────────────────────────────────────────────────────────────────────────

export function App() {
  // Splash
  const [showSplash, setShowSplash] = useState(true);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const initialLoadDone = useRef(false);
  const [currentCompany, setCurrentCompany] = useState<any>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // Recuperação de senha
  const [loginView, setLoginView] = useState<'login' | 'recover' | 'privacy' | 'terms' | 'support'>('login');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoverError, setRecoverError] = useState('');

  // App state
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([]);
  const [kitchenDeliveryOrders, setKitchenDeliveryOrders] = useState<DeliveryOrder[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>('mesa_1');
  const lastTableTapRef = useRef<{ id: string; time: number } | null>(null);
  const [menuModalTab, setMenuModalTab] = useState<'menu' | 'cart'>('menu');
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;
  const [apiStatus, setApiStatus] = useState<'online' | 'offline'>('offline');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number>(0);
  // Android in-app updater
  const [androidUpdateAvailable, setAndroidUpdateAvailable] = useState(false);
  const [androidUpdateVersion, setAndroidUpdateVersion] = useState<string | null>(null);
  const [androidUpdateUrl, setAndroidUpdateUrl] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<ActiveModule>('mesas');
  const [newProductName, setNewProductName] = useState('');
  const [newProductDescription, setNewProductDescription] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductPreparationMinutes, setNewProductPreparationMinutes] = useState('10');
  const [newProductCategoryId, setNewProductCategoryId] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [newProductImageFile, setNewProductImageFile] = useState<File | null>(null);
  const [newProductImagePreview, setNewProductImagePreview] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [printerKitchen, setPrinterKitchen] = useState('');
  const [printerCashier, setPrinterCashier] = useState('');
  const [printingDisabled, setPrintingDisabled] = useState(false);
  const [availablePrinters, setAvailablePrinters] = useState<Array<{ name: string; isDefault: boolean }>>([]);
  const [showCategoryForm, setShowCategoryForm] = useState(false);

  // Carteira (wallet)
  const [walletInfo, setWalletInfo] = useState<{ balance: number; deliveryFeePercent: number; payoutPixKey: string | null } | null>(null);
  const [walletTransactions, setWalletTransactions] = useState<Array<{ id: string; type: string; amount: number; balanceAfter: number; description: string | null; createdAt: string }>>([]);
  const [walletWithdrawals, setWalletWithdrawals] = useState<Array<{ id: string; amount: number; status: string; isAutomatic: boolean; requestedAt: string; paidAt: string | null }>>([]);
  const [walletPixKeyInput, setWalletPixKeyInput] = useState('');
  const [walletSavingPixKey, setWalletSavingPixKey] = useState(false);
  const [walletRequestingWithdrawal, setWalletRequestingWithdrawal] = useState(false);

  // Delivery states
  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
  const [deliveryOrdersAll, setDeliveryOrdersAll] = useState<DeliveryOrder[]>([]);
  const [loadingDelivery, setLoadingDelivery] = useState(false);
  const [approvingRefundId, setApprovingRefundId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [dlvCustomerName, setDlvCustomerName] = useState('');
  const [dlvCustomerPhone, setDlvCustomerPhone] = useState('');
  const [dlvCustomerAddress, setDlvCustomerAddress] = useState('');
  const [dlvPaymentMethod, setDlvPaymentMethod] = useState('DINHEIRO');
  const [dlvDeliveryFee, setDlvDeliveryFee] = useState('0');
  const [dlvNotes, setDlvNotes] = useState('');
  const [dlvItems, setDlvItems] = useState<Array<{ productId?: string; productName: string; quantity: number; unitPrice: number; note: string }>>([]);
  const [dlvSelectedProduct, setDlvSelectedProduct] = useState('');
  const [dlvProductSearch, setDlvProductSearch] = useState('');
  const [dlvProductDropdownOpen, setDlvProductDropdownOpen] = useState(false);
  const [dlvProductQty, setDlvProductQty] = useState('1');
  const [dlvProductNote, setDlvProductNote] = useState('');
  const [dlvTab, setDlvTab] = useState<'novo' | 'ativos'>('novo');
  const [menuTableId, setMenuTableId] = useState<string | null>(null);
  // Delivery público (link para cliente)
  const [publicDeliveryCompanyId, setPublicDeliveryCompanyId] = useState<string | null>(null);
  const [publicDeliveryCompany, setPublicDeliveryCompany] = useState<{ id: string; name: string; menuBannerUrl?: string | null; phone?: string | null; deliveryFeeAmount?: number; openingTime?: string; closingTime?: string; isOpen?: boolean } | null>(null);
  const [publicDeliveryCategories, setPublicDeliveryCategories] = useState<Array<{ id: string; name: string; sort: number; imageUrl?: string | null }>>([]);
  const [publicDeliveryProducts, setPublicDeliveryProducts] = useState<Array<{ id: string; categoryId: string; name: string; description: string | null; price: number; available: boolean }>>([]);
  const [publicDeliveryCart, setPublicDeliveryCart] = useState<Array<{ product: { id: string; name: string; price: number }; quantity: number; note: string }>>([]);
  const [publicDeliveryStep, setPublicDeliveryStep] = useState<'menu' | 'checkout' | 'payment' | 'card_payment' | 'payment_return' | 'success' | 'tracking'>('menu');
  const [publicDeliveryTrackingStatus, setPublicDeliveryTrackingStatus] = useState<string>('RECEBIDO');
  const [publicDeliveryTrackingPaymentStatus, setPublicDeliveryTrackingPaymentStatus] = useState<string>('');
  const [publicDeliveryTrackingBar, setPublicDeliveryTrackingBar] = useState(0); // 0-100
  const [publicDeliveryName, setPublicDeliveryName] = useState('');
  const [publicDeliveryPhone, setPublicDeliveryPhone] = useState('');
  const [publicDeliveryAddress, setPublicDeliveryAddress] = useState('');
  const [publicDeliveryPayment, setPublicDeliveryPayment] = useState('DINHEIRO');
  const [publicDeliveryFee, setPublicDeliveryFee] = useState(0);
  const [publicDeliveryNotes, setPublicDeliveryNotes] = useState('');
  const [publicDeliverySubmitting, setPublicDeliverySubmitting] = useState(false);
  const [publicDeliveryOrderId, setPublicDeliveryOrderId] = useState<string | null>(null);
  const [publicDeliveryReceiptNumber, setPublicDeliveryReceiptNumber] = useState<number | null>(null);
  const [publicDeliveryError, setPublicDeliveryError] = useState<string | null>(null);
  // Snapshot do carrinho/pagamento salvo no momento do envio (para mensagem WhatsApp após limpeza do carrinho)
  const [publicDeliverySnapshot, setPublicDeliverySnapshot] = useState<{
    items: Array<{ name: string; quantity: number; unitPrice: number; note: string }>;
    paymentMethod: string;
    grandTotal: number;
  } | null>(null);
  const [publicDeliveryMpAvailable, setPublicDeliveryMpAvailable] = useState(false);
  const [publicDeliveryShowResumeBanner, setPublicDeliveryShowResumeBanner] = useState(false);
  const [publicDeliveryCartBounce, setPublicDeliveryCartBounce] = useState(false);
  const [publicDeliveryProfilePrefilled, setPublicDeliveryProfilePrefilled] = useState(false);
  const [publicDeliveryActiveCategory, setPublicDeliveryActiveCategory] = useState<string | null>(null);
  const [publicPixCharge, setPublicPixCharge] = useState<{ qrCode: string | null; qrCodeBase64: string | null; ticketUrl: string | null } | null>(null);
  const [publicPixLoading, setPublicPixLoading] = useState(false);
  const [publicPixError, setPublicPixError] = useState<string | null>(null);
  const [publicPixPaymentStatus, setPublicPixPaymentStatus] = useState<string>('PENDENTE');
  const [publicCardMpPublicKey, setPublicCardMpPublicKey] = useState<string | null>(null);
  const [publicCardBrickReady, setPublicCardBrickReady] = useState(false);
  const [publicCardError, setPublicCardError] = useState<string | null>(null);
  const [publicCardProcessing, setPublicCardProcessing] = useState(false);
  const publicCardBrickControllerRef = useRef<any>(null);
  const [publicCancellationReason, setPublicCancellationReason] = useState('');
  const [publicCancellationSubmitting, setPublicCancellationSubmitting] = useState(false);
  const [publicCancellationRequested, setPublicCancellationRequested] = useState(false);
  const [publicCancellationError, setPublicCancellationError] = useState<string | null>(null);
  const [menuCart, setMenuCart] = useState<Array<{ product: Product; quantity: number; note: string }>>([]);
  const [menuModalTable, setMenuModalTable] = useState<RestaurantTable | null>(null);
  const [tableCart, setTableCart] = useState<Array<{ product: Product; quantity: number; note: string }>>([]);
  const [tableCartNoteProduct, setTableCartNoteProduct] = useState<Product | null>(null);
  const [tableCartNote, setTableCartNote] = useState('');
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
  const [editDeliveryFeePercent, setEditDeliveryFeePercent] = useState('0');
  const [editPlan, setEditPlan] = useState<'STARTER' | 'TRIAL' | 'PRO' | 'ENTERPRISE'>('STARTER');
  const [editPlanMonthlyPrice, setEditPlanMonthlyPrice] = useState('');
  const [editTrialDays, setEditTrialDays] = useState('');
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showInvoicesModal, setShowInvoicesModal] = useState(false);
  const [invoiceCompany, setInvoiceCompany] = useState<any | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number } | null>(null);
  const closeActionMenu = () => { setOpenActionMenuId(null); setActionMenuPos(null); };
  const [confirmationRequest, setConfirmationRequest] = useState<{
    message: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
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
  const [ajustesSubTab, setAjustesSubTab] = useState<'loja' | 'tecnico' | 'pagamentos' | 'assinatura'>('loja');
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [caixaSubTab, setCaixaSubTab] = useState<'operacao' | 'relatorios' | 'recibos' | 'carteira'>('operacao');
  const [dailyChartData, setDailyChartData] = useState<{ day: number; value: number }[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [prevMonthTotal, setPrevMonthTotal] = useState<number | null>(null);
  const [storeTableCount, setStoreTableCount] = useState('10');
  const [storeTableCountOriginal, setStoreTableCountOriginal] = useState(10);
  const [savingTableCount, setSavingTableCount] = useState(false);
  const [storeCnpj, setStoreCnpj] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeCity, setStoreCity] = useState('');
  const [storePixKey, setStorePixKey] = useState('');
  const [storeDeliveryFeeAmount, setStoreDeliveryFeeAmount] = useState('0');
  const [storeOpeningTime, setStoreOpeningTime] = useState('18:00');
  const [storeClosingTime, setStoreClosingTime] = useState('00:00');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dailyReceipts, setDailyReceipts] = useState<any[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [searchReceiptNumber, setSearchReceiptNumber] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [receiptsDate, setReceiptsDate] = useState(() => new Date().toISOString().slice(0, 10));
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
  const [newCompanyDeliveryFeePercent, setNewCompanyDeliveryFeePercent] = useState('0');
  const [newCompanyTableCount, setNewCompanyTableCount] = useState('10');
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});

  // Super user reports state
  const [reportsTab, setReportsTab] = useState<'revenue' | 'products' | 'payments' | 'users' | 'audit' | 'health'>('revenue');
  const [reportPeriod, setReportPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [reportRefDate, setReportRefDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
  });
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

  // SuperAdmin — visão geral das carteiras de todas as empresas
  const [companyWallets, setCompanyWallets] = useState<Array<{ companyId: string; companyName: string; balance: number; deliveryFeePercent: number; payoutPixKey: string | null; updatedAt: string }>>([]);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<Array<{ id: string; companyId: string; companyName: string; amount: number; isAutomatic: boolean; requestedAt: string; pixKeyUsed: string | null }>>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [resolvingWithdrawalId, setResolvingWithdrawalId] = useState<string | null>(null);
  const [feeEditInputs, setFeeEditInputs] = useState<Record<string, string>>({});
  const [savingFeeCompanyId, setSavingFeeCompanyId] = useState<string | null>(null);
  const [platformMpStatus, setPlatformMpStatus] = useState<{ connected: boolean; publicKey: string | null; connectedAt: string | null } | null>(null);
  const [platformMpTokenInput, setPlatformMpTokenInput] = useState('');
  const [platformMpPublicKeyInput, setPlatformMpPublicKeyInput] = useState('');
  const [savingPlatformMpToken, setSavingPlatformMpToken] = useState(false);

  // Company individual reports state
  const [companyReportDateType, setCompanyReportDateType] = useState<'day' | 'week'>('day');
  const [companyReportSelectedDate, setCompanyReportSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [companyReportSelectedWeek, setCompanyReportSelectedWeek] = useState(getWeekNumber(new Date()));
  const [companyTopProducts, setCompanyTopProducts] = useState<any>(null);
  const [companyLowProducts, setCompanyLowProducts] = useState<any>(null);
  const [loadingCompanyReport, setLoadingCompanyReport] = useState(false);

  // Retorna true se a empresa tem acesso às funcionalidades Pro/Enterprise.
  // Trial ativo também garante acesso completo.
  const isPro = useMemo(() => {
    if (!currentCompany) return false;
    const plan = currentCompany.plan ?? 'STARTER';
    if (plan === 'PRO' || plan === 'ENTERPRISE' || plan === 'TRIAL') return true;
    const trialEnd = currentCompany.trialEndsAt ? new Date(currentCompany.trialEndsAt).getTime() : 0;
    return trialEnd > Date.now();
  }, [currentCompany]);

  const trialDaysLeft = useMemo(() => {
    if (!currentCompany?.trialEndsAt) return 0;
    const diff = new Date(currentCompany.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }, [currentCompany]);

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
      return;
    }
    const deliveryId = params.get('delivery');
    if (deliveryId) {
      setPublicDeliveryCompanyId(deliveryId);

      // Restaura o pedido em andamento (se o cliente fechou o site/app no meio do fluxo)
      const saved = loadPublicDeliveryState(deliveryId);
      if (saved) {
        setPublicDeliveryCart(saved.cart);
        setPublicDeliveryName(saved.name);
        setPublicDeliveryPhone(saved.phone);
        setPublicDeliveryAddress(saved.address);
        setPublicDeliveryPayment(saved.payment);
        setPublicDeliveryNotes(saved.notes);
        setPublicDeliveryOrderId(saved.orderId);
        setPublicDeliveryReceiptNumber(saved.receiptNumber);
        setPublicDeliveryTrackingStatus(saved.trackingStatus);
        setPublicDeliverySnapshot(saved.snapshot);
        // Pagamento com cartão não dá pra retomar no meio (o Brick não guarda
        // dados digitados) — volta pra escolha de forma de pagamento.
        setPublicDeliveryStep(saved.step === 'card_payment' ? 'checkout' : (saved.step as any));
        if (saved.step === 'payment' && saved.orderId) {
          // Regenera/recupera a mesma cobrança Pix (a Edge Function reaproveita
          // a cobrança pendente existente em vez de criar uma nova).
          setTimeout(() => void generatePublicPixCharge(saved.orderId!), 0);
        }
        // Mostra banner de retomada apenas se o cliente estava no cardápio ou checkout
        // (não para telas de pagamento/sucesso/rastreamento já restauradas acima)
        if (['menu', 'checkout', 'card_payment'].includes(saved.step) && saved.cart.length > 0) {
          setPublicDeliveryShowResumeBanner(true);
        }
      }

      publicDeliveryApi.getMenu(deliveryId).then((data) => {
        setPublicDeliveryCompany(data.company);
        setPublicDeliveryCategories(data.categories);
        setPublicDeliveryProducts(data.products);
        setPublicDeliveryFee(data.company.deliveryFeeAmount ?? 0);
        // Contabiliza a visita assincronamente — falha silenciosa intencional
        void publicDeliveryApi.incrementMenuOpenCount(deliveryId);
      }).catch(() => {
        setPublicDeliveryError('Cardápio não encontrado ou loja inativa.');
      });
      publicDeliveryApi.isMercadoPagoAvailable(deliveryId).then((available) => {
        setPublicDeliveryMpAvailable(available);
        if (available) setPublicDeliveryPayment('ONLINE');
      }).catch(() => setPublicDeliveryMpAvailable(false));

      // Retorno do Checkout Pro do Mercado Pago
      const mpOrder = params.get('mp_order');
      const mpStatus = params.get('mp_status');
      if (mpOrder && mpStatus) {
        // Limpa os parâmetros da URL sem recarregar a página
        const cleanUrl = `${window.location.pathname}?delivery=${encodeURIComponent(deliveryId)}`;
        window.history.replaceState({}, '', cleanUrl);
        setPublicDeliveryOrderId(mpOrder);
        if (mpStatus === 'success') {
          // Polling para confirmar que o webhook já processou o pagamento
          setPublicDeliveryStep('payment_return');
          // Busca o receiptNumber
          publicDeliveryApi.getOrderStatus(mpOrder).then((r) => {
            if (r?.receiptNumber != null) setPublicDeliveryReceiptNumber(r.receiptNumber);
          }).catch(() => {});
        } else if (mpStatus === 'pending') {
          setPublicDeliveryStep('payment_return');
        } else {
          // failure — mostra erro
          setPublicDeliveryError('O pagamento foi recusado ou cancelado. Tente novamente.');
          setPublicDeliveryStep('checkout');
        }
      }
    }
  }, []);

  // Salva o progresso do pedido do cardápio público no localStorage a cada
  // mudança relevante, pra cliente continuar de onde parou se fechar o
  // site/app (ex.: reabrir direto na tela de pagamento ou de acompanhamento).
  useEffect(() => {
    if (!publicDeliveryCompanyId) return;
    if (publicDeliveryStep === 'menu' && publicDeliveryCart.length === 0) {
      // Nada em andamento — não precisa persistir (evita lixo acumulando).
      clearPublicDeliveryState(publicDeliveryCompanyId);
      return;
    }
    savePublicDeliveryState(publicDeliveryCompanyId, {
      step: publicDeliveryStep,
      cart: publicDeliveryCart,
      name: publicDeliveryName,
      phone: publicDeliveryPhone,
      address: publicDeliveryAddress,
      payment: publicDeliveryPayment,
      notes: publicDeliveryNotes,
      orderId: publicDeliveryOrderId,
      receiptNumber: publicDeliveryReceiptNumber,
      trackingStatus: publicDeliveryTrackingStatus,
      snapshot: publicDeliverySnapshot,
    });
  }, [
    publicDeliveryCompanyId, publicDeliveryStep, publicDeliveryCart, publicDeliveryName,
    publicDeliveryPhone, publicDeliveryAddress, publicDeliveryPayment, publicDeliveryNotes,
    publicDeliveryOrderId, publicDeliveryReceiptNumber, publicDeliveryTrackingStatus, publicDeliverySnapshot,
  ]);

  // Pré-preenche nome/telefone/endereço a partir do perfil salvo quando o
  // cliente abre o checkout — só aplica se os campos ainda estiverem vazios
  // (evita sobrescrever dados já restaurados pelo estado salvo do pedido).
  useEffect(() => {
    if (publicDeliveryStep !== 'checkout') return;
    if (publicDeliveryName || publicDeliveryAddress) return;
    const profile = loadCustomerProfile();
    if (!profile) return;
    if (profile.name) setPublicDeliveryName(profile.name);
    if (profile.phone) setPublicDeliveryPhone(profile.phone);
    if (profile.address) setPublicDeliveryAddress(profile.address);
    setPublicDeliveryProfilePrefilled(true);
  }, [publicDeliveryStep]);

  // ── Verificador de atualização para Android (APK sideloaded) ──────────────
  useEffect(() => {
    const isAndroid = !!(window as any).Capacitor?.isNativePlatform?.();
    if (!isAndroid) return;

    const checkAndroidUpdate = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/HKLopeS33/INTEGRA360/releases/latest', {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return;
        const release = await res.json();
        const latestTag: string = (release.tag_name ?? '').replace(/^v/, '');
        const current = APP_VERSION;
        if (latestTag && latestTag !== current) {
          // Busca o asset .apk no release
          const apkAsset = (release.assets ?? []).find((a: any) =>
            (a.name ?? '').toLowerCase().endsWith('.apk')
          );
          setAndroidUpdateVersion(latestTag);
          setAndroidUpdateUrl(apkAsset?.browser_download_url ?? release.html_url);
          setAndroidUpdateAvailable(true);
        }
      } catch {
        // silencioso — sem internet ou erro de rede
      }
    };

    checkAndroidUpdate();
    // Re-verifica a cada 2 horas
    const interval = setInterval(checkAndroidUpdate, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  // ──────────────────────────────────────────────────────────────────────────

  // Tracking em tempo real via Supabase Realtime (substitui polling de 5s)
  useEffect(() => {
    if (publicDeliveryStep !== 'tracking' || !publicDeliveryOrderId) return;

    const FINAL = ['ENTREGUE', 'CANCELADO'];

    // Busca inicial do status atual
    publicDeliveryApi.getOrderStatus(publicDeliveryOrderId).then((result) => {
      if (result) {
        setPublicDeliveryTrackingStatus(result.status);
        setPublicDeliveryTrackingPaymentStatus(result.paymentStatus ?? '');
        if (result.receiptNumber != null) setPublicDeliveryReceiptNumber(result.receiptNumber);
      }
    }).catch(() => {});

    // Subscrição Realtime — atualiza instantaneamente quando o restaurante muda o status
    const channel = supabaseAnon
      .channel(`delivery-tracking-${publicDeliveryOrderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'DeliveryOrder',
          filter: `id=eq.${publicDeliveryOrderId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (row.status) setPublicDeliveryTrackingStatus(row.status);
          if (row.paymentStatus) setPublicDeliveryTrackingPaymentStatus(row.paymentStatus);
          if (row.receiptNumber != null) setPublicDeliveryReceiptNumber(row.receiptNumber);
          // Para de escutar quando pedido finalizado
          if (FINAL.includes(row.status)) supabaseAnon.removeChannel(channel);
        },
      )
      .subscribe();

    // Fallback: polling leve a cada 30s caso o Realtime falhe/não conecte
    const fallback = setInterval(() => {
      if (FINAL.includes(publicDeliveryTrackingStatus)) { clearInterval(fallback); return; }
      publicDeliveryApi.getOrderStatus(publicDeliveryOrderId).then((result) => {
        if (result) {
          setPublicDeliveryTrackingStatus(result.status);
          setPublicDeliveryTrackingPaymentStatus(result.paymentStatus ?? '');
          if (result.receiptNumber != null) setPublicDeliveryReceiptNumber(result.receiptNumber);
        }
      }).catch(() => {});
    }, 30000);

    return () => {
      supabaseAnon.removeChannel(channel);
      clearInterval(fallback);
    };
  }, [publicDeliveryStep, publicDeliveryOrderId]);

  // Barra de progresso animada por etapa (loop contínuo)
  useEffect(() => {
    if (publicDeliveryStep !== 'tracking') return;
    setPublicDeliveryTrackingBar(0);
    const tick = setInterval(() => {
      setPublicDeliveryTrackingBar((prev) => (prev >= 100 ? 0 : prev + 2));
    }, 60);
    return () => clearInterval(tick);
  }, [publicDeliveryStep, publicDeliveryTrackingStatus]);

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
    setStoreCity(localStorage.getItem('storeCity') ?? '');
    setStorePixKey(localStorage.getItem('storePixKey') ?? '');
    setPrinterKitchen(localStorage.getItem('printerKitchen') ?? '');
    setPrinterCashier(localStorage.getItem('printerCashier') ?? '');
    setPrintingDisabled(localStorage.getItem('printingDisabled') === 'true');
    // Carrega lista de impressoras disponíveis (só no Electron)
    const sistema = (window as any).sistema;
    if (sistema?.listPrinters) {
      sistema.listPrinters().then((list: any[]) => setAvailablePrinters(list)).catch(() => {});
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentCompany) {
      const name    = currentCompany.name    ?? 'Integra360';
      const cnpj    = currentCompany.cnpj    ?? '';
      const address = currentCompany.address ?? '';
      const phone   = currentCompany.phone   ?? '';
      const pixKey  = currentCompany.pixKey  ?? localStorage.getItem('storePixKey') ?? '';
      const city    = localStorage.getItem('storeCity') ?? '';
      const kitchenPrinter = currentCompany.kitchenPrinter ?? localStorage.getItem('printerKitchen') ?? '';
      const cashierPrinter = currentCompany.cashierPrinter ?? localStorage.getItem('printerCashier') ?? '';
      const printDisabled = currentCompany.printingDisabled ?? (localStorage.getItem('printingDisabled') === 'true');

      setStoreName(name);
      setStoreCnpj(cnpj);
      setStoreAddress(address);
      setStorePhone(phone);
      setStorePixKey(pixKey);
      setStoreCity(city);
      setPrinterKitchen(kitchenPrinter);
      setPrinterCashier(cashierPrinter);
      setPrintingDisabled(printDisabled);
      setStoreDeliveryFeeAmount(String(currentCompany.deliveryFeeAmount ?? 0));
      setStoreOpeningTime(currentCompany.openingTime ?? '18:00');
      setStoreClosingTime(currentCompany.closingTime ?? '00:00');

      // Persiste no localStorage para uso imediato no PIX
      localStorage.setItem('storeName', name);
      localStorage.setItem('storeCnpj', cnpj);
      localStorage.setItem('storeAddress', address);
      localStorage.setItem('storePhone', phone);
      if (pixKey) localStorage.setItem('storePixKey', pixKey);
      localStorage.setItem('printingDisabled', String(printDisabled));
      if (kitchenPrinter) localStorage.setItem('printerKitchen', kitchenPrinter);
      if (cashierPrinter) localStorage.setItem('printerCashier', cashierPrinter);
    }
  }, [currentCompany]);

  useEffect(() => {
    if (activeModule === 'cadastros') {
      void loadCompanies();
    }
    if (activeModule === 'cardapio') {
      void loadCategories();
    }
    if (activeModule === 'delivery') {
      void loadDeliveryOrders();
      void loadCategories();
    }
    if (activeModule === 'ajustes' && (role === 'ADMIN' || role === 'GERENTE')) {
      api.getMyCompanyTableCount()
        .then((count) => { setStoreTableCount(String(count)); setStoreTableCountOriginal(count); })
        .catch((e) => console.error('Erro ao carregar quantidade de mesas', e));
    }
    if (activeModule === 'caixa') {
      void loadWallet();
    }
    if (activeModule === 'carteiras') {
      void loadCarteirasData();
    }
  }, [activeModule]);

  // Atualiza o saldo da carteira do estabelecimento automaticamente
  useEffect(() => {
    if (activeModule !== 'caixa') return;
    const interval = setInterval(() => { void loadWallet(); }, 15000);
    return () => clearInterval(interval);
  }, [activeModule]);

  // Carrega gráfico diário ao entrar na aba Relatórios
  useEffect(() => {
    if (activeModule !== 'caixa' || caixaSubTab !== 'relatorios') return;
    const loadChart = async () => {
      setLoadingChart(true);
      try {
        const ref = reportRefDate ? new Date(reportRefDate) : new Date();
        const [chart, prev] = await Promise.all([
          api.reportDailyBreakdown(ref.getFullYear(), ref.getMonth() + 1),
          api.reportSummary('monthly', new Date(ref.getFullYear(), ref.getMonth() - 1, 1).toISOString().slice(0, 10)),
        ]);
        setDailyChartData(chart);
        setPrevMonthTotal(prev?.totalValue ?? null);
      } catch { /* silencioso */ }
      finally { setLoadingChart(false); }
    };
    void loadChart();
  }, [activeModule, caixaSubTab, reportRefDate]);

  // Atualiza o saldo das carteiras automaticamente enquanto a aba estiver aberta
  useEffect(() => {
    if (activeModule !== 'carteiras') return;
    const interval = setInterval(() => { void loadCarteirasData(); }, 15000);
    return () => clearInterval(interval);
  }, [activeModule]);

  const loadCarteirasData = async () => {
    setLoadingWallets(true);
    try {
      const [wallets, withdrawals, mpStatus] = await Promise.all([
        api.listCompanyWallets(),
        api.listPendingWithdrawals(),
        api.getPlatformMercadoPagoStatus()
      ]);
      setCompanyWallets((wallets ?? []).map((w: any) => ({ ...w, balance: Number(w.balance), deliveryFeePercent: Number(w.deliveryFeePercent) })));
      setPendingWithdrawals((withdrawals ?? []).map((w: any) => ({ ...w, amount: Number(w.amount) })));
      setPlatformMpStatus(mpStatus);
      setPlatformMpPublicKeyInput(mpStatus?.publicKey ?? '');
    } catch (e) {
      console.error('Erro ao carregar carteiras', e);
      showToast('Falha ao carregar carteiras.', 'error');
    } finally {
      setLoadingWallets(false);
    }
  };

  const savePlatformMercadoPagoToken = async () => {
    if (!platformMpTokenInput.trim()) {
      showToast('Informe o Access Token do Mercado Pago.', 'warning');
      return;
    }
    setSavingPlatformMpToken(true);
    try {
      await api.setPlatformMercadoPagoToken(platformMpTokenInput.trim(), platformMpPublicKeyInput.trim() || undefined);
      setPlatformMpTokenInput('');
      await loadCarteirasData();
      showToast('Configuração do Mercado Pago salva.', 'success');
    } catch (e: any) {
      console.error('Erro ao salvar token Mercado Pago', e);
      showToast(e?.message || 'Falha ao salvar configuração do Mercado Pago.', 'error');
    } finally {
      setSavingPlatformMpToken(false);
    }
  };

  const handleResolveWithdrawal = async (withdrawalId: string, approve: boolean) => {
    setResolvingWithdrawalId(withdrawalId);
    try {
      await api.resolveWithdrawal(withdrawalId, approve);
      await loadCarteirasData();
      showToast(approve ? 'Saque marcado como pago.' : 'Saque rejeitado e saldo devolvido.', 'success');
    } catch (e: any) {
      console.error('Erro ao resolver saque', e);
      showToast(e?.message || 'Falha ao resolver solicitação de saque.', 'error');
    } finally {
      setResolvingWithdrawalId(null);
    }
  };

  const saveCompanyDeliveryFee = async (companyId: string) => {
    const raw = feeEditInputs[companyId];
    const percent = Number((raw ?? '').replace(',', '.'));
    if (raw == null || Number.isNaN(percent) || percent < 0 || percent > 100) {
      showToast('Informe um percentual válido entre 0 e 100.', 'warning');
      return;
    }
    setSavingFeeCompanyId(companyId);
    try {
      await api.setCompanyDeliveryFee(companyId, percent);
      await loadCarteirasData();
      setFeeEditInputs((prev) => { const next = { ...prev }; delete next[companyId]; return next; });
      showToast('Taxa da plataforma atualizada.', 'success');
    } catch (e: any) {
      console.error('Erro ao atualizar taxa', e);
      showToast(e?.message || 'Falha ao atualizar taxa.', 'error');
    } finally {
      setSavingFeeCompanyId(null);
    }
  };

  const loadWallet = async () => {
    try {
      const [info, transactions, withdrawals] = await Promise.all([
        api.wallet.get(),
        api.wallet.listTransactions(),
        api.wallet.listWithdrawals()
      ]);
      setWalletInfo(info ? { balance: Number(info.balance), deliveryFeePercent: Number(info.deliveryFeePercent), payoutPixKey: info.payoutPixKey } : null);
      setWalletPixKeyInput(info?.payoutPixKey ?? '');
      setWalletTransactions(transactions as any);
      setWalletWithdrawals(withdrawals as any);
    } catch (e) {
      console.error('Erro ao carregar carteira', e);
    }
  };

  const saveWalletPixKey = async () => {
    setWalletSavingPixKey(true);
    try {
      await api.wallet.setPayoutPixKey(walletPixKeyInput.trim());
      await loadWallet();
      showToast('Chave Pix de repasse salva.', 'success');
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Falha ao salvar chave Pix.', 'error');
    } finally {
      setWalletSavingPixKey(false);
    }
  };

  const requestWalletWithdrawal = async () => {
    if (!walletInfo || walletInfo.balance <= 0) return;
    setWalletRequestingWithdrawal(true);
    try {
      await api.wallet.requestWithdrawal(walletInfo.balance);
      await loadWallet();
      showToast('Saque solicitado. O AdminSuper irá processar a transferência.', 'success');
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Falha ao solicitar saque.', 'error');
    } finally {
      setWalletRequestingWithdrawal(false);
    }
  };

  const saveTableCount = async () => {
    const desired = Math.max(0, Math.floor(Number(storeTableCount) || 0));
    if (desired === storeTableCountOriginal) return;
    if (!isPro && desired > 10) {
      showToast('O plano Starter permite até 10 mesas. Faça upgrade para o plano Pro para adicionar mais.', 'error');
      return;
    }
    setSavingTableCount(true);
    try {
      const result = await api.setMyCompanyTableCount(desired);
      if (result.added > 0) showToast(`${result.added} mesa(s) adicionada(s).`, 'success');
      if (result.removed > 0) showToast(`${result.removed} mesa(s) removida(s).`, 'success');
      setStoreTableCountOriginal(result.total);
      setStoreTableCount(String(result.total));
      await loadData();
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Falha ao atualizar quantidade de mesas.', 'error');
    } finally {
      setSavingTableCount(false);
    }
  };

  const formatRemaining = (expiresAt: string | null) => {
    if (!expiresAt) return { text: '—', days: null, expired: false, urgent: false };
    const diff = new Date(expiresAt).getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (diff <= 0) return { text: 'Vencida', days, expired: true, urgent: false };
    if (days <= 7) return { text: `${days} dia${days !== 1 ? 's' : ''}`, days, expired: false, urgent: true };
    return { text: `${days} dias`, days, expired: false, urgent: false };
  };

  const formatExpiryDate = (expiresAt: string | null) => {
    if (!expiresAt) return '—';
    return new Date(expiresAt).toLocaleDateString('pt-BR');
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

      // Auto-suspender empresas com assinatura vencida e ainda ativas
      const expired = (list || []).filter((c: any) =>
        c.active && c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()
      );
      if (expired.length > 0) {
        await Promise.all(expired.map((c: any) => api.suspendCompany(c.id).catch(() => {})));
        // Recarrega após suspender
        const updated = await api.listCompanies();
        setCompanies(updated || []);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Erro ao carregar empresas', e);
      showToast('Falha ao carregar empresas.', 'error');
    } finally {
      setLoadingCompanies(false);
    }
  }

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    const removeTimer = setTimeout(() => {
      setToasts((prev) => prev.map((t) => t.id === id ? { ...t, removing: true } : t));
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 230);
    }, 4000);
    return removeTimer;
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, removing: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 230);
  }, []);

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

  const setCreateFieldError = (field: string, msg: string) =>
    setCreateFieldErrors(prev => ({ ...prev, [field]: msg }));
  const clearCreateFieldError = (field: string) =>
    setCreateFieldErrors(prev => { const n = { ...prev }; delete n[field]; return n; });

  const checkFieldUnique = useCallback(async (field: 'cnpj' | 'companyEmail' | 'adminEmail' | 'companyName', value: string) => {
    if (!value.trim()) { clearCreateFieldError(field); return; }
    try {
      if (field === 'cnpj') {
        const { data } = await supabase.from('Company').select('id').eq('cnpj', value.trim()).maybeSingle();
        data ? setCreateFieldError('cnpj', 'CNPJ já cadastrado.') : clearCreateFieldError('cnpj');
      } else if (field === 'companyEmail') {
        const { data } = await supabase.from('Company').select('id').eq('email', value.trim()).maybeSingle();
        data ? setCreateFieldError('companyEmail', 'E-mail da empresa já cadastrado.') : clearCreateFieldError('companyEmail');
      } else if (field === 'companyName') {
        const { data } = await supabase.from('Company').select('id').ilike('name', value.trim()).maybeSingle();
        data ? setCreateFieldError('companyName', 'Nome da empresa já cadastrado.') : clearCreateFieldError('companyName');
      } else if (field === 'adminEmail') {
        const { data } = await supabase.from('User').select('id').eq('email', value.trim()).maybeSingle();
        data ? setCreateFieldError('adminEmail', 'E-mail do administrador já cadastrado.') : clearCreateFieldError('adminEmail');
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void checkFieldUnique('companyName', newCompanyName); }, 500);
    return () => clearTimeout(t);
  }, [newCompanyName, checkFieldUnique]);

  useEffect(() => {
    const t = setTimeout(() => { void checkFieldUnique('cnpj', newCompanyCnpj); }, 500);
    return () => clearTimeout(t);
  }, [newCompanyCnpj, checkFieldUnique]);

  useEffect(() => {
    const t = setTimeout(() => { void checkFieldUnique('companyEmail', newCompanyEmail); }, 500);
    return () => clearTimeout(t);
  }, [newCompanyEmail, checkFieldUnique]);

  useEffect(() => {
    const t = setTimeout(() => { void checkFieldUnique('adminEmail', newAdminEmail); }, 500);
    return () => clearTimeout(t);
  }, [newAdminEmail, checkFieldUnique]);

  const submitCreateCompany = async () => {
    if (!newCompanyName.trim() || !newAdminEmail.trim() || !newAdminPassword.trim()) {
      return showToast('Preencha o nome da empresa e credenciais do administrador.', 'warning');
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
        deliveryFeePercent: Number(newCompanyDeliveryFeePercent.replace(',', '.')) || 0,
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
      setNewCompanyDeliveryFeePercent('0');
      setNewCompanyTableCount('10');
      setCreateFieldErrors({});

      await loadCompanies();
      showToast('Empresa criada com sucesso!', 'success');
    } catch (e) {
      console.error('Erro ao criar empresa', e);
      showToast('Falha ao criar empresa. Verifique o console.', 'error');
    }
  };

  const handleSuspendCompany = async (id: string) => {
    confirmAction('Suspender essa empresa e desativar usuários?', async () => {
      try {
        await api.suspendCompany(id);
        await loadCompanies();
        showToast('Empresa suspensa.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Falha ao suspender empresa.', 'error');
      }
    });
  };

  const handleDeleteCompany = async (id: string) => {
    confirmAction('Excluir PERMANENTEMENTE essa empresa e todos os seus dados? Esta ação não pode ser desfeita.', async () => {
      try {
        await api.deleteCompany(id);
        await loadCompanies();
        showToast('Empresa excluída permanentemente.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Falha ao excluir empresa.', 'error');
      }
    });
  };

  const handleReactivateCompany = async (id: string) => {
    confirmAction('Reativar essa empresa?', async () => {
      try {
        await api.reactivateCompany(id);
        await loadCompanies();
        showToast('Empresa reativada.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Falha ao reativar empresa.', 'error');
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
      showToast('Assinatura renovada.', 'success');
    } catch (e) {
      console.error(e);
      showToast('Falha ao renovar assinatura.', 'error');
    }
  };

  const openEditModal = (company: any) => {
    setSelectedCompany(company);
    setEditName(company.name ?? '');
    setEditEmail(company.email ?? '');
    setEditPhone(company.phone ?? '');
    setEditAddress(company.address ?? '');
    setEditMonthlyFee(String(company.monthlyFee ?? '0.00'));
    setEditDeliveryFeePercent(String(company.deliveryFeePercent ?? '0'));
    setEditPlan((company.plan ?? 'STARTER') as 'STARTER' | 'TRIAL' | 'PRO' | 'ENTERPRISE');
    setEditPlanMonthlyPrice(String(company.planMonthlyPrice ?? ''));
    setEditTrialDays('');
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
    setEditDeliveryFeePercent(String(company.deliveryFeePercent ?? '0'));
    setEditPlan((company.plan ?? 'STARTER') as 'STARTER' | 'TRIAL' | 'PRO' | 'ENTERPRISE');
    setEditPlanMonthlyPrice(String(company.planMonthlyPrice ?? ''));
    setEditTrialDays('');
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
      showToast('Falha ao carregar usuários.', 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSuspendUser = async (id: string) => {
    confirmAction('Suspender este usuário?', async () => {
      try {
        await api.suspendUser(id);
        await openUsersModal();
        showToast('Usuário suspenso.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Falha ao suspender usuário.', 'error');
      }
    });
  };

  const handleReactivateUser = async (id: string) => {
    confirmAction('Reativar este usuário?', async () => {
      try {
        await api.reactivateUser(id);
        await openUsersModal();
        showToast('Usuário reativado.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Falha ao reativar usuário.', 'error');
      }
    });
  };

  const handleDeleteUser = async (id: string) => {
    confirmAction('Excluir este usuário e todos os seus dados? Esta ação é irreversível.', async () => {
      try {
        await api.deleteUser(id);
        await openUsersModal();
        showToast('Usuário excluído.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Falha ao excluir usuário.', 'error');
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
        showToast('Pagamento marcado como pago.', 'success');
      } catch (e) {
        console.error(e);
        showToast('Falha ao marcar pagamento.', 'error');
      }
    });
  };

  const handleCreateCompanyUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) {
      showToast('Preencha nome, e-mail e senha.', 'warning');
      return;
    }

    if (currentUser?.role === 'SUPER' && !selectedUsersCompany) {
      showToast('Selecione uma empresa antes de criar um usuário.', 'warning');
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
      showToast('Usuário criado com sucesso!', 'success');
    } catch (e) {
      console.error(e);
      showToast(`Falha ao criar usuário: ${(e as Error).message}`, 'error');
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
    // Sempre salva no localStorage como fallback imediato (garante que PIX funciona mesmo sem recarregar)
    localStorage.setItem('storeName', storeName);
    localStorage.setItem('storeCnpj', storeCnpj);
    localStorage.setItem('storeAddress', storeAddress);
    localStorage.setItem('storePhone', storePhone);
    localStorage.setItem('storeCity', storeCity);
    localStorage.setItem('storePixKey', storePixKey);
    localStorage.setItem('printerKitchen', printerKitchen);
    localStorage.setItem('printerCashier', printerCashier);
    localStorage.setItem('printingDisabled', String(printingDisabled));

    if (currentCompany?.id) {
      try {
        const response = await api.updateCompanyProfile({
          name: storeName,
          pixKey: storePixKey,
          cnpj: storeCnpj,
          phone: storePhone,
          address: storeAddress,
          kitchenPrinter: printerKitchen,
          cashierPrinter: printerCashier,
          printingDisabled,
          deliveryFeeAmount: Number(storeDeliveryFeeAmount) || 0,
          openingTime: storeOpeningTime || '18:00',
          closingTime: storeClosingTime || '00:00',
        });
        // Atualiza o state diretamente para garantir que PIX usa a nova chave imediatamente
        setCurrentCompany({ ...response.company, pixKey: storePixKey });
        showToast('Configurações salvas.', 'success');
        return;
      } catch (error) {
        console.error('Erro ao salvar configurações da empresa', error);
        showToast('Falha ao salvar configurações da empresa.', 'error');
        return;
      }
    }

    showToast('Configurações salvas.', 'success');
  };

  const generateMercadoPagoPixCharge = async (tabId: string, amount: number) => {
    setMpChargeLoading(true);
    setMpCharge(null);
    try {
      const charge = await api.createMercadoPagoPixCharge({ tabId, amount, description: `Comanda — ${storeName}` });
      setMpCharge({ mpPaymentId: charge.mpPaymentId, status: charge.status, qrCodeBase64: charge.qrCodeBase64, qrCode: charge.qrCode });
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Falha ao gerar cobrança Pix via Mercado Pago.', 'error');
    } finally {
      setMpChargeLoading(false);
    }
  };

  const checkMercadoPagoChargeStatus = async () => {
    if (!mpCharge) return;
    setMpChargeChecking(true);
    try {
      const result = await api.getMercadoPagoPaymentStatus(mpCharge.mpPaymentId);
      if (result) {
        setMpCharge((prev) => (prev ? { ...prev, status: result.status } : prev));
        if (result.status === 'approved') {
          showToast('Pagamento confirmado pelo Mercado Pago!', 'success');
        } else {
          showToast(`Status atual: ${result.status}`, 'info');
        }
      }
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Falha ao consultar status do pagamento.', 'error');
    } finally {
      setMpChargeChecking(false);
    }
  };

  const submitPasswordChange = async () => {
    if (!newPassword || !confirmPassword) {
      return showToast('Preencha a nova senha e a confirmação.', 'warning');
    }

    if (newPassword !== confirmPassword) {
      return showToast('A confirmação de senha não corresponde.', 'warning');
    }

    try {
      await api.changePassword(newPassword, confirmPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('Senha alterada com sucesso!', 'success');
    } catch (e) {
      console.error(e);
      showToast('Falha ao alterar senha.', 'error');
    }
  };

  const loadDailyReceipts = async (date?: string) => {
    setLoadingReceipts(true);
    try {
      const receipts = await api.listDailyReceipts(date ?? receiptsDate);
      setDailyReceipts(receipts || []);
    } catch (e) {
      console.error(e);
      showToast('Falha ao carregar recibos do dia.', 'error');
    } finally {
      setLoadingReceipts(false);
    }
  };

  const searchReceiptByNumber = async () => {
    if (!searchReceiptNumber) {
      return showToast('Informe o número do recibo.', 'warning');
    }

    setLoadingReceipts(true);
    try {
      const receipt = await api.getReceiptByNumber(Number(searchReceiptNumber));
      if ('error' in receipt) {
        return showToast(receipt.error, 'error');
      }
      setSelectedReceipt(receipt);
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : 'Falha ao buscar recibo.', 'error');
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
        monthlyFee: Number(editMonthlyFee.replace(',', '.')) || 0,
        deliveryFeePercent: Number(editDeliveryFeePercent.replace(',', '.')) || 0
      });

      // update plan if changed
      if (editPlan !== (selectedCompany.plan ?? 'STARTER') || editTrialDays || editPlanMonthlyPrice) {
        const trialDays    = editTrialDays ? parseInt(editTrialDays, 10) : undefined;
        const monthlyPrice = editPlanMonthlyPrice ? Number(editPlanMonthlyPrice.replace(',', '.')) : undefined;
        await api.setCompanyPlan(selectedCompany.id, editPlan, trialDays, monthlyPrice);
      }

      // update admin user if present
      if (editAdminId) {
        const payload: any = { name: editAdminName, email: editAdminEmail };
        if (editAdminPassword && editAdminPassword.trim().length > 0) payload.password = editAdminPassword;
        await api.updateUser(editAdminId, payload);
      }

      await loadCompanies();
      setShowEditModal(false);
      showToast('Empresa e usuário atualizados.', 'success');
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Falha ao atualizar empresa/usuário.', 'error');
    }
  };

  const requestUpdateCompany = async (companyId: string, payload: any) => {
    return api.updateCompanyAsSuperAdmin(companyId, payload);
  };

  const exportCompaniesCSV = () => {
    if (!companies || companies.length === 0) return showToast('Nenhuma empresa para exportar.', 'warning');
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
    if (!companies || companies.length === 0) return showToast('Nenhuma empresa para exportar.', 'warning');
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
    if (!w) return showToast('Bloqueador de janelas impediu a abertura.', 'warning');
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
    () => orders.filter((order) => order.tableId === selectedTable?.id && order.tabStatus === 'ABERTA' && order.status !== 'CANCELADO'),
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
      showToast('Mesa não encontrada.', 'error');
      return;
    }
    if (menuCart.length === 0) {
      showToast('Adicione itens ao pedido antes de enviar.', 'warning');
      return;
    }

    try {
      await api.createOrder(menuTableId, menuCart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        note: item.note || undefined
      })));
      showToast('Pedido enviado com sucesso!', 'success');
      setMenuCart([]);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao enviar pedido', error);
      showToast('Falha ao enviar o pedido.', 'error');
    }
  };

  // ── Delivery público ──────────────────────────────────────────────────────

  const getPublicDeliveryLink = () => {
    // No Electron (protocolo file:) usa a URL pública configurada; no browser usa a origem atual
    const base = window.location.protocol === 'file:'
      ? (import.meta.env.VITE_PUBLIC_URL ?? 'https://CONFIGURE-VITE_PUBLIC_URL-no-.env')
      : window.location.origin;
    return `${base}/?delivery=${currentUser?.companyId ?? ''}`;
  };

  const addToPublicCart = (product: { id: string; name: string; price: number }) => {
    setPublicDeliveryCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) return prev.map((i) => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product, quantity: 1, note: '' }];
    });
    setPublicDeliveryCartBounce(true);
    setTimeout(() => setPublicDeliveryCartBounce(false), 400);
  };

  const updatePublicCartItem = (productId: string, updates: Partial<{ quantity: number; note: string }>) => {
    setPublicDeliveryCart((prev) =>
      prev.map((i) => i.product.id === productId ? { ...i, ...updates } : i).filter((i) => i.quantity > 0)
    );
  };

  const submitPublicDeliveryOrder = async () => {
    if (!publicDeliveryCompanyId) return;
    if (publicDeliveryCart.length === 0) { setPublicDeliveryError('Adicione itens ao carrinho.'); return; }
    if (!publicDeliveryName.trim()) { setPublicDeliveryError('Informe seu nome.'); return; }
    if (!publicDeliveryAddress.trim()) { setPublicDeliveryError('Informe o endereço de entrega.'); return; }
    setPublicDeliveryError(null);
    setPublicDeliverySubmitting(true);
    try {
      const cartSnapshot = publicDeliveryCart.map((i) => ({
        name: i.product.name,
        quantity: i.quantity,
        unitPrice: i.product.price,
        note: i.note || '',
      }));
      const cartTotalSnap = cartSnapshot.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const grandTotalSnap = cartTotalSnap + publicDeliveryFee;

      const result = await publicDeliveryApi.createOrder(publicDeliveryCompanyId, {
        customerName: publicDeliveryName,
        customerPhone: publicDeliveryPhone || undefined,
        customerAddress: publicDeliveryAddress,
        paymentMethod: publicDeliveryPayment,
        deliveryFee: publicDeliveryFee,
        notes: publicDeliveryNotes || undefined,
        items: publicDeliveryCart.map((i) => ({
          productId: i.product.id,
          productName: i.product.name,
          quantity: i.quantity,
          unitPrice: i.product.price,
          note: i.note || undefined,
        })),
      });
      setPublicDeliveryOrderId(result.id);
      setPublicDeliveryReceiptNumber(result.receiptNumber ?? null);
      // Salva snapshot para a mensagem WhatsApp (antes de limpar o carrinho)
      setPublicDeliverySnapshot({ items: cartSnapshot, paymentMethod: publicDeliveryPayment, grandTotal: grandTotalSnap });
      // Salva perfil do cliente para pré-preencher em visitas futuras
      saveCustomerProfile({ name: publicDeliveryName.trim(), phone: publicDeliveryPhone.trim(), address: publicDeliveryAddress.trim() });

      if (publicDeliveryPayment === 'PIX_ONLINE') {
        setPublicDeliveryStep('payment');
        void generatePublicPixCharge(result.id);
      } else if (publicDeliveryPayment === 'CARTAO_ONLINE') {
        setPublicDeliveryStep('card_payment');
      } else {
        setPublicDeliveryStep('success');
      }
    } catch (e: any) {
      setPublicDeliveryError(e?.message ?? 'Falha ao enviar pedido. Tente novamente.');
    } finally {
      setPublicDeliverySubmitting(false);
    }
  };

  const generatePublicPixCharge = async (orderId: string) => {
    if (!publicDeliveryCompanyId) return;
    setPublicPixLoading(true);
    setPublicPixError(null);
    try {
      const charge = await publicDeliveryApi.createPixCharge(publicDeliveryCompanyId, orderId, undefined);
      setPublicPixCharge({ qrCode: charge.qrCode, qrCodeBase64: charge.qrCodeBase64, ticketUrl: charge.ticketUrl });
    } catch (e: any) {
      setPublicPixError(e?.message ?? 'Falha ao gerar cobrança Pix.');
    } finally {
      setPublicPixLoading(false);
    }
  };

  // Polling do status de pagamento (PIX direto ou retorno do Checkout Pro)
  useEffect(() => {
    if ((publicDeliveryStep !== 'payment' && publicDeliveryStep !== 'payment_return') || !publicDeliveryOrderId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const result = await publicDeliveryApi.getOrderStatus(publicDeliveryOrderId);
        if (stopped || !result) return;
        setPublicPixPaymentStatus(result.paymentStatus);
        if (result.receiptNumber != null) setPublicDeliveryReceiptNumber(result.receiptNumber);
        if (result.paymentStatus === 'PAGO') {
          setPublicDeliveryStep('success');
        }
      } catch { /* ignore */ }
    };
    void poll();
    const interval = setInterval(poll, 3000);
    return () => { stopped = true; clearInterval(interval); };
  }, [publicDeliveryStep, publicDeliveryOrderId]);

  // Carrega o SDK do Mercado Pago uma única vez e busca a public key da plataforma
  // (necessária para montar o formulário de cartão embutido no cardápio público).
  useEffect(() => {
    if (!publicDeliveryMpAvailable) return;
    if (!(window as any).MercadoPago && !document.getElementById('mp-sdk-script')) {
      const script = document.createElement('script');
      script.id = 'mp-sdk-script';
      script.src = 'https://sdk.mercadopago.com/js/v2';
      script.async = true;
      document.body.appendChild(script);
    }
    if (!publicCardMpPublicKey) {
      publicDeliveryApi.getPlatformPublicKey().then((key) => { if (key) setPublicCardMpPublicKey(key); });
    }
  }, [publicDeliveryMpAvailable]);

  // Monta o Card Payment Brick (formulário de cartão embutido) quando o cliente
  // escolhe pagar com cartão. O número do cartão é tokenizado pelo SDK da MP
  // direto no navegador — nunca passa pelo nosso backend.
  useEffect(() => {
    if (publicDeliveryStep !== 'card_payment') return;
    if (!publicCardMpPublicKey || !publicDeliveryOrderId || !publicDeliveryCompanyId) return;

    let cancelled = false;
    setPublicCardError(null);
    setPublicCardBrickReady(false);

    const mount = async () => {
      let attempts = 0;
      while (!(window as any).MercadoPago && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      if (cancelled || !(window as any).MercadoPago) return;

      const mp = new (window as any).MercadoPago(publicCardMpPublicKey, { locale: 'pt-BR' });
      const amount = publicDeliverySnapshot?.grandTotal ?? 0;

      try {
        const controller = await mp.bricks().create('cardPayment', 'publicCardPaymentBrick', {
          initialization: { amount },
          customization: { paymentMethods: { maxInstallments: 1 } },
          callbacks: {
            onReady: () => { if (!cancelled) setPublicCardBrickReady(true); },
            onError: (error: any) => { console.error('Card Brick error', error); },
            onSubmit: (cardFormData: any) => new Promise<void>((resolve, reject) => {
              setPublicCardProcessing(true);
              setPublicCardError(null);
              publicDeliveryApi.payWithCard(publicDeliveryCompanyId!, publicDeliveryOrderId!, {
                token: cardFormData.token,
                paymentMethodId: cardFormData.payment_method_id,
                issuerId: cardFormData.issuer_id,
                payerEmail: cardFormData.payer?.email,
                payerDocType: cardFormData.payer?.identification?.type,
                payerDocNumber: cardFormData.payer?.identification?.number,
              }).then((result) => {
                setPublicCardProcessing(false);
                if (result.status === 'approved') {
                  setPublicDeliveryStep('success');
                  resolve();
                } else if (result.status === 'rejected') {
                  setPublicCardError('Pagamento recusado. Verifique os dados ou tente outro cartão.');
                  reject(new Error('Pagamento recusado.'));
                } else {
                  // in_process/pending — aguarda confirmação assíncrona (webhook)
                  setPublicDeliveryStep('payment_return');
                  resolve();
                }
              }).catch((e: any) => {
                setPublicCardProcessing(false);
                setPublicCardError(e?.message ?? 'Falha ao processar pagamento.');
                reject(e);
              });
            }),
          },
        });
        publicCardBrickControllerRef.current = controller;
      } catch (e) {
        console.error('Falha ao montar formulário de cartão', e);
        if (!cancelled) setPublicCardError('Falha ao carregar formulário de pagamento. Recarregue a página.');
      }
    };

    void mount();

    return () => {
      cancelled = true;
      if (publicCardBrickControllerRef.current?.unmount) {
        try { publicCardBrickControllerRef.current.unmount(); } catch { /* já desmontado */ }
      }
      publicCardBrickControllerRef.current = null;
    };
  }, [publicDeliveryStep, publicCardMpPublicKey, publicDeliveryOrderId, publicDeliveryCompanyId]);

  const openTabs = useMemo(() => {
    const grouped = new Map<string, {
      tabId: string;
      tableId: string;
      tableName: string;
      orders: Order[];
    }>();

    orders
      .filter((order) => order.tabStatus === 'ABERTA' && order.status !== 'CANCELADO')
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
    const baseUrl = window.location.protocol === 'file:'
      ? (import.meta.env.VITE_PUBLIC_URL ?? 'https://CONFIGURE-VITE_PUBLIC_URL-no-.env')
      : window.location.origin;
    return `${baseUrl}/?tableId=${encodeURIComponent(table.id)}`;
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

  // Remove acentos e caracteres não-ASCII (requisito do Banco Central para o payload PIX)
  const removeAccents = (str: string) =>
    str.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');

  // Usa a chave PIX exatamente como cadastrada pelo usuário.
  // Não tenta adivinhar o tipo — CPF e telefone têm 11 dígitos e são indistinguíveis sem contexto.
  // O usuário deve copiar a chave diretamente do seu banco (ex: +5587999710850 para telefone).
  const normalizePixKey = (key: string): string => {
    const clean = key.trim();
    // Apenas normaliza email para minúsculo
    if (clean.includes('@')) return clean.toLowerCase();
    return clean;
  };

  const getPixBrCode = (pixKey: string, amount: number, txid: string, merchantName: string, merchantCity: string) => {
    const normalizedKey = normalizePixKey(pixKey);
    // Remove acentos e limita tamanhos conforme spec do Banco Central
    const sanitizedName = removeAccents(merchantName.trim()).substring(0, 25).toUpperCase() || 'ESTABELECIMENTO';
    // Usa só a cidade (não o endereço completo) — pega primeira parte antes de vírgula
    const cityOnly = (merchantCity || 'SAO PAULO').split(',')[0].split('-')[0].trim();
    const sanitizedCity = removeAccents(cityOnly).substring(0, 15).toUpperCase() || 'SAO PAULO';
    const txidValue = txid.replace(/[^A-Za-z0-9]/g, '').substring(0, 25) || 'INTEGRA360';

    const payloadWithoutCrc = [
      formatPixField('00', '01'),
      formatPixField('01', '12'),   // 12 = QR dinâmico (recomendado pelo BC para valor fixo)
      formatPixField('26', `${formatPixField('00', 'BR.GOV.BCB.PIX')}${formatPixField('01', normalizedKey)}`),
      formatPixField('52', '0000'),
      formatPixField('53', '986'),
      formatPixField('54', amount.toFixed(2)),
      formatPixField('58', 'BR'),
      formatPixField('59', sanitizedName),
      formatPixField('60', sanitizedCity),
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
  const [isCashOpen, setIsCashOpen] = useState(false);
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

  const openCloseModal = () => { setClosePaidValue(''); setClosePaymentMethod('DINHEIRO'); setShowCloseModal(true); };
  const [pixQrUrl, setPixQrUrl] = useState<string | null>(null);
  const [pixPayload, setPixPayload] = useState<string | null>(null);
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);
  const [pixPaymentStatus, setPixPaymentStatus] = useState<string | null>(null);
  const [pixAmount, setPixAmount] = useState<number | null>(null);
  const [pixPendingTabId, setPixPendingTabId] = useState<string | null>(null);
  const [showPixModal, setShowPixModal] = useState(false);
  const [confirmingPix, setConfirmingPix] = useState(false);
  const [mpCharge, setMpCharge] = useState<{ mpPaymentId: string; status: string; qrCodeBase64: string | null; qrCode: string | null } | null>(null);
  const [mpChargeLoading, setMpChargeLoading] = useState(false);
  const [mpChargeChecking, setMpChargeChecking] = useState(false);

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
    setConfirmingPix(true);
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
      void printCashierReceipt({
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
      showToast('Pagamento PIX confirmado!', 'success');
    } catch (err) {
      console.error('Erro ao fechar comanda após Pix', err);
      showToast('Erro ao encerrar comanda: ' + ((err as any)?.message ?? String(err)), 'error');
    } finally {
      setConfirmingPix(false);
    }
  };

  const startPixPayment = async (tabId: string, total: number) => {
    try {
      const response = await api.initiatePixPayment(tabId, total);
      setPixPaymentId(response.paymentId);
      setPixPaymentStatus('PENDENTE');
      setPixAmount(response.amount);
      setPixPendingTabId(tabId);
      const payload = getPixBrCode(storePixKey, response.amount, response.paymentId ?? tabId, storeName, storeCity || 'SAO PAULO');
      setPixPayload(payload);
      setPixQrUrl(getQrCodeSrc(payload));
      setShowPixModal(true);
    } catch (err) {
      console.error('Erro ao iniciar pagamento PIX', err);
      showToast('Falha ao iniciar pagamento PIX: ' + ((err as any)?.message ?? String(err)), 'error');
    }
  };

  const handleConfirmClose = async () => {
    if (!selectedTable) return;
    try {
      const tableOrders = selectedTableOrders;
      if (tableOrders.length === 0) {
        return showToast('Não há comanda aberta para esta mesa.', 'warning');
      }

      const tabId = tableOrders[0]?.tabId;
      if (!tabId) {
        return showToast('Comanda sem identificação válida.', 'error');
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

      void printCashierReceipt({
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
      showToast('Erro ao encerrar mesa.', 'error');
    }
  };

  const buildReportHtml = () => {
    if (!reportSummary) return null;
    const dateRange = reportSummary.startDate === reportSummary.endDate
      ? new Date(reportSummary.startDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
      : `${new Date(reportSummary.startDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${new Date(reportSummary.endDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    const mesaTables = reportSummary.tables.filter((t) => t.tableId !== '__delivery__').sort((a, b) => b.totalValue - a.totalValue);
    const deliveryGroup = reportSummary.tables.find((t) => t.tableId === '__delivery__');
    const tableRows = mesaTables.map((t, i) => `
        <tr class="${i % 2 === 0 ? 'even' : ''}">
          <td>${t.tableName}</td>
          <td style="text-align:center">${t.totalItems}</td>
          <td style="text-align:right;font-weight:600">${formatCurrency(t.totalValue)}</td>
        </tr>`).join('');
    const deliveryRow = deliveryGroup ? `
        <tr style="background:#fffbeb">
          <td style="font-weight:600">🚲 Delivery (${deliveryGroup.totalItems} pedidos)</td>
          <td style="text-align:center">${deliveryGroup.totalItems}</td>
          <td style="text-align:right;font-weight:700">${formatCurrency(deliveryGroup.totalValue)}</td>
        </tr>` : '';
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Relatório Financeiro – ${reportSummary.periodLabel}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',Arial,sans-serif;background:#f4f6f4;color:#1a1e1a;font-size:14px;line-height:1.5}
    .page{background:#fff;max-width:800px;margin:0 auto;min-height:100vh;padding:0}
    .topbar{background:#18201d;padding:28px 40px 24px;display:flex;justify-content:space-between;align-items:flex-end}
    .topbar-brand{color:#f1c44e;font-size:20px;font-weight:700;letter-spacing:.5px}
    .topbar-meta{color:#9ab09f;font-size:12px;text-align:right}
    .topbar-meta strong{display:block;color:#fff;font-size:15px;margin-bottom:2px}
    .content{padding:32px 40px 40px}
    .period-badge{display:inline-block;background:#f1c44e;color:#18201d;font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;padding:4px 12px;border-radius:20px;margin-bottom:20px}
    .section-title{font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#6b7a6b;margin-bottom:14px}
    .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px}
    .metric{background:#f8faf8;border:1px solid #dbe3de;border-radius:12px;padding:20px 18px}
    .metric label{font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#7a8a7a;display:block;margin-bottom:8px}
    .metric value{font-size:26px;font-weight:700;color:#18201d;display:block}
    .metric.highlight{background:#18201d;border-color:#18201d}
    .metric.highlight label{color:#9ab09f}
    .metric.highlight value{color:#f1c44e}
    table{width:100%;border-collapse:collapse}
    thead tr{background:#18201d}
    thead th{color:#9ab09f;font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;padding:12px 16px;text-align:left}
    thead th:nth-child(2){text-align:center}
    thead th:last-child{text-align:right}
    tbody tr{border-bottom:1px solid #eef1ee}
    tbody tr.even{background:#f8faf8}
    tbody td{padding:12px 16px;color:#2a342a}
    tfoot tr{background:#f1f4f1;border-top:2px solid #dbe3de}
    tfoot td{padding:12px 16px;font-weight:700;color:#18201d}
    .footer{margin-top:32px;padding-top:20px;border-top:1px solid #eef1ee;display:flex;justify-content:space-between;color:#9ab09f;font-size:11px}
  </style>
</head>
<body>
<div class="page">
  <div class="topbar">
    <div class="topbar-brand">Sistema Shawarma</div>
    <div class="topbar-meta">
      <strong>Relatório Financeiro</strong>
      ${dateRange}
    </div>
  </div>
  <div class="content">
    <div class="period-badge">${reportSummary.periodLabel}</div>
    <div class="section-title">Resumo do período</div>
    <div class="metrics">
      <div class="metric">
        <label>Pedidos</label>
        <value>${reportSummary.totalOrders}</value>
      </div>
      <div class="metric">
        <label>Itens vendidos</label>
        <value>${reportSummary.totalItems}</value>
      </div>
      <div class="metric highlight">
        <label>Faturamento total</label>
        <value>${formatCurrency(reportSummary.totalValue)}</value>
      </div>
    </div>
    <div class="section-title">Detalhamento por origem</div>
    <table>
      <thead>
        <tr><th>Origem</th><th>Itens / Pedidos</th><th>Valor</th></tr>
      </thead>
      <tbody>${tableRows}${deliveryRow}</tbody>
      <tfoot>
        <tr>
          <td>Total geral</td>
          <td style="text-align:center">${reportSummary.totalItems}</td>
          <td style="text-align:right">${formatCurrency(reportSummary.totalValue)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="footer">
      <span>Sistema Shawarma – Relatório gerado automaticamente</span>
      <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
    </div>
  </div>
</div>
</body>
</html>`;
  };

  const exportReportPdf = async () => {
    const html = buildReportHtml();
    if (!html) return showToast('Relatório ainda não foi carregado.', 'warning');

    if (!window.sistema?.saveReportPdf) {
      console.warn('API de PDF indisponível: window.sistema.saveReportPdf não encontrada, usando fallback de navegador');
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const popup = window.open(url, '_blank');
      if (!popup) return showToast('Exportação de PDF bloqueada pelo navegador.', 'warning');
      popup.focus();
      try { popup.print(); } catch (e) { /* ignore */ }
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }

    try {
      const result = await window.sistema.saveReportPdf(html);
      if (result.canceled) return;
      showToast(`Relatório salvo em ${result.filePath}`, 'success');
    } catch (error) {
      console.error('Erro ao exportar PDF', error);
      showToast('Falha ao gerar o arquivo PDF.', 'error');
    }
  };

  const previewReportPdf = async () => {
    const html = buildReportHtml();
    if (!html) return showToast('Relatório ainda não foi carregado.', 'warning');

    if (!window.sistema?.previewReportPdf) {
      console.warn('API de PDF indisponível: window.sistema.previewReportPdf não encontrada, usando fallback de navegador');
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const popup = window.open(url, '_blank');
      if (!popup) return showToast('Visualização de PDF bloqueada pelo navegador.', 'warning');
      popup.focus();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }

    try {
      const result = await window.sistema.previewReportPdf(html);
      if (result.canceled) return;
    } catch (error) {
      console.error('Erro ao pré-visualizar PDF', error);
      showToast('Falha ao visualizar o PDF.', 'error');
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
          // session exists but user load failed — clear invalid session and stay on login
          void supabase.auth.signOut();
        });
      }
    });

    // Detecta expiração/invalidação de sessão em tempo real
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        if (event === 'SIGNED_OUT') {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setCurrentCompany(null);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Escuta eventos do auto-updater após a splash para mostrar botão na topbar
  useEffect(() => {
    const sistema = (window as any).sistema;
    if (!sistema?.onUpdaterStatus) return;
    const unsub = sistema.onUpdaterStatus((data: any) => {
      switch (data.event) {
        case 'checking-for-update':
          setUpdateStatus('checking');
          break;
        case 'update-available':
          setUpdateStatus('available');
          setUpdateVersion(data.version ?? null);
          break;
        case 'download-progress':
          setUpdateStatus('downloading');
          setUpdateProgress(data.percent ?? 0);
          break;
        case 'update-downloaded':
          setUpdateStatus('ready');
          break;
        case 'update-not-available':
          setUpdateStatus('idle');
          break;
        case 'error':
          setUpdateStatus('error');
          break;
      }
    });
    return () => { try { unsub?.(); } catch { /* */ } };
  }, []);

  // Listen for unauthorized events emitted by the API layer (e.g. token expired or invalid)
  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setCurrentCompany(null);
      // notify user to re-login
      try {
        showToast('Sessão expirada. Faça login novamente.', 'warning');
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
        closeActionMenu();
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

  const handlePasswordRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoverEmail.trim()) { setRecoverError('Informe seu e-mail.'); return; }
    setRecoverLoading(true);
    setRecoverError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(recoverEmail.trim(), {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
      setRecoverSent(true);
    } catch (err: any) {
      setRecoverError(err?.message ?? 'Não foi possível enviar o e-mail. Tente novamente.');
    } finally {
      setRecoverLoading(false);
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
      const [tablesResult, productsResult, ordersResult, kitchenResult, cashResult, cashOpenResult, reportResult, deliveryKitchenResult] = await Promise.allSettled([
        api.tables(),
        api.products(),
        hasOrdersAccess ? api.orders() : Promise.resolve([] as Order[]),
        hasKitchenAccess ? api.kitchenQueue() : Promise.resolve([] as Order[]),
        hasCashAccess ? api.cashRegisterCurrent() : Promise.resolve(null),
        api.isCashRegisterOpen(),
        hasReportAccess ? api.reportSummary(reportPeriod, reportRefDate) : Promise.resolve(null),
        hasKitchenAccess ? api.listDeliveryOrders('EM_PREPARO') : Promise.resolve([])
      ]);

      setApiStatus('online');
      if (tablesResult.status === 'fulfilled') setTables(tablesResult.value);
      if (productsResult.status === 'fulfilled') setProducts(productsResult.value);
      if (ordersResult.status === 'fulfilled') setOrders(ordersResult.value);
      if (kitchenResult.status === 'fulfilled') setKitchenOrders(kitchenResult.value);
      if (cashResult.status === 'fulfilled') setCashRegister(cashResult.value ?? null);
      if (cashOpenResult.status === 'fulfilled') setIsCashOpen(cashOpenResult.value);
      if (reportResult.status === 'fulfilled') setReportSummary(reportResult.value ?? null);
      if (deliveryKitchenResult.status === 'fulfilled') setKitchenDeliveryOrders(deliveryKitchenResult.value as DeliveryOrder[]);
      initialLoadDone.current = true;
    } catch {
      setApiStatus('offline');
      initialLoadDone.current = true;
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
  }, [isAuthenticated, reportPeriod, reportRefDate, currentUser, activeModule, selectedReportCompany]);

  // Auto-refresh: cozinha + mesas + delivery a cada 3s, só após o carregamento inicial
  useEffect(() => {
    if (!isAuthenticated || !currentUser || currentUser.role === 'SUPER') return;

    let running = true;

    const tick = async () => {
      if (!running || !initialLoadDone.current) return;
      try {
        await reloadTablesAndOrders();
      } catch (e) {
        console.error('[auto-refresh] reloadTablesAndOrders:', e);
      }
      if (!running) return;
      try {
        const deliveryOrders = await api.listDeliveryOrders('EM_PREPARO');
        if (running) setKitchenDeliveryOrders(deliveryOrders as DeliveryOrder[]);
      } catch {
        // usuário sem acesso a delivery — ignora silenciosamente
      }
    };

    const intervalId = setInterval(() => { void tick(); }, 3000);

    return () => {
      running = false;
      clearInterval(intervalId);
    };
  }, [isAuthenticated, currentUser]);

  const createOrder = async (
    tableId: string,
    cartItems: Array<{ productId: string; quantity: number; note?: string; productName: string; unitPrice: number }>,
    tableName: string,
  ) => {
    // Optimistic update
    const optimisticOrder: Order = {
      id: `optimistic-${Date.now()}`,
      tableId,
      tableName,
      status: 'ENVIADO',
      items: cartItems.map((ci, idx) => ({
        id: `opt-item-${Date.now()}-${idx}`,
        productId: ci.productId,
        productName: ci.productName,
        quantity: ci.quantity,
        unitPrice: ci.unitPrice,
        note: ci.note,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setOrders((prev) => [...prev, optimisticOrder]);
    setKitchenOrders((prev) => [...prev, optimisticOrder]);

    try {
      await api.createOrder(tableId, cartItems.map((ci) => ({ productId: ci.productId, quantity: ci.quantity, note: ci.note })));
    } catch (err: any) {
      setOrders((prev) => prev.filter((o) => !o.id.startsWith('optimistic-')));
      setKitchenOrders((prev) => prev.filter((o) => !o.id.startsWith('optimistic-')));
      showToast('Erro ao criar pedido: ' + (err?.message ?? String(err)), 'error');
      return;
    }

    // Imprime ticket da cozinha com todos os itens e observações
    void printKitchenTicket({
      type: 'MESA',
      tableName,
      items: cartItems.map((ci) => ({ name: ci.productName, quantity: ci.quantity, note: ci.note || undefined })),
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    });

    void reloadTablesAndOrders();
  };

  const advanceOrder = async (order: Order) => {
    const nextStatus = order.status === 'ENVIADO' ? 'EM_PREPARO' : order.status === 'EM_PREPARO' ? 'PRONTO' : 'ENTREGUE';
    // Optimistic update — UI responde imediatamente
    setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: nextStatus as Order['status'] } : o));
    try {
      await api.updateOrderStatus(order.id, nextStatus);
      // Sincroniza em background sem bloquear a UI
      void reloadTablesAndOrders();
    } catch (err: any) {
      // Reverte em caso de erro
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: order.status } : o));
      showToast('Erro ao avançar pedido: ' + (err?.message ?? String(err)), 'error');
    }
  };

  const loadCategories = async () => {
    try {
      const list = await api.categories();
      setCategories(list);
      if (list.length > 0 && !newProductCategoryId) setNewProductCategoryId(list[0].id);
    } catch { /* silencioso */ }
  };

  const createCategory = async () => {
    if (!newCategoryName.trim()) return showToast('Digite o nome da categoria.', 'warning');
    try {
      await api.createCategory(newCategoryName.trim());
      setNewCategoryName('');
      setShowCategoryForm(false);
      await loadCategories();
      showToast('Categoria criada!', 'success');
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const printKitchenTicket = async (ticketData: Parameters<typeof generateKitchenTicketHTML>[0]) => {
    if (printingDisabled) return;
    const html = generateKitchenTicketHTML(ticketData);
    const sistema = (window as any).sistema;
    if (sistema?.printSilent && printerKitchen) {
      const result = await sistema.printSilent(html, printerKitchen);
      if (!result?.success) showToast(`Erro ao imprimir na cozinha: ${result?.reason ?? ''}`, 'error');
    } else if (sistema?.printSilent && !printerKitchen) {
      showToast('Impressora da cozinha não configurada. Configure em Ajustes.', 'warning');
    } else {
      // Web: abre janela para impressão manual
      const w = window.open('', '_blank', 'width=240,height=600');
      if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    }
  };

  const printCashierReceipt = async (data: Parameters<typeof generateThermalHTML>[0]) => {
    if (printingDisabled) return;
    const sistema = (window as any).sistema;
    if (sistema?.printSilent && printerCashier) {
      const html = generateThermalHTML(data);
      const result = await sistema.printSilent(html, printerCashier);
      if (!result?.success) showToast(`Erro ao imprimir recibo: ${result?.reason ?? ''}`, 'error');
    } else {
      printReceipt(data);
    }
  };

  const loadDeliveryOrders = async () => {
    setLoadingDelivery(true);
    try {
      const [active, all] = await Promise.all([
        api.listDeliveryOrders(),
        api.listDeliveryOrders('all')
      ]);
      setDeliveryOrders(active as DeliveryOrder[]);
      setDeliveryOrdersAll(all as DeliveryOrder[]);
    } catch (e) {
      showToast('Falha ao carregar pedidos de delivery.', 'error');
    } finally {
      setLoadingDelivery(false);
    }
  };

  const addDeliveryItem = () => {
    const product = products.find((p) => p.id === dlvSelectedProduct);
    if (!product && !dlvSelectedProduct) return showToast('Selecione um produto.', 'warning');
    const item = product
      ? { productId: product.id, productName: product.name, quantity: Number(dlvProductQty) || 1, unitPrice: product.price, note: dlvProductNote }
      : { productName: dlvSelectedProduct, quantity: Number(dlvProductQty) || 1, unitPrice: 0, note: dlvProductNote };
    setDlvItems((prev) => [...prev, item]);
    setDlvSelectedProduct('');
    setDlvProductSearch('');
    setDlvProductDropdownOpen(false);
    setDlvProductQty('1');
    setDlvProductNote('');
  };

  const removeDeliveryItem = (idx: number) => setDlvItems((prev) => prev.filter((_, i) => i !== idx));

  const submitDeliveryOrder = async () => {
    if (!dlvCustomerName.trim()) return showToast('Informe o nome do cliente.', 'warning');
    if (!dlvCustomerAddress.trim()) return showToast('Informe o endereço de entrega.', 'warning');
    if (dlvItems.length === 0) return showToast('Adicione pelo menos um item.', 'warning');
    try {
      await api.createDeliveryOrder({
        customerName: dlvCustomerName,
        customerPhone: dlvCustomerPhone,
        customerAddress: dlvCustomerAddress,
        paymentMethod: dlvPaymentMethod,
        deliveryFee: Number(dlvDeliveryFee.replace(',', '.')) || 0,
        notes: dlvNotes,
        items: dlvItems
      });
      // Imprime ticket na cozinha automaticamente
      await printKitchenTicket({
        type: 'DELIVERY',
        customerName: dlvCustomerName,
        customerPhone: dlvCustomerPhone,
        customerAddress: dlvCustomerAddress,
        paymentMethod: dlvPaymentMethod,
        items: dlvItems.map((i) => ({ name: i.productName, quantity: i.quantity, note: i.note })),
        notes: dlvNotes,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      });

      setDlvCustomerName(''); setDlvCustomerPhone(''); setDlvCustomerAddress('');
      setDlvPaymentMethod('DINHEIRO'); setDlvDeliveryFee('0'); setDlvNotes('');
      setDlvItems([]); setDlvTab('ativos');
      showToast('Pedido de delivery criado!', 'success');
      await loadDeliveryOrders();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const printDeliveryReceipt = async (order: DeliveryOrder) => {
    try {
      const subtotal = order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const receiptNumber = await api.assignDeliveryReceiptNumber(order.id);
      const deliveryInfo = [
        order.customerPhone ? `Tel: ${order.customerPhone}` : null,
        `End: ${order.customerAddress}`
      ].filter(Boolean).join(' | ');
      void printCashierReceipt({
        companyName: storeName,
        cnpj: storeCnpj ? `CNPJ: ${storeCnpj}` : undefined,
        address: storeAddress,
        phone: storePhone,
        receiptNumber,
        tableName: `DELIVERY — ${order.customerName}`,
        consumer: deliveryInfo,
        items: order.items.map((i) => ({ name: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, total: i.quantity * i.unitPrice })),
        subtotal,
        total: order.total,
        paymentMethod: order.paymentMethod,
        nota: order.deliveryFee > 0 ? `Taxa entrega: ${formatCurrency(order.deliveryFee)}` : undefined,
      });
    } catch (e) {
      showToast('Erro ao gerar recibo.', 'error');
    }
  };

  const advanceDeliveryStatus = async (order: DeliveryOrder) => {
    const next: Record<string, string> = {
      RECEBIDO: 'EM_PREPARO',
      EM_PREPARO: 'SAIU_PARA_ENTREGA',
      SAIU_PARA_ENTREGA: 'ENTREGUE'
    };
    const nextStatus = next[order.status];
    if (!nextStatus) return;
    // Optimistic update — UI responde imediatamente
    const applyStatus = (prev: DeliveryOrder[]) =>
      prev.map((o) => o.id === order.id ? { ...o, status: nextStatus } : o);
    setDeliveryOrders(applyStatus);
    setDeliveryOrdersAll(applyStatus);
    if (nextStatus === 'ENTREGUE') showToast('Pedido entregue! ✓', 'success');
    try {
      await api.updateDeliveryStatus(order.id, nextStatus);
      // Ao entregar, aguarda o número ser gravado antes de recarregar a lista
      if (nextStatus === 'ENTREGUE') await api.assignDeliveryReceiptNumber(order.id);
      void loadDeliveryOrders();
    } catch (e) {
      // Reverte em caso de erro
      const revert = (prev: DeliveryOrder[]) =>
        prev.map((o) => o.id === order.id ? { ...o, status: order.status } : o);
      setDeliveryOrders(revert);
      setDeliveryOrdersAll(revert);
      showToast((e as Error).message, 'error');
    }
  };

  const cancelDeliveryOrder = async (order: DeliveryOrder) => {
    confirmAction(`Cancelar pedido de ${order.customerName}?`, async () => {
      try {
        await api.updateDeliveryStatus(order.id, 'CANCELADO');
        await loadDeliveryOrders();
        showToast('Pedido cancelado.', 'info');
      } catch (e: any) {
        showToast(e?.message || 'Erro ao cancelar pedido.', 'error');
      }
    });
  };

  const startEditProduct = (product: any) => {
    setEditingProduct(product);
    setNewProductName(product.name);
    setNewProductDescription(product.description ?? '');
    setNewProductPrice(String(product.price));
    setNewProductPreparationMinutes(String(product.preparationMinutes ?? 10));
    setNewProductCategoryId(product.categoryId ?? '');
    setNewProductImageFile(null);
    setNewProductImagePreview(product.imageUrl ?? null);
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setNewProductName('');
    setNewProductDescription('');
    setNewProductPrice('');
    setNewProductPreparationMinutes('10');
    setNewProductCategoryId(categories[0]?.id ?? '');
    setNewProductImageFile(null);
    setNewProductImagePreview(null);
  };

  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPrice = Number(newProductPrice.replace(',', '.'));
    if (!newProductName.trim() || Number.isNaN(normalizedPrice) || normalizedPrice <= 0) {
      showToast('Preencha nome e preço válido.', 'warning');
      return;
    }
    try {
      if (editingProduct) {
        let imageUrl: string | null | undefined = undefined;
        if (newProductImageFile) {
          imageUrl = await api.uploadProductImage(newProductImageFile, editingProduct.id);
        }
        await api.updateProduct(editingProduct.id, {
          name: newProductName,
          description: newProductDescription,
          price: normalizedPrice,
          preparationMinutes: Number(newProductPreparationMinutes || 0),
          categoryId: newProductCategoryId || undefined,
          ...(imageUrl !== undefined && { imageUrl }),
        });
        showToast('Produto atualizado!', 'success');
      } else {
        const created = await api.createProduct({
          name: newProductName,
          description: newProductDescription,
          price: normalizedPrice,
          preparationMinutes: Number(newProductPreparationMinutes || 0),
          categoryId: newProductCategoryId || undefined,
        });
        if (newProductImageFile) {
          const imageUrl = await api.uploadProductImage(newProductImageFile, created.id);
          await api.updateProduct(created.id, { imageUrl });
        }
        showToast('Produto criado!', 'success');
      }
      cancelEdit();
      await loadData();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  // Splash screen — onDone must be stable (useCallback) to avoid resetting
  // splash timers on every App re-render caused by async state updates.
  const handleSplashDone = useCallback(() => setShowSplash(false), []);
  if (showSplash) {
    return <SplashScreen onDone={handleSplashDone} />;
  }

  // Página pública de delivery — deve ficar ANTES do login
  if (publicDeliveryCompanyId) {
    const cartTotal = publicDeliveryCart.reduce((s, i) => s + i.quantity * i.product.price, 0);
    const grandTotal = cartTotal + publicDeliveryFee;
    const cartCount = publicDeliveryCart.reduce((s, i) => s + i.quantity, 0);
    return (
      <main style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#18201d', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ width: 40, height: 40, background: '#f1c44e', borderRadius: 10, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18, color: '#18201d' }}>
            {publicDeliveryCompany?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{publicDeliveryCompany?.name ?? 'Carregando...'}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Cardápio digital · Delivery</div>
          </div>
          {publicDeliveryStep === 'checkout' && (
            <button type="button" onClick={() => setPublicDeliveryStep('menu')}
              style={{ marginLeft: 'auto', background: 'transparent', color: '#9ca3af', border: '1px solid #374151', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>
              Voltar ao cardapio
            </button>
          )}
        </div>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px' }}>
          {publicDeliveryError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', marginBottom: 16, fontSize: 14 }}>
              {publicDeliveryError}
            </div>
          )}
          {/* Tela de aguardo após retorno do Checkout Pro */}
          {publicDeliveryStep === 'payment_return' && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>⏳</div>
              <h2 style={{ margin: '0 0 10px', fontSize: 22 }}>Confirmando pagamento…</h2>
              <p style={{ color: '#6b7280', marginBottom: 28, fontSize: 15, lineHeight: 1.5 }}>
                Estamos aguardando a confirmação do <strong>Mercado Pago</strong>.<br />
                Isso pode levar alguns segundos. Não feche esta página.
              </p>
              {/* Spinner animado */}
              <div style={{ width: 48, height: 48, border: '5px solid #e5e7eb', borderTop: '5px solid #009ee3', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
              <p style={{ color: '#9ca3af', fontSize: 13 }}>A página atualiza automaticamente.</p>
            </div>
          )}

          {publicDeliveryStep === 'payment' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 48 }}>💳</div>
              <h2 style={{ margin: '12px 0 6px', fontSize: 20 }}>Pague com Pix para confirmar</h2>
              <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
                Seu pedido só será enviado para <strong>{publicDeliveryCompany?.name}</strong> após a confirmação do pagamento.
              </p>
              {publicPixLoading && <p style={{ color: '#6b7280' }}>Gerando cobrança Pix...</p>}
              {publicPixError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', marginBottom: 16, fontSize: 14 }}>
                  {publicPixError}
                  <div style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => publicDeliveryOrderId && void generatePublicPixCharge(publicDeliveryOrderId)}
                      style={{ background: '#18201d', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                      Tentar novamente
                    </button>
                  </div>
                </div>
              )}
              {publicPixCharge && (
                <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb', marginBottom: 20, display: 'inline-block' }}>
                  {publicPixCharge.qrCodeBase64 && (
                    <img src={`data:image/png;base64,${publicPixCharge.qrCodeBase64}`} alt="QR Code Pix" style={{ width: 220, height: 220, display: 'block', margin: '0 auto 12px' }} />
                  )}
                  {publicPixCharge.qrCode && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>Pix copia e cola</div>
                      <textarea readOnly value={publicPixCharge.qrCode} rows={3}
                        style={{ width: 280, fontSize: 11, padding: 8, border: '1px solid #e5e7eb', borderRadius: 8, resize: 'none' }} />
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(publicPixCharge.qrCode || ''); showToast('Código Pix copiado!', 'success'); }}
                        style={{ background: '#18201d', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                        Copiar código
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div style={{ color: '#6b7280', fontSize: 13 }}>
                ⏳ Aguardando confirmação do pagamento... a página atualiza automaticamente.
              </div>
            </div>
          )}

          {publicDeliveryStep === 'card_payment' && (
            <div style={{ padding: '20px 4px' }}>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 40 }}>💳</div>
                <h2 style={{ margin: '10px 0 4px', fontSize: 19 }}>Pagamento com cartão</h2>
                <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
                  Somente à vista (1x) · {formatCurrency(publicDeliverySnapshot?.grandTotal ?? 0)}
                </p>
              </div>
              {publicCardError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', marginBottom: 16, fontSize: 14, textAlign: 'center' }}>
                  {publicCardError}
                </div>
              )}
              {!publicCardBrickReady && !publicCardError && (
                <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Carregando formulário de pagamento...</p>
              )}
              {publicCardProcessing && (
                <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 13 }}>⏳ Processando pagamento...</p>
              )}
              <div id="publicCardPaymentBrick" style={{ maxWidth: 420, margin: '0 auto' }} />
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button type="button" onClick={() => setPublicDeliveryStep('checkout')}
                  style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
                  Voltar e escolher outra forma de pagamento
                </button>
              </div>
            </div>
          )}
          {publicDeliveryStep === 'success' && (() => {
            const paymentLabelMap: Record<string, string> = { ONLINE: 'Pagamento online (Mercado Pago)', DINHEIRO: 'Dinheiro', PIX: 'PIX (na entrega)', CREDITO: 'Cartão de crédito', DEBITO: 'Cartão de débito', PIX_ONLINE: 'Pix (Mercado Pago)', CARTAO_ONLINE: 'Cartão à vista (Mercado Pago)' };
            const snap = publicDeliverySnapshot;
            const storePhone = publicDeliveryCompany?.phone?.replace(/\D/g, '') ?? '';
            const buildWhatsAppUrl = () => {
              const num = publicDeliveryReceiptNumber != null ? `#${publicDeliveryReceiptNumber}` : publicDeliveryOrderId ?? '';
              const itensTexto = snap ? snap.items.map((i) => `• ${i.quantity}x ${i.name}${i.note ? ` (${i.note})` : ''} — ${formatCurrency(i.quantity * i.unitPrice)}`).join('\n') : '';
              const pagamento = snap ? (paymentLabelMap[snap.paymentMethod] ?? snap.paymentMethod) : '';
              const total = snap ? formatCurrency(snap.grandTotal) : '';
              const msg = `Olá, ${publicDeliveryCompany?.name ?? 'restaurante'}! 🍽️\n\nAcabei de fazer um pedido pelo cardápio digital.\n\n📋 *Pedido ${num}*\n\n🛒 *Itens:*\n${itensTexto}\n\n💳 *Forma de pagamento:* ${pagamento}\n💰 *Total:* ${total}\n\nPor favor, confirme o recebimento! 😊`;
              return `https://wa.me/55${storePhone}?text=${encodeURIComponent(msg)}`;
            };
            return (
              <div style={{ textAlign: 'center', padding: '48px 16px 60px' }}>
                <div style={{ fontSize: 64 }}>✅</div>
                <h2 style={{ margin: '16px 0 8px', fontSize: 22 }}>Pedido confirmado!</h2>
                <p style={{ color: '#6b7280', marginBottom: 24, fontSize: 15 }}>
                  Seu pedido foi enviado para <strong>{publicDeliveryCompany?.name}</strong>.<br />Aguarde a confirmação da loja.
                </p>

                {/* Card do número do pedido */}
                <div style={{ background: '#fff', borderRadius: 14, padding: '20px 24px', border: '1px solid #e5e7eb', marginBottom: 24, display: 'inline-block', minWidth: 200 }}>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Número do pedido</div>
                  {publicDeliveryReceiptNumber != null
                    ? <div style={{ fontWeight: 800, fontSize: 40, color: '#18201d', letterSpacing: 3 }}>#{publicDeliveryReceiptNumber}</div>
                    : <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', wordBreak: 'break-all' }}>{publicDeliveryOrderId}</div>
                  }
                </div>

                {/* Resumo do pedido */}
                {snap && (
                  <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', marginBottom: 24, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 10 }}>Resumo</div>
                    {snap.items.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f9fafb' }}>
                        <span style={{ color: '#374151' }}>{item.quantity}x {item.name}{item.note ? <span style={{ color: '#9ca3af' }}> ({item.note})</span> : null}</span>
                        <span style={{ fontWeight: 600, color: '#18201d' }}>{formatCurrency(item.quantity * item.unitPrice)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14, marginTop: 10, paddingTop: 6, borderTop: '2px solid #f3f4f6' }}>
                      <span>Total</span>
                      <span>{formatCurrency(snap.grandTotal)}</span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                      💳 {paymentLabelMap[snap.paymentMethod] ?? snap.paymentMethod}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                  <button type="button"
                    onClick={() => { setPublicDeliveryTrackingStatus('RECEBIDO'); setPublicDeliveryStep('tracking'); }}
                    style={{ background: '#18201d', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 28px', cursor: 'pointer', fontWeight: 700, fontSize: 15, width: '100%', maxWidth: 360 }}>
                    🔍 Acompanhar pedido
                  </button>
                  {storePhone && (
                    <a href={buildWhatsAppUrl()} target="_blank" rel="noopener noreferrer"
                      style={{ background: '#25d366', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 28px', cursor: 'pointer', fontWeight: 700, fontSize: 15, width: '100%', maxWidth: 360, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxSizing: 'border-box' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      Enviar mensagem ao estabelecimento
                    </a>
                  )}
                  <button type="button" onClick={() => { setPublicDeliveryStep('menu'); setPublicDeliveryCart([]); setPublicDeliveryName(''); setPublicDeliveryPhone(''); setPublicDeliveryAddress(''); setPublicDeliveryNotes(''); setPublicDeliverySnapshot(null); }}
                    style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 10, padding: '11px 24px', cursor: 'pointer', fontWeight: 500, fontSize: 14, width: '100%', maxWidth: 360 }}>
                    Fazer novo pedido
                  </button>
                </div>
              </div>
            );
          })()}
          {publicDeliveryStep === 'tracking' && (() => {
            const STAGES: Array<{ key: string; label: string; icon: string; desc: string }> = [
              { key: 'RECEBIDO',           label: 'Aguardando aprovação', icon: '⏳', desc: 'O restaurante ainda não confirmou seu pedido.' },
              { key: 'EM_PREPARO',         label: 'Em preparo',           icon: '👨‍🍳', desc: 'Seu pedido está sendo preparado.' },
              { key: 'SAIU_PARA_ENTREGA', label: 'Saiu para entrega',    icon: '🛵', desc: 'Seu pedido está a caminho!' },
              { key: 'ENTREGUE',           label: 'Entregue',             icon: '🎉', desc: 'Pedido entregue. Bom apetite!' },
            ];
            const isCancelled = publicDeliveryTrackingStatus === 'CANCELADO';
            const isRefunded = isCancelled && publicDeliveryTrackingPaymentStatus === 'ESTORNADO';
            const currentIdx = isCancelled ? -1 : STAGES.findIndex((s) => s.key === publicDeliveryTrackingStatus);
            const currentStage = isCancelled ? null : STAGES[currentIdx];
            const isFinished = publicDeliveryTrackingStatus === 'ENTREGUE';

            const paymentLabelMap: Record<string, string> = { ONLINE: 'Pagamento online (Mercado Pago)', DINHEIRO: 'Dinheiro', PIX: 'PIX (na entrega)', CREDITO: 'Cartão de crédito', DEBITO: 'Cartão de débito', PIX_ONLINE: 'Pix (Mercado Pago)', CARTAO_ONLINE: 'Cartão à vista (Mercado Pago)' };
            const snap = publicDeliverySnapshot;
            const storePhone = publicDeliveryCompany?.phone?.replace(/\D/g, '') ?? '';
            const buildWhatsAppUrl = () => {
              const num = publicDeliveryReceiptNumber != null ? `#${publicDeliveryReceiptNumber}` : publicDeliveryOrderId ?? '';
              const itensTexto = snap ? snap.items.map((i) => `• ${i.quantity}x ${i.name}${i.note ? ` (${i.note})` : ''} — ${formatCurrency(i.quantity * i.unitPrice)}`).join('\n') : '';
              const pagamento = snap ? (paymentLabelMap[snap.paymentMethod] ?? snap.paymentMethod) : '';
              const total = snap ? formatCurrency(snap.grandTotal) : '';
              const msg = `Olá, ${publicDeliveryCompany?.name ?? 'restaurante'}! 🍽️\n\nGostaria de acompanhar meu pedido.\n\n📋 *Pedido ${num}*\n\n🛒 *Itens:*\n${itensTexto}\n\n💳 *Forma de pagamento:* ${pagamento}\n💰 *Total pago:* ${total}\n\nObrigado! 😊`;
              return `https://wa.me/55${storePhone}?text=${encodeURIComponent(msg)}`;
            };

            return (
              <div style={{ padding: '32px 0 40px' }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                  <div style={{ fontSize: 52 }}>{isRefunded ? '💸' : isCancelled ? '❌' : isFinished ? '🎉' : currentStage?.icon ?? '⏳'}</div>
                  <h2 style={{ margin: '12px 0 6px', fontSize: 20, fontWeight: 800 }}>
                    {isRefunded ? 'Estorno aprovado' : isCancelled ? 'Pedido cancelado' : isFinished ? 'Entregue!' : currentStage?.label ?? 'Aguardando...'}
                  </h2>
                  <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
                    {isRefunded
                      ? 'Seu pedido foi cancelado e o valor será devolvido em até 5 dias úteis.'
                      : isCancelled
                      ? 'Seu pedido foi cancelado pelo restaurante.'
                      : isFinished
                      ? 'Obrigado pela preferência!'
                      : currentStage?.desc ?? ''}
                  </p>
                  {isRefunded && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 14px', marginTop: 10, fontSize: 13, color: '#15803d', fontWeight: 600 }}>
                      ✓ Reembolso em processamento
                    </div>
                  )}
                  {publicDeliveryReceiptNumber != null && (
                    <div style={{ display: 'inline-block', background: '#f3f4f6', borderRadius: 8, padding: '4px 14px', marginTop: 10, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                      Pedido #{publicDeliveryReceiptNumber}
                    </div>
                  )}
                </div>

                {/* Etapas */}
                {!isCancelled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: '0 0 24px' }}>
                    {STAGES.map((stage, idx) => {
                      const done = idx < currentIdx;
                      const active = idx === currentIdx;
                      const pending = idx > currentIdx;
                      return (
                        <div key={stage.key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                              background: done ? '#16a34a' : active ? '#18201d' : '#f3f4f6',
                              border: active ? '3px solid #18201d' : done ? '3px solid #16a34a' : '2px solid #e5e7eb',
                              display: 'grid', placeItems: 'center', fontSize: 18,
                              transition: 'background 0.4s',
                            }}>
                              {done ? <span style={{ color: '#fff', fontSize: 16 }}>✓</span> : <span style={{ filter: pending ? 'grayscale(1) opacity(0.4)' : 'none' }}>{stage.icon}</span>}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: active ? 700 : done ? 600 : 400, fontSize: 15, color: pending ? '#9ca3af' : '#18201d' }}>{stage.label}</div>
                              {active && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{stage.desc}</div>}
                            </div>
                          </div>
                          {active && !isFinished && (
                            <div style={{ marginLeft: 54, marginBottom: 4 }}>
                              <div style={{ height: 4, borderRadius: 4, background: '#e5e7eb', overflow: 'hidden' }}>
                                <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #18201d, #4ade80)', width: `${publicDeliveryTrackingBar}%`, transition: 'width 0.06s linear' }} />
                              </div>
                            </div>
                          )}
                          {idx < STAGES.length - 1 && (
                            <div style={{ marginLeft: 19, width: 2, height: 16, background: done ? '#16a34a' : '#e5e7eb' }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Solicitar estorno — disponível quando pedido não está cancelado */}
                {!isCancelled && publicDeliveryOrderId && (
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                    {publicCancellationRequested ? (
                      <div style={{ textAlign: 'center', color: '#ea580c', fontWeight: 600, fontSize: 14 }}>
                        ⏳ Solicitação de cancelamento enviada. O estabelecimento irá analisar.
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#c2410c', marginBottom: 8 }}>Solicitar cancelamento / estorno</div>
                        <textarea
                          value={publicCancellationReason}
                          onChange={(e) => setPublicCancellationReason(e.target.value)}
                          placeholder="Descreva o motivo do cancelamento..."
                          rows={3}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #fed7aa', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                        />
                        {publicCancellationError && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 4 }}>{publicCancellationError}</div>}
                        <button
                          type="button"
                          disabled={publicCancellationSubmitting || !publicCancellationReason.trim()}
                          onClick={async () => {
                            if (!publicCancellationReason.trim() || !publicDeliveryOrderId) return;
                            setPublicCancellationSubmitting(true);
                            setPublicCancellationError(null);
                            try {
                              const result = await publicDeliveryApi.requestCancellation(publicDeliveryOrderId, publicCancellationReason.trim());
                              if (result.error) { setPublicCancellationError(result.error); }
                              else { setPublicCancellationRequested(true); setPublicCancellationReason(''); }
                            } catch { setPublicCancellationError('Falha ao enviar solicitação. Tente novamente.'); }
                            finally { setPublicCancellationSubmitting(false); }
                          }}
                          style={{ marginTop: 8, width: '100%', padding: '10px 0', background: publicCancellationSubmitting || !publicCancellationReason.trim() ? '#e5e7eb' : '#ea580c', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: publicCancellationSubmitting || !publicCancellationReason.trim() ? 'not-allowed' : 'pointer' }}>
                          {publicCancellationSubmitting ? 'Enviando...' : 'Solicitar cancelamento'}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Botão WhatsApp — sempre visível na tela de acompanhamento */}
                {storePhone && (
                  <a href={buildWhatsAppUrl()} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#25d366', color: '#fff', borderRadius: 12, padding: '13px 20px', fontWeight: 700, fontSize: 15, textDecoration: 'none', marginBottom: 12 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    Falar com o estabelecimento
                  </a>
                )}

                {/* Botões finais */}
                <div style={{ textAlign: 'center' }}>
                  {isFinished || isCancelled ? (
                    <button type="button"
                      onClick={() => { setPublicDeliveryStep('menu'); setPublicDeliveryCart([]); setPublicDeliveryName(''); setPublicDeliveryPhone(''); setPublicDeliveryAddress(''); setPublicDeliveryNotes(''); setPublicDeliverySnapshot(null); }}
                      style={{ background: '#18201d', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 28px', cursor: 'pointer', fontWeight: 600, fontSize: 15 }}>
                      Fazer novo pedido
                    </button>
                  ) : (
                    <button type="button"
                      onClick={() => setPublicDeliveryStep('success')}
                      style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 20px', cursor: 'pointer', fontSize: 14 }}>
                      ← Voltar
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          {publicDeliveryStep === 'checkout' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', fontWeight: 700, fontSize: 15 }}>Resumo do pedido</div>
                {publicDeliveryCart.map((item) => (
                  <div key={item.product.id} style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f9fafb' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{item.quantity}x {item.product.name}</span>
                      {item.note && <div style={{ fontSize: 12, color: '#9ca3af' }}>{item.note}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14 }}>{formatCurrency(item.quantity * item.product.price)}</span>
                      <button type="button" onClick={() => updatePublicCartItem(item.product.id, { quantity: item.quantity - 1 })}
                        style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontSize: 14, display: 'grid', placeItems: 'center' }}>-</button>
                    </div>
                  </div>
                ))}
                <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280' }}><span>Subtotal</span><span>{formatCurrency(cartTotal)}</span></div>
                {publicDeliveryFee > 0 && <div style={{ padding: '4px 16px 10px', display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280' }}><span>Taxa de entrega</span><span>{formatCurrency(publicDeliveryFee)}</span></div>}
                <div style={{ padding: '10px 16px 14px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, borderTop: '1px solid #f3f4f6' }}><span>Total</span><span>{formatCurrency(grandTotal)}</span></div>
              </div>
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Seus dados</div>
                  {publicDeliveryProfilePrefilled && (
                    <span style={{ fontSize: 12, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>
                      ✓ Dados do último pedido
                    </span>
                  )}
                </div>
                <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>Nome *<input value={publicDeliveryName} onChange={(e) => setPublicDeliveryName(e.target.value)} placeholder="Seu nome completo" style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14 }} /></label>
                <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>Telefone<input value={publicDeliveryPhone} onChange={(e) => setPublicDeliveryPhone(e.target.value)} placeholder="(00) 00000-0000" type="tel" style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14 }} /></label>
                <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>Endereco de entrega *<input value={publicDeliveryAddress} onChange={(e) => setPublicDeliveryAddress(e.target.value)} placeholder="Rua, numero, bairro" style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14 }} /></label>
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Forma de pagamento</label>
                  {/* 3 opções, pagamento processado dentro da própria plataforma */}
                  <div style={{ display: 'grid', gap: 8 }}>
                    {/* Cartão — à vista, formulário embutido (Mercado Pago Brick) */}
                    {publicDeliveryMpAvailable && (
                      <button type="button" onClick={() => setPublicDeliveryPayment('CARTAO_ONLINE')}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', border: publicDeliveryPayment === 'CARTAO_ONLINE' ? '2px solid #009ee3' : '2px solid #e5e7eb', background: publicDeliveryPayment === 'CARTAO_ONLINE' ? '#e8f6fd' : '#fff', transition: 'all .15s' }}>
                        <span style={{ fontSize: 26, flexShrink: 0 }}>💳</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: 'block', fontWeight: 700, fontSize: 15, color: '#18201d' }}>Cartão</span>
                          <span style={{ display: 'block', fontSize: 12, color: '#6b7280', marginTop: 2 }}>Crédito ou débito — somente à vista</span>
                        </span>
                        {publicDeliveryPayment === 'CARTAO_ONLINE' && <span style={{ color: '#009ee3', fontSize: 20, flexShrink: 0 }}>✓</span>}
                      </button>
                    )}
                    {/* Pix — QR code / copia e cola gerado na hora */}
                    {publicDeliveryMpAvailable && (
                      <button type="button" onClick={() => setPublicDeliveryPayment('PIX_ONLINE')}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', border: publicDeliveryPayment === 'PIX_ONLINE' ? '2px solid #009ee3' : '2px solid #e5e7eb', background: publicDeliveryPayment === 'PIX_ONLINE' ? '#e8f6fd' : '#fff', transition: 'all .15s' }}>
                        <span style={{ fontSize: 26, flexShrink: 0 }}>🔑</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: 'block', fontWeight: 700, fontSize: 15, color: '#18201d' }}>Pix</span>
                          <span style={{ display: 'block', fontSize: 12, color: '#6b7280', marginTop: 2 }}>QR code ou copia e cola — confirmação automática</span>
                        </span>
                        {publicDeliveryPayment === 'PIX_ONLINE' && <span style={{ color: '#009ee3', fontSize: 20, flexShrink: 0 }}>✓</span>}
                      </button>
                    )}
                    {/* Dinheiro na entrega */}
                    <button type="button" onClick={() => setPublicDeliveryPayment('DINHEIRO')}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', border: publicDeliveryPayment === 'DINHEIRO' ? '2px solid #18201d' : '2px solid #e5e7eb', background: publicDeliveryPayment === 'DINHEIRO' ? '#f3f4f6' : '#fff', transition: 'all .15s' }}>
                      <span style={{ fontSize: 26, flexShrink: 0 }}>💵</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontWeight: 700, fontSize: 15, color: '#18201d' }}>Dinheiro</span>
                        <span style={{ display: 'block', fontSize: 12, color: '#6b7280', marginTop: 2 }}>Pagamento na entrega</span>
                      </span>
                      {publicDeliveryPayment === 'DINHEIRO' && <span style={{ color: '#18201d', fontSize: 20, flexShrink: 0 }}>✓</span>}
                    </button>
                  </div>
                  {/* Aviso contextual */}
                  {(publicDeliveryPayment === 'CARTAO_ONLINE' || publicDeliveryPayment === 'PIX_ONLINE') && (
                    <div style={{ background: '#e8f6fd', border: '1px solid #93c5fd', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#1d4ed8', display: 'flex', gap: 8 }}>
                      <span>🔒</span>
                      <span>O pedido só é enviado ao restaurante <strong>após a confirmação do pagamento</strong>, feito aqui mesmo na página.</span>
                    </div>
                  )}
                  {publicDeliveryPayment === 'DINHEIRO' && (
                    <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#92400e', display: 'flex', gap: 8 }}>
                      <span>⚠️</span>
                      <span>Tenha o valor exato em mãos. O pedido é enviado imediatamente ao restaurante.</span>
                    </div>
                  )}
                </div>
                <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>Observações<textarea value={publicDeliveryNotes} onChange={(e) => setPublicDeliveryNotes(e.target.value)} placeholder="Alguma observação?" rows={2} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, resize: 'vertical' }} /></label>
              </div>
              <button type="button" onClick={() => void submitPublicDeliveryOrder()} disabled={publicDeliverySubmitting}
                style={{ background: publicDeliverySubmitting ? '#9ca3af' : '#18201d', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 20px', cursor: publicDeliverySubmitting ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {publicDeliverySubmitting
                  ? '⏳ Aguarde...'
                  : publicDeliveryPayment === 'CARTAO_ONLINE'
                    ? `💳 Ir para pagamento · ${formatCurrency(grandTotal)}`
                    : publicDeliveryPayment === 'PIX_ONLINE'
                      ? `🔑 Gerar Pix · ${formatCurrency(grandTotal)}`
                      : `✅ Confirmar pedido · ${formatCurrency(grandTotal)}`}
              </button>
            </div>
          )}
          {publicDeliveryStep === 'menu' && (() => {
            const topProducts = [...publicDeliveryProducts]
              .filter((p) => (p as any).salesCount > 0)
              .sort((a, b) => ((b as any).salesCount ?? 0) - ((a as any).salesCount ?? 0))
              .slice(0, 5);
            const hasTop = topProducts.length > 0;
            // Categorias que têm pelo menos 1 produto visível
            const visibleCats = publicDeliveryCategories.filter((cat) =>
              publicDeliveryProducts.some((p) => p.categoryId === cat.id)
            );
            // Tab ativa: 'top' | category.id | null (ainda carregando)
            const activeTab = publicDeliveryActiveCategory ??
              (hasTop ? 'top' : visibleCats[0]?.id ?? null);
            // Produtos da tab ativa
            const visibleProducts = activeTab === 'top'
              ? topProducts
              : publicDeliveryProducts.filter((p) => p.categoryId === activeTab);
            const activeCat = visibleCats.find((c) => c.id === activeTab);

            const renderProductCard = (product: typeof publicDeliveryProducts[0], isTop: boolean) => {
              const cartItem = publicDeliveryCart.find((i) => i.product.id === product.id);
              return (
                <div key={`${isTop ? 'top-' : ''}${product.id}`}
                  style={{ background: '#fff', borderRadius: 12, border: isTop ? '2px solid #f1c44e' : '1px solid #e5e7eb', overflow: 'hidden', display: 'flex', alignItems: 'stretch' }}>
                  <div style={{ flex: 1, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{product.name}</div>
                      {product.description && <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{product.description}</div>}
                      <div style={{ fontWeight: 700, color: '#18201d', fontSize: 15 }}>{formatCurrency(product.price)}</div>
                    </div>
                    {cartItem ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <button type="button" onClick={() => updatePublicCartItem(product.id, { quantity: cartItem.quantity - 1 })} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontSize: 18, display: 'grid', placeItems: 'center' }}>-</button>
                        <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{cartItem.quantity}</span>
                        <button type="button" onClick={() => { updatePublicCartItem(product.id, { quantity: cartItem.quantity + 1 }); setPublicDeliveryCartBounce(true); setTimeout(() => setPublicDeliveryCartBounce(false), 400); }} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#18201d', color: '#fff', cursor: 'pointer', fontSize: 18, display: 'grid', placeItems: 'center' }}>+</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => addToPublicCart(product)} style={{ background: '#18201d', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', flexShrink: 0 }}>+ Adicionar</button>
                    )}
                  </div>
                </div>
              );
            };

            return (
              <>
                {/* Banner do cardápio — edge-to-edge, fora do container com padding */}
                {publicDeliveryCompany?.menuBannerUrl && (
                  <div style={{ margin: '0 -16px', marginTop: -20 }}>
                    <img src={publicDeliveryCompany.menuBannerUrl} alt="Banner"
                      style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
                  </div>
                )}

                {/* Banner de retomada de pedido em andamento */}
                {publicDeliveryShowResumeBanner && publicDeliveryCart.length > 0 && (
                  <div style={{ background: 'linear-gradient(135deg, #18201d 0%, #2d3a36 100%)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', border: '1px solid #374151', marginTop: publicDeliveryCompany?.menuBannerUrl ? 12 : 0 }}>
                    <div style={{ fontSize: 28, flexShrink: 0 }}>🛒</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#f1c44e', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Pedido em andamento</div>
                      <div style={{ color: '#d1d5db', fontSize: 12 }}>
                        {publicDeliveryCart.reduce((s, i) => s + i.quantity, 0)} {publicDeliveryCart.reduce((s, i) => s + i.quantity, 0) === 1 ? 'item' : 'itens'} · {formatCurrency(publicDeliveryCart.reduce((s, i) => s + i.quantity * i.product.price, 0))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button type="button" onClick={() => { setPublicDeliveryShowResumeBanner(false); setPublicDeliveryStep('checkout'); }}
                        style={{ background: '#f1c44e', color: '#18201d', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Continuar
                      </button>
                      <button type="button" onClick={() => {
                        setPublicDeliveryShowResumeBanner(false);
                        setPublicDeliveryCart([]);
                        setPublicDeliveryName(''); setPublicDeliveryPhone('');
                        setPublicDeliveryAddress(''); setPublicDeliveryNotes('');
                        setPublicDeliveryOrderId(null);
                        clearPublicDeliveryState(publicDeliveryCompanyId!);
                      }} style={{ background: 'transparent', color: '#9ca3af', border: '1px solid #374151', borderRadius: 8, padding: '7px 10px', fontSize: 13, cursor: 'pointer' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {/* Tabs de categorias — sticky abaixo do header */}
                {(hasTop || visibleCats.length > 0) && (
                  <div style={{
                    position: 'sticky', top: 73, zIndex: 90,
                    margin: '0 -16px',
                    background: '#fff',
                    borderBottom: '2px solid #f3f4f6',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ display: 'flex', overflowX: 'auto', gap: 0, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                      {hasTop && (
                        <button type="button"
                          onClick={() => setPublicDeliveryActiveCategory('top')}
                          style={{
                            flexShrink: 0, border: 'none', background: 'transparent',
                            padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === 'top' ? 700 : 500,
                            color: activeTab === 'top' ? '#18201d' : '#6b7280',
                            borderBottom: activeTab === 'top' ? '2px solid #f1c44e' : '2px solid transparent',
                            display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                            transition: 'color .15s',
                          }}>
                          🔥 Mais pedidos
                        </button>
                      )}
                      {visibleCats.map((cat) => (
                        <button type="button" key={cat.id}
                          onClick={() => setPublicDeliveryActiveCategory(cat.id)}
                          style={{
                            flexShrink: 0, border: 'none', background: 'transparent',
                            padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === cat.id ? 700 : 500,
                            color: activeTab === cat.id ? '#18201d' : '#6b7280',
                            borderBottom: activeTab === cat.id ? '2px solid #f1c44e' : '2px solid transparent',
                            display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                            transition: 'color .15s',
                          }}>
                          {cat.imageUrl && (
                            <img src={cat.imageUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                          )}
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Card de informações: frete + horário */}
                {publicDeliveryCompany && ((() => {
                  const fee = publicDeliveryCompany.deliveryFeeAmount ?? 0;
                  const opening = publicDeliveryCompany.openingTime ?? '18:00';
                  const closing = publicDeliveryCompany.closingTime ?? '00:00';
                  // Verifica se está aberto agora (horário + flag manual)
                  const now = new Date();
                  const [oh, om] = opening.split(':').map(Number);
                  const [ch, cm] = closing.split(':').map(Number);
                  const nowMin = now.getHours() * 60 + now.getMinutes();
                  const openMin = (oh ?? 0) * 60 + (om ?? 0);
                  const closeMin = (ch ?? 0) * 60 + (cm ?? 0);
                  const isInHours = closeMin <= openMin
                    ? nowMin >= openMin || nowMin < closeMin
                    : nowMin >= openMin && nowMin < closeMin;
                  const manualIsOpen = publicDeliveryCompany.isOpen !== false;
                  const isOpen = manualIsOpen && isInHours;
                  return (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {/* Frete */}
                      <div style={{ flex: 1, minWidth: 130, background: fee === 0 ? '#f0fdf4' : '#fff', border: `1px solid ${fee === 0 ? '#bbf7d0' : '#e5e7eb'}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 20 }}>🛵</span>
                        <div>
                          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Entrega</div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: fee === 0 ? '#16a34a' : '#18201d' }}>
                            {fee === 0 ? 'Grátis' : formatCurrency(fee)}
                          </div>
                        </div>
                      </div>
                      {/* Horário */}
                      <div style={{ flex: 1, minWidth: 130, background: isOpen ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isOpen ? '#bbf7d0' : '#fca5a5'}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 20 }}>🕐</span>
                        <div>
                          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Horário</div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: isOpen ? '#16a34a' : '#b91c1c' }}>
                            {isOpen ? 'Aberto agora' : 'Fechado'}
                          </div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{opening} – {closing}</div>
                        </div>
                      </div>
                    </div>
                  );
                })())}

                {/* Banner: fechado manualmente pelo estabelecimento */}
                {publicDeliveryCompany && publicDeliveryCompany.isOpen === false && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 24 }}>🔴</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#b91c1c' }}>Estamos fechados no momento</div>
                      <div style={{ fontSize: 13, color: '#7f1d1d', marginTop: 2 }}>Voltamos em breve. Confira nosso horário de funcionamento.</div>
                    </div>
                  </div>
                )}

                {/* Produtos da tab ativa */}
                <div style={{ display: 'grid', gap: 10, paddingBottom: cartCount > 0 ? 96 : 16 }}>
                  {publicDeliveryCategories.length === 0 && publicDeliveryProducts.length === 0 && !publicDeliveryError && (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Carregando cardápio...</div>
                  )}
                  {activeTab === 'top' && (
                    <div style={{ paddingTop: 4, fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Os itens mais pedidos neste restaurante</div>
                  )}
                  {activeTab !== 'top' && activeCat?.imageUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                      <img src={activeCat.imageUrl} alt={activeCat.name} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 8 }} />
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{activeCat.name}</span>
                    </div>
                  )}
                  {visibleProducts.map((product) => renderProductCard(product, activeTab === 'top'))}
                </div>

                {/* Botão flutuante do carrinho */}
                {cartCount > 0 && (
                  <div style={{ position: 'fixed', bottom: 'calc(16px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', zIndex: 200, width: 'calc(100% - 32px)', maxWidth: 608 }}>
                    <button type="button" onClick={() => setPublicDeliveryStep('checkout')}
                      style={{
                        width: '100%', border: 'none', borderRadius: 14, padding: '0', cursor: 'pointer',
                        background: 'linear-gradient(135deg, #f1c44e 0%, #e6b800 100%)',
                        boxShadow: '0 6px 24px rgba(241,196,78,0.45)',
                        transform: publicDeliveryCartBounce ? 'scale(1.04)' : 'scale(1)',
                        transition: 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)',
                        display: 'flex', alignItems: 'stretch', overflow: 'hidden',
                      }}>
                      <div style={{ background: 'rgba(0,0,0,0.12)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ background: '#18201d', color: '#f1c44e', borderRadius: '50%', width: 26, height: 26, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{cartCount}</span>
                        <span style={{ color: '#18201d', fontWeight: 600, fontSize: 13 }}>{cartCount === 1 ? 'item' : 'itens'}</span>
                      </div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 18px' }}>
                        <span style={{ color: '#18201d', fontWeight: 800, fontSize: 16 }}>Finalizar pedido</span>
                        <span style={{ color: '#18201d', fontWeight: 700, fontSize: 15 }}>→</span>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,0.10)', padding: '14px 18px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <span style={{ color: '#18201d', fontWeight: 800, fontSize: 15 }}>{formatCurrency(cartTotal)}</span>
                      </div>
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </main>
    );
  }

  // Login screen
  if (!isAuthenticated) {
    const CONTACT_EMAIL = 'contatoflorestaja@hotmail.com';
    const CONTACT_PHONE = '(87) 99971-0850';
    const CONTACT_WHATSAPP = '5587999710850';
    const APP_VERSION_DISPLAY = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.3.0';

    // ── Política de Privacidade ──
    if (loginView === 'privacy') return (
      <main className="app-shell login-screen">
        <div className="login-wrapper" style={{ alignItems: 'flex-start', paddingTop: 32 }}>
          <div className="login-card" style={{ maxWidth: 640, padding: '32px 28px' }}>
            <button type="button" onClick={() => setLoginView('login')} style={{ background: 'none', border: 'none', color: '#789088', cursor: 'pointer', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>← Voltar ao login</button>
            <h1 className="login-title" style={{ fontSize: 22, marginBottom: 6 }}>Política de Privacidade</h1>
            <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20 }}>Última atualização: junho de 2026 · Versão {APP_VERSION_DISPLAY}</p>
            <div style={{ display: 'grid', gap: 16, fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>1. Quem somos</strong><p style={{ marginTop: 6 }}>O <strong>Integra360</strong> é um sistema de gestão para restaurantes e estabelecimentos alimentícios, desenvolvido e operado por Floresta Já. Nosso contato: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#18201d' }}>{CONTACT_EMAIL}</a> · {CONTACT_PHONE}.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>2. Dados coletados</strong><p style={{ marginTop: 6 }}>Coletamos apenas os dados necessários para o funcionamento do sistema: nome e e-mail do usuário, nome e dados fiscais do estabelecimento (CNPJ, endereço, telefone), dados de pedidos e pagamentos processados pelo estabelecimento, e dados de uso para melhoria do serviço. <strong>Não coletamos dados de cartão de crédito</strong> — pagamentos são processados pelo Mercado Pago conforme sua própria política.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>3. Uso dos dados</strong><p style={{ marginTop: 6 }}>Os dados são utilizados exclusivamente para: autenticação e segurança, emissão de recibos e comprovantes, processamento de pedidos, e melhoria do serviço. Não vendemos nem compartilhamos seus dados com terceiros para fins comerciais.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>4. Armazenamento e segurança</strong><p style={{ marginTop: 6 }}>Os dados são armazenados com segurança na plataforma Supabase (infraestrutura AWS), com criptografia em trânsito (TLS) e em repouso. Tokens de acesso a serviços de pagamento são armazenados server-side e nunca expostos ao cliente.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>5. Seus direitos (LGPD)</strong><p style={{ marginTop: 6 }}>Conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018), você tem direito a: acessar seus dados, corrigir informações incorretas, solicitar a exclusão de dados, e revogar consentimentos. Para exercer esses direitos, entre em contato pelo e-mail <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#18201d' }}>{CONTACT_EMAIL}</a>.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>6. Retenção de dados</strong><p style={{ marginTop: 6 }}>Dados de usuários e pedidos são retidos enquanto a conta estiver ativa. Após o encerramento, os dados são anonimizados ou excluídos em até 90 dias, salvo obrigação legal.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>7. Cookies e rastreamento</strong><p style={{ marginTop: 6 }}>O sistema utiliza apenas cookies de sessão essenciais para autenticação. Não utilizamos cookies de rastreamento ou publicidade.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>8. Contato</strong><p style={{ marginTop: 6 }}>Dúvidas sobre privacidade? Fale conosco: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#18201d' }}>{CONTACT_EMAIL}</a> ou {CONTACT_PHONE}.</p></section>
            </div>
          </div>
        </div>
      </main>
    );

    // ── Termos de Uso ──
    if (loginView === 'terms') return (
      <main className="app-shell login-screen">
        <div className="login-wrapper" style={{ alignItems: 'flex-start', paddingTop: 32 }}>
          <div className="login-card" style={{ maxWidth: 640, padding: '32px 28px' }}>
            <button type="button" onClick={() => setLoginView('login')} style={{ background: 'none', border: 'none', color: '#789088', cursor: 'pointer', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>← Voltar ao login</button>
            <h1 className="login-title" style={{ fontSize: 22, marginBottom: 6 }}>Termos de Uso</h1>
            <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20 }}>Última atualização: junho de 2026 · Versão {APP_VERSION_DISPLAY}</p>
            <div style={{ display: 'grid', gap: 16, fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>1. Aceitação</strong><p style={{ marginTop: 6 }}>Ao utilizar o Integra360 você concorda com estes termos. Caso não concorde, não utilize o sistema.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>2. Uso permitido</strong><p style={{ marginTop: 6 }}>O sistema é licenciado para uso pelo estabelecimento contratante e seus funcionários autorizados, exclusivamente para fins de gestão interna. É proibido compartilhar credenciais ou revender o acesso.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>3. Responsabilidades</strong><p style={{ marginTop: 6 }}>O usuário é responsável pela veracidade dos dados cadastrados, pela segurança de suas credenciais, e pelo uso adequado do sistema conforme a legislação vigente.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>4. Disponibilidade</strong><p style={{ marginTop: 6 }}>Buscamos manter o serviço disponível 24/7, mas não garantimos disponibilidade ininterrupta. Manutenções serão comunicadas com antecedência quando possível.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>5. Propriedade intelectual</strong><p style={{ marginTop: 6 }}>O Integra360 e todo o seu conteúdo são propriedade da Floresta Já. É proibida a reprodução, engenharia reversa ou redistribuição sem autorização.</p></section>
              <section><strong style={{ fontSize: 14, color: '#18201d' }}>6. Contato</strong><p style={{ marginTop: 6 }}><a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#18201d' }}>{CONTACT_EMAIL}</a> · {CONTACT_PHONE}</p></section>
            </div>
          </div>
        </div>
      </main>
    );

    // ── Suporte / Ajuda ──
    if (loginView === 'support') return (
      <main className="app-shell login-screen">
        <div className="login-wrapper">
          <div className="login-card" style={{ maxWidth: 480 }}>
            <button type="button" onClick={() => setLoginView('login')} style={{ background: 'none', border: 'none', color: '#789088', cursor: 'pointer', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>← Voltar ao login</button>
            <div className="login-brand">
              <div className="login-brand-mark login-brand-mark-emoji">🛟</div>
              <h1 className="login-title" style={{ fontSize: 20 }}>Central de Ajuda</h1>
              <p className="login-subtitle">Estamos aqui para te ajudar</p>
            </div>
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              <a href={`https://wa.me/${CONTACT_WHATSAPP}?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20no%20Integra360`} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 12, padding: '14px 16px', textDecoration: 'none', color: '#15803d' }}>
                <span style={{ fontSize: 28 }}>💬</span>
                <div><div style={{ fontWeight: 700, fontSize: 15 }}>WhatsApp</div><div style={{ fontSize: 13, color: '#4ade80' }}>{CONTACT_PHONE}</div></div>
              </a>
              <a href={`mailto:${CONTACT_EMAIL}?subject=Suporte Integra360`}
                style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#eff6ff', border: '1.5px solid #93c5fd', borderRadius: 12, padding: '14px 16px', textDecoration: 'none', color: '#1e40af' }}>
                <span style={{ fontSize: 28 }}>✉️</span>
                <div><div style={{ fontWeight: 700, fontSize: 15 }}>E-mail</div><div style={{ fontSize: 13, color: '#60a5fa' }}>{CONTACT_EMAIL}</div></div>
              </a>
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#374151' }}>📋 Perguntas frequentes</div>
                {[
                  ['Esqueci minha senha', 'Use a opção "Esqueci minha senha" na tela de login para receber um link de redefinição por e-mail.'],
                  ['Como abrir o caixa?', 'Acesse a aba "Caixa" no menu lateral e clique em "Abrir caixa".'],
                  ['Como adicionar mesas?', 'Vá em Ajustes → Configurações Técnicas → Quantidade de mesas.'],
                  ['Como configurar o Mercado Pago?', 'Vá em Ajustes → Pagamentos → Mercado Pago e insira seu Access Token.'],
                ].map(([q, a]) => (
                  <details key={q} style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: 8, marginBottom: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#374151' }}>{q}</summary>
                    <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>{a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    );

    // ── Login / Recuperar senha ──
    return (
      <main className="app-shell login-screen">
        {/* Banner de atualização Android — visível mesmo na tela de login */}
        {androidUpdateAvailable && androidUpdateUrl && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: 'linear-gradient(90deg, #16a34a 0%, #15803d 100%)',
            color: '#fff', padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}>
            <span style={{ fontSize: 20 }}>🔄</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Nova versão disponível: v{androidUpdateVersion}</div>
              <div style={{ fontSize: 12, opacity: 0.9 }}>Toque para baixar e instalar</div>
            </div>
            <button type="button" onClick={() => { window.open(androidUpdateUrl, '_system'); }}
              style={{ background: '#fff', color: '#16a34a', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
              Atualizar
            </button>
            <button type="button" onClick={() => setAndroidUpdateAvailable(false)}
              style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
              ✕
            </button>
          </div>
        )}
        <div className="login-wrapper">
          <div className="login-card">
            <div className="login-brand">
              <div className="login-brand-mark"><img src="/logo.png" alt="Integra360" /></div>
              <h1 className="login-title">Integra360</h1>
              <p className="login-subtitle">{loginView === 'recover' ? 'Redefinição de senha' : 'Faça login para continuar'}</p>
            </div>

            {/* ── Formulário de recuperação de senha ── */}
            {loginView === 'recover' ? (
              <div className="login-form">
                {recoverSent ? (
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
                    <p style={{ fontWeight: 700, fontSize: 15, color: '#15803d', marginBottom: 8 }}>E-mail enviado!</p>
                    <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>Verifique sua caixa de entrada em <strong>{recoverEmail}</strong> e clique no link para criar uma nova senha.</p>
                    <button type="button" onClick={() => { setLoginView('login'); setRecoverSent(false); setRecoverEmail(''); }} style={{ marginTop: 20, background: 'none', border: 'none', color: '#789088', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>← Voltar ao login</button>
                  </div>
                ) : (
                  <form onSubmit={handlePasswordRecover}>
                    <div className="login-field" style={{ marginBottom: 16 }}>
                      <label htmlFor="recover-email">E-mail cadastrado</label>
                      <input
                        id="recover-email"
                        type="email"
                        value={recoverEmail}
                        onChange={(e) => setRecoverEmail(e.target.value)}
                        placeholder="seu@email.com"
                        autoComplete="email"
                        disabled={recoverLoading}
                      />
                    </div>
                    {recoverError && <div className="login-error" style={{ marginBottom: 12 }}>{recoverError}</div>}
                    <button type="submit" className="login-button" disabled={recoverLoading}>
                      {recoverLoading ? 'Enviando...' : 'Enviar link de redefinição'}
                    </button>
                    <button type="button" onClick={() => { setLoginView('login'); setRecoverError(''); }} style={{ width: '100%', marginTop: 10, background: 'none', border: 'none', color: '#789088', cursor: 'pointer', fontSize: 13 }}>← Voltar ao login</button>
                  </form>
                )}
              </div>
            ) : (
              /* ── Formulário de login ── */
              <form onSubmit={handleLogin} className="login-form">
                <div className="login-field">
                  <label htmlFor="email">E-mail</label>
                  <input
                    id="email"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="seu@email.com"
                    autoComplete="email"
                    disabled={isLoggingIn}
                  />
                </div>
                <div className="login-field">
                  <label htmlFor="password" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Senha
                    <button type="button" onClick={() => { setLoginView('recover'); setRecoverEmail(loginEmail); setRecoverError(''); setRecoverSent(false); }}
                      style={{ background: 'none', border: 'none', color: '#789088', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>
                      Esqueci minha senha
                    </button>
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={isLoggingIn}
                  />
                </div>
                {loginError && <div className="login-error">{loginError}</div>}
                <button type="submit" className="login-button" disabled={isLoggingIn}>
                  {isLoggingIn ? 'Conectando...' : 'Entrar'}
                </button>
              </form>
            )}

            {/* ── Rodapé do login ── */}
            <div style={{ marginTop: 28, borderTop: '1px solid #eef2ef', paddingTop: 20 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 16px', marginBottom: 14 }}>
                {[
                  { label: '🛟 Ajuda & Suporte',   view: 'support' as const },
                  { label: '🔒 Privacidade',        view: 'privacy' as const },
                  { label: '📄 Termos de Uso',      view: 'terms' as const },
                ].map(({ label, view }) => (
                  <button key={view} type="button" onClick={() => setLoginView(view)}
                    style={{ background: 'none', border: 'none', color: '#789088', cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '2px 0' }}>
                    {label}
                  </button>
                ))}
                <a href={`mailto:${CONTACT_EMAIL}?subject=Quero trabalhar com vocês`}
                  style={{ color: '#789088', fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>
                  💼 Trabalhe conosco
                </a>
              </div>
              <p style={{ textAlign: 'center', fontSize: 11, color: '#b0bdb7', margin: 0 }}>
                Integra360 v{APP_VERSION_DISPLAY} · © {new Date().getFullYear()} Floresta Já<br />
                <a href={`tel:+${CONTACT_WHATSAPP}`} style={{ color: '#b0bdb7', textDecoration: 'none' }}>{CONTACT_PHONE}</a>
                {' · '}
                <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#b0bdb7', textDecoration: 'none' }}>{CONTACT_EMAIL}</a>
              </p>
            </div>
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
      {/* ── Banner de atualização Android ───────────────────────────── */}
      {androidUpdateAvailable && androidUpdateUrl && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'linear-gradient(90deg, #16a34a 0%, #15803d 100%)',
          color: '#fff', padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        }}>
          <span style={{ fontSize: 20 }}>🔄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Nova versão disponível: v{androidUpdateVersion}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>Toque em Atualizar para baixar e instalar</div>
          </div>
          <button
            type="button"
            onClick={() => { window.open(androidUpdateUrl, '_system'); }}
            style={{ background: '#fff', color: '#16a34a', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
          >
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setAndroidUpdateAvailable(false)}
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}
      {/* ──────────────────────────────────────────────────────────────── */}

      {showCloseModal && selectedTable && (() => {
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
        const paid = Number(closePaidValue.replace(',', '.')) || 0;
        const change = paid > 0 ? paid - total : null;

        const paymentOptions = [
          { value: 'DINHEIRO', label: 'Dinheiro', icon: '💵' },
          { value: 'CREDITO',  label: 'Crédito',  icon: '💳' },
          { value: 'DEBITO',   label: 'Débito',   icon: '🏦' },
          { value: 'PIX',      label: 'PIX',      icon: '⚡' },
          { value: 'VOUCHER',  label: 'Voucher',  icon: '🎫' },
        ];

        return (
          <div className="confirm-overlay" onClick={() => closeCloseModal()}>
            <div className="close-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">

              {/* Cabeçalho */}
              <div className="close-modal-header">
                <div>
                  <span className="eyebrow" style={{ color: '#789088' }}>Encerramento</span>
                  <h3 className="close-modal-title">Fechar comanda — {selectedTable.name}</h3>
                </div>
                <button type="button" className="close-modal-x" onClick={() => closeCloseModal()} aria-label="Fechar">
                  <X size={18} />
                </button>
              </div>

              {/* Lista de itens */}
              <div className="close-modal-items">
                {items.map((it) => (
                  <div key={it.name} className="close-modal-item">
                    <span className="close-modal-item-qty">{it.quantity}×</span>
                    <span className="close-modal-item-name">{it.name}</span>
                    <span className="close-modal-item-price">{formatCurrency(it.total)}</span>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="close-modal-total">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>

              {/* Forma de pagamento */}
              <div className="close-modal-section-label">Forma de pagamento</div>
              <div className="close-modal-payment-options">
                {paymentOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`close-modal-pay-btn${closePaymentMethod === opt.value ? ' active' : ''}`}
                    onClick={() => {
                      setClosePaymentMethod(opt.value);
                      // Abre QR automaticamente ao selecionar PIX
                      if (opt.value === 'PIX' && storePixKey) {
                        const payload = getPixBrCode(storePixKey, total, tabId, storeName, storeCity || 'SAO PAULO');
                        setPixPayload(payload);
                        setPixQrUrl(getQrCodeSrc(payload));
                        setPixPendingTabId(tabId);
                        setPixAmount(total);
                        setShowPixModal(true);
                      }
                    }}
                  >
                    <span className="close-modal-pay-icon">{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>

              {/* Valor pago + troco */}
              <div className="close-modal-value-row">
                <div className="close-modal-value-field">
                  <label htmlFor="paid-value" className="close-modal-section-label" style={{ marginBottom: 6 }}>Valor recebido</label>
                  <div className="close-modal-value-input-wrap">
                    <span className="close-modal-currency">R$</span>
                    <input
                      id="paid-value"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={closePaidValue}
                      onChange={(e) => setClosePaidValue(e.target.value)}
                      placeholder="0,00"
                      autoComplete="off"
                      className="close-modal-value-input"
                    />
                  </div>
                </div>
                {change !== null && (
                  <div className={`close-modal-change${change < 0 ? ' negative' : ''}`}>
                    <span className="close-modal-section-label" style={{ marginBottom: 4 }}>{change >= 0 ? 'Troco' : 'Faltam'}</span>
                    <span className="close-modal-change-value">{formatCurrency(Math.abs(change))}</span>
                  </div>
                )}
              </div>

              {/* Seção PIX */}
              {closePaymentMethod === 'PIX' && !storePixKey && (
                <div className="close-modal-pix" style={{ background: '#fff7e6', border: '1.5px solid #fde68a' }}>
                  <div className="close-modal-pix-label" style={{ color: '#92400e' }}>⚠️ Chave PIX não configurada</div>
                  <p style={{ fontSize: 13, color: '#92400e' }}>Acesse Configurações → Chave PIX para habilitar.</p>
                </div>
              )}
              {closePaymentMethod === 'PIX' && storePixKey && (
                <div className="close-modal-pix">
                  <div className="close-modal-pix-label">⚡ Pagamento via PIX</div>
                  <div className="close-modal-pix-actions">
                    <button type="button" className="secondary-button" onClick={() => {
                      const payload = getPixBrCode(storePixKey, total, tabId, storeName, storeCity || 'SAO PAULO');
                      setPixPayload(payload);
                      setPixQrUrl(getQrCodeSrc(payload));
                      setShowPixModal(true);
                    }}>
                      Exibir QR Code — {formatCurrency(total)}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => {
                      const payload = getPixBrCode(storePixKey, total, tabId, storeName, storeCity || 'SAO PAULO');
                      navigator.clipboard.writeText(payload);
                      showToast('Payload PIX copiado.', 'success');
                    }}>
                      Copiar chave PIX
                    </button>
                  </div>
                </div>
              )}
              {closePaymentMethod === 'PIX' && (
                <div className="close-modal-pix" style={{ marginTop: 8 }}>
                  <div className="close-modal-pix-label">🔄 Pix dinâmico via Mercado Pago (confirmação automática)</div>
                  {!mpCharge ? (
                    <button type="button" className="secondary-button" disabled={mpChargeLoading} onClick={() => void generateMercadoPagoPixCharge(tabId, total)}>
                      {mpChargeLoading ? 'Gerando cobrança...' : `Gerar cobrança Pix — ${formatCurrency(total)}`}
                    </button>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {mpCharge.qrCodeBase64 && (
                        <img
                          src={`data:image/png;base64,${mpCharge.qrCodeBase64}`}
                          alt="QR Code Pix Mercado Pago"
                          style={{ width: 180, height: 180, alignSelf: 'center' }}
                        />
                      )}
                      <p style={{ margin: 0, fontSize: 13 }}>
                        Status: <strong>{mpCharge.status === 'approved' ? 'Pago ✅' : mpCharge.status}</strong>
                      </p>
                      <div className="close-modal-pix-actions">
                        {mpCharge.qrCode && (
                          <button type="button" className="secondary-button" onClick={() => {
                            navigator.clipboard.writeText(mpCharge.qrCode!);
                            showToast('Código Pix copiado.', 'success');
                          }}>
                            Copiar código Pix
                          </button>
                        )}
                        <button type="button" className="secondary-button" disabled={mpChargeChecking} onClick={() => void checkMercadoPagoChargeStatus()}>
                          {mpChargeChecking ? 'Verificando...' : 'Verificar pagamento'}
                        </button>
                        <button type="button" className="secondary-button" onClick={() => setMpCharge(null)}>
                          Gerar nova cobrança
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Ações */}
              <div className="close-modal-actions">
                <button type="button" className="secondary-button" onClick={() => closeCloseModal()}>Cancelar</button>
                <button type="button" className="primary-button" onClick={() => void handleConfirmClose()}>
                  <CheckCircle size={16} style={{ marginRight: 6 }} />
                  Confirmar e Encerrar
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {qrModalTable && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 300 }} onClick={closeQrModal}>
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
                  showToast('Link do QR code copiado.', 'success');
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 500 }}>
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
                disabled={confirmingPix}
                onClick={() => {
                  if (pixPendingTabId && pixAmount != null) {
                    void finishPixClose(pixPendingTabId, pixAmount);
                  }
                }}
                style={{ opacity: confirmingPix ? 0.7 : 1, minWidth: 200 }}
              >
                {confirmingPix ? 'Encerrando comanda...' : 'Confirmar PIX recebido'}
              </button>
              <button type="button" className="secondary-button" onClick={() => {
                navigator.clipboard.writeText(pixPayload ?? '');
                showToast('Payload PIX copiado.', 'success');
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
            // Módulos que exigem plano Pro
            const proOnly = !isPro && (item.id === 'cozinha');

            return (
              <button
                className={`nav-item ${activeModule === item.id ? 'active' : ''}`}
                key={item.id}
                type="button"
                onClick={() => setActiveModule(item.id)}
                title={proOnly ? 'Disponível no plano Pro' : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {proOnly && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>🔒</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Banner de plano na sidebar — clicável, leva para Ajustes > Assinatura */}
        {currentCompany && currentUser?.role !== 'SUPER' && (
          <button
            type="button"
            onClick={() => { setActiveModule('ajustes'); setAjustesSubTab('assinatura'); }}
            style={{ margin: '8px 10px', borderRadius: 8, padding: '8px 10px', fontSize: 11, background: isPro ? (trialDaysLeft > 0 ? '#fffbeb' : '#f0fdf4') : '#fef2f2', border: `1px solid ${isPro ? (trialDaysLeft > 0 ? '#fde68a' : '#bbf7d0') : '#fecaca'}`, color: isPro ? (trialDaysLeft > 0 ? '#92400e' : '#15803d') : '#991b1b', lineHeight: 1.4, cursor: 'pointer', textAlign: 'left', width: 'calc(100% - 20px)' }}
          >
            {trialDaysLeft > 0 ? (
              <>⏳ <strong>Trial Pro</strong> — {trialDaysLeft} dia{trialDaysLeft !== 1 ? 's' : ''} restante{trialDaysLeft !== 1 ? 's' : ''}</>
            ) : (
              <><strong>{currentCompany.plan ?? 'STARTER'}</strong> — {isPro ? 'Plano ativo' : '👆 Ver planos'}</>
            )}
          </button>
        )}

        <button className="logout-button" type="button" onClick={handleLogout}><LogOut size={18} /><span>Sair</span></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{moduleConfig[activeModule].eyebrow}</span>
            <h1>{moduleConfig[activeModule].title}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Botão de atualização — só aparece no Electron */}
            {(window as any).sistema?.checkForUpdates && (() => {
              if (updateStatus === 'ready') return (
                <button
                  type="button"
                  onClick={() => (window as any).sistema.installUpdate()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#16211d', color: '#f1c44e', border: '1.5px solid #f1c44e', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', animation: 'pulse 2s infinite' }}
                >
                  ⬇ Instalar v{updateVersion ?? 'nova'} agora
                </button>
              );
              if (updateStatus === 'available') return (
                <button
                  type="button"
                  onClick={() => (window as any).sistema.installUpdate()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fffbeb', color: '#92400e', border: '1.5px solid #f1c44e', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  ⬇ Atualização disponível {updateVersion ? `v${updateVersion}` : ''}
                </button>
              );
              if (updateStatus === 'downloading') return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eff6ff', border: '1.5px solid #93c5fd', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: '#1e40af' }}>
                  ⏬ Baixando... {updateProgress}%
                </div>
              );
              if (updateStatus === 'checking') return (
                <div style={{ fontSize: 12, color: '#789088' }}>Verificando atualizações...</div>
              );
              // idle — botão discreto para verificar manualmente
              return (
                <button
                  type="button"
                  onClick={() => { setUpdateStatus('checking'); void (window as any).sistema.checkForUpdates(); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#789088', padding: '4px 8px', borderRadius: 6 }}
                  title="Verificar atualizações"
                >
                  ✓ v{APP_VERSION}
                </button>
              );
            })()}
            <div className={`connection ${apiStatus}`}>{apiStatus === 'online' ? 'API online' : 'API offline'}</div>
            {/* Logout visível apenas no mobile (sidebar oculta o botão normal) */}
            <button
              type="button"
              className="topbar-logout-mobile"
              onClick={handleLogout}
              title="Sair"
            >
              <LogOut size={18} />
            </button>
          </div>
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

              {!isCashOpen ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: '#789088' }}>
                  <p style={{ fontWeight: 600, marginBottom: 6 }}>Caixa fechado</p>
                  <p style={{ fontSize: 13 }}>As mesas ficam disponíveis para pedidos somente após a abertura do caixa.</p>
                </div>
              ) : (
              <div className="tables-grid">
                {tables.map((table) => (
                  <div
                    className={`table-tile ${getTableStateClass(table)} ${table.id === selectedTable?.id ? 'selected' : ''}`}
                    key={table.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      const now = Date.now();
                      const last = lastTableTapRef.current;
                      if (last && last.id === table.id && now - last.time < 350) {
                        // Duplo toque/clique: abre cardápio
                        lastTableTapRef.current = null;
                        openTableMenuModal(table);
                      } else {
                        // Primeiro toque: seleciona
                        lastTableTapRef.current = { id: table.id, time: now };
                        setSelectedTableId(table.id);
                      }
                    }}
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
              )}
            </div>

            <div className="panel order-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Mesa</span>
                  <h2>{selectedTable?.name ?? 'Selecione uma mesa'}</h2>
                </div>
                <div className="table-action-buttons">
                  <button type="button" className="secondary-button" onClick={() => {
                    if (!selectedTable) return showToast('Selecione uma mesa.', 'warning');
                    openTableMenuModal(selectedTable);
                  }}>
                    Abrir cardápio
                  </button>
                  <button type="button" className="secondary-button" onClick={() => {
                    if (!selectedTable) return showToast('Selecione uma mesa.', 'warning');
                    if (selectedTableOrders.length === 0) return showToast('Não há comanda ativa para encerrar.', 'warning');
                    openCloseModal();
                  }}>
                    Encerrar Mesa
                  </button>
                </div>
              </div>

              <div className="order-summary">
                <h3>Itens da mesa</h3>
                {selectedTableOrders.length === 0 ? (
                  <p>Nenhum pedido lancado.</p>
                ) : (
                  selectedTableOrders.map((order) => (
                    <div className="order-card" key={order.id}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.items.map((item) => `${item.productName} x${item.quantity}`).join(', ')}</strong>
                        <span>{orderStatusLabel[order.status]}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {order.status === 'ENVIADO' && (
                          <button
                            type="button"
                            style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
                            onClick={async () => {
                              try {
                                await api.updateOrderStatus(order.id, 'CANCELADO');
                                await reloadTablesAndOrders();
                                showToast('Pedido removido.', 'success');
                              } catch (err: any) {
                                showToast('Erro ao remover pedido: ' + (err?.message ?? String(err)), 'error');
                              }
                            }}
                          >
                            Remover
                          </button>
                        )}
                        <button type="button" onClick={() => void advanceOrder(order)}>Avançar</button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginTop: 20 }}>
                <button type="button" className="secondary-button" onClick={() => {
                  if (!selectedTable) return showToast('Selecione uma mesa.', 'warning');
                  if (selectedTableOrders.length === 0) return showToast('Nenhum pedido para a mesa.', 'warning');
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
                  void printCashierReceipt({
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

            {menuModalTable && (() => {
              const cartTotal = tableCart.reduce((s, c) => s + c.quantity * c.product.price, 0);
              const cartCount = tableCart.reduce((s, c) => s + c.quantity, 0);
              const mobile = window.innerWidth <= 640;

              /* Painel de produtos — compartilhado entre mobile/desktop */
              const productList = (
                <div style={{ flex: 1, overflowY: 'auto', padding: mobile ? '12px 12px calc(80px + env(safe-area-inset-bottom))' : 24 }}>
                  {Object.entries(groupedMenuSections).map(([section, items]) => items.length > 0 ? (
                    <div key={section} style={{ marginBottom: 20 }}>
                      <h3 style={{ marginBottom: 10, fontSize: mobile ? 13 : 15, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#789088' }}>{section}</h3>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {items.map((product) => {
                          const inCart = tableCart.filter((c) => c.product.id === product.id).reduce((s, c) => s + c.quantity, 0);
                          return (
                            <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: mobile ? '10px 12px' : '12px 14px', border: `1px solid ${inCart > 0 ? '#16a34a' : '#ececec'}`, borderRadius: 10, background: inCart > 0 ? '#f0fdf4' : '#fff', transition: 'all .15s' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <strong style={{ fontSize: mobile ? 13 : 14 }}>{product.name}</strong>
                                {inCart > 0 && <span style={{ marginLeft: 8, background: '#16a34a', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 7px' }}>{inCart}x</span>}
                                {product.description && <div style={{ marginTop: 2, color: '#5d6c66', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{product.description}</div>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 10, flexShrink: 0 }}>
                                <strong style={{ fontSize: 13 }}>{formatCurrency(product.price)}</strong>
                                <button type="button" className="secondary-button" style={{ padding: '6px 12px', minHeight: 'unset', fontSize: 12 }} onClick={() => {
                                  setSelectedTableId(menuModalTable.id);
                                  setTableCartNoteProduct(product);
                                  setTableCartNote('');
                                }}>+ Add</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null)}
                </div>
              );

              /* Painel do carrinho — compartilhado */
              const cartPanel = (
                <div style={{ display: 'flex', flexDirection: 'column', flex: mobile ? 1 : undefined, width: mobile ? '100%' : 300, borderLeft: mobile ? 'none' : '1px solid #eef2ef', background: '#fafafa', overflowY: mobile ? 'auto' : undefined }}>
                  {!mobile && <div style={{ padding: '16px 18px', borderBottom: '1px solid #eef2ef' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#7a8a7a' }}>Pedido atual</span></div>}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                    {tableCart.length === 0 ? (
                      <p style={{ color: '#9a9a9a', fontSize: 13, textAlign: 'center', marginTop: 24 }}>Nenhum item adicionado.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {tableCart.map((entry, idx) => (
                          <div key={idx} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ flex: 1 }}>
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.quantity}× {entry.product.name}</span>
                                {entry.note && <div style={{ fontSize: 12, color: '#7a8a7a', marginTop: 3 }}>↳ {entry.note}</div>}
                              </div>
                              <button type="button" onClick={() => setTableCart((prev) => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: '0 0 0 8px', fontSize: 18, lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 4, textAlign: 'right' }}>{formatCurrency(entry.quantity * entry.product.price)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {tableCart.length > 0 && (
                    <div style={{ padding: mobile ? '14px 16px calc(14px + env(safe-area-inset-bottom))' : '14px 16px', borderTop: '1px solid #eef2ef', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                        <span>Total</span>
                        <span>{formatCurrency(cartTotal)}</span>
                      </div>
                      <button type="button" className="primary-button" style={{ width: '100%' }}
                        onClick={async () => {
                          const cartItems = tableCart.map((c) => ({ productId: c.product.id, productName: c.product.name, quantity: c.quantity, unitPrice: c.product.price, note: c.note || undefined }));
                          setTableCart([]);
                          closeTableMenuModal();
                          await createOrder(menuModalTable.id, cartItems, menuModalTable.name);
                        }}>
                        ✅ Confirmar e enviar para cozinha
                      </button>
                    </div>
                  )}
                </div>
              );

              return (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: mobile ? 'flex-end' : 'center', justifyContent: 'center', padding: mobile ? 0 : 20 }}
                  onClick={() => { closeTableMenuModal(); setTableCart([]); setMenuModalTab('menu'); }}>

                  <div style={{ position: 'relative', width: mobile ? '100%' : 'min(960px, 100%)', height: mobile ? '92dvh' : undefined, maxHeight: mobile ? undefined : '92vh', background: '#fff', borderRadius: mobile ? '16px 16px 0 0' : 14, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    onClick={(e) => e.stopPropagation()}>

                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: mobile ? '14px 16px' : '20px 24px', borderBottom: '1px solid #eef2ef', flexShrink: 0 }}>
                      <div>
                        <span className="eyebrow">Cardápio</span>
                        <h2 style={{ margin: 0, fontSize: mobile ? 16 : 20 }}>{menuModalTable.name}</h2>
                      </div>
                      <button type="button" className="secondary-button" style={{ padding: '7px 14px', fontSize: 13 }}
                        onClick={() => { closeTableMenuModal(); setTableCart([]); setMenuModalTab('menu'); }}>Fechar</button>
                    </div>

                    {/* Abas mobile */}
                    {mobile && (
                      <div style={{ display: 'flex', borderBottom: '2px solid #eef2ef', flexShrink: 0 }}>
                        {(['menu', 'cart'] as const).map((t) => (
                          <button key={t} type="button" onClick={() => setMenuModalTab(t)}
                            style={{ flex: 1, background: 'none', border: 'none', borderBottom: menuModalTab === t ? '3px solid #18201d' : '3px solid transparent', marginBottom: -2, padding: '11px 0', fontWeight: menuModalTab === t ? 700 : 500, fontSize: 13, color: menuModalTab === t ? '#18201d' : '#789088', cursor: 'pointer' }}>
                            {t === 'menu' ? '🍽️ Cardápio' : `🛒 Pedido${cartCount > 0 ? ` (${cartCount})` : ''}`}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Conteúdo */}
                    {mobile ? (
                      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {menuModalTab === 'menu' ? productList : cartPanel}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {productList}
                        {cartPanel}
                      </div>
                    )}

                    {/* Botão flutuante "Ver pedido" no mobile */}
                    {mobile && menuModalTab === 'menu' && cartCount > 0 && (
                      <div style={{ position: 'absolute', bottom: 'calc(16px + env(safe-area-inset-bottom))', left: 16, right: 16, zIndex: 10 }}>
                        <button type="button" onClick={() => setMenuModalTab('cart')}
                          style={{ width: '100%', background: '#18201d', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 20px', fontWeight: 700, fontSize: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', cursor: 'pointer' }}>
                          <span>🛒 {cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
                          <span>Ver pedido · {formatCurrency(cartTotal)}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* Mini-modal observação do item do carrinho */}
        {tableCartNoteProduct && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 300 }} onClick={() => setTableCartNoteProduct(null)}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 340, display: 'grid', gap: 16 }} onClick={(e) => e.stopPropagation()}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#7a8a7a' }}>Adicionar ao pedido</span>
                <h3 style={{ margin: '6px 0 2px', fontSize: 18 }}>{tableCartNoteProduct.name}</h3>
                <span style={{ color: '#7a8a7a', fontSize: 14 }}>{formatCurrency(tableCartNoteProduct.price)}</span>
              </div>
              <label style={{ display: 'grid', gap: 6, margin: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Observação <span style={{ fontWeight: 400, color: '#9a9a9a' }}>(opcional)</span></span>
                <input
                  type="text"
                  placeholder="Ex: sem cebola, bem passado..."
                  value={tableCartNote}
                  onChange={(e) => setTableCartNote(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setTableCart((prev) => [...prev, { product: tableCartNoteProduct, quantity: 1, note: tableCartNote.trim() }]);
                      setTableCartNoteProduct(null);
                    }
                    if (e.key === 'Escape') setTableCartNoteProduct(null);
                  }}
                />
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="secondary-button" style={{ flex: 1 }} onClick={() => setTableCartNoteProduct(null)}>Cancelar</button>
                <button
                  type="button"
                  className="primary-button"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setTableCart((prev) => [...prev, { product: tableCartNoteProduct, quantity: 1, note: tableCartNote.trim() }]);
                    setTableCartNoteProduct(null);
                  }}
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Users modal */}
        {showUsersModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: isMobile ? 'stretch' : 'center', zIndex: 300, padding: isMobile ? 0 : 20 }} onClick={() => setShowUsersModal(false)}>
            <div style={{ background: '#fff', padding: isMobile ? 14 : 20, borderRadius: isMobile ? 0 : 10, width: isMobile ? '100%' : 'min(560px, 100%)', minWidth: isMobile ? undefined : 480, maxWidth: isMobile ? '100%' : 560, height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : '80vh', overflow: 'auto', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
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
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
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
              ) : isMobile ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {usersList.map((u) => (
                    <div key={u.id} style={{ border: '1px solid #ececec', borderRadius: 8, padding: 10 }}>
                      <strong style={{ fontSize: 14 }}>{u.name}</strong>
                      <div style={{ fontSize: 12, color: '#5d6c66', marginTop: 2, wordBreak: 'break-all' }}>{u.email}</div>
                      <div style={{ fontSize: 12, color: '#5d6c66', marginTop: 2 }}>Role: {u.role} · {u.active ? 'Ativo' : 'Inativo'}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {u.active ? (
                          <button className="secondary-button" onClick={() => void handleSuspendUser(u.id)}>Suspender</button>
                        ) : (
                          <button className="primary-button" onClick={() => void handleReactivateUser(u.id)}>Reativar</button>
                        )}
                        <button className="secondary-button" onClick={() => void handleDeleteUser(u.id)}>Excluir</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
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
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="secondary-button" onClick={() => setShowUsersModal(false)}>Fechar</button>
              </div>
            </div>
          </div>
        )}

        {confirmationRequest && (
          <div className="confirm-overlay" onClick={(e) => { if (e.target === e.currentTarget && !confirmationLoading) setConfirmationRequest(null); }}>
            <div className="confirm-dialog" role="dialog" aria-modal="true">
              <div className="confirm-dialog-icon">⚠️</div>
              <h3>Confirmação</h3>
              <p>{confirmationRequest.message}</p>
              <div className="confirm-dialog-actions">
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

        {/* Toast notifications */}
        <div className="toast-container">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast ${toast.type}${toast.removing ? ' removing' : ''}`}
              onClick={() => dismissToast(toast.id)}
              role="alert"
            >
              <span className="toast-icon">
                {toast.type === 'success' && <CheckCircle size={18} />}
                {toast.type === 'error' && <AlertCircle size={18} />}
                {toast.type === 'warning' && <AlertTriangle size={18} />}
                {toast.type === 'info' && <Info size={18} />}
              </span>
              <span className="toast-message">{toast.message}</span>
              <button className="toast-close" type="button" onClick={(e) => { e.stopPropagation(); dismissToast(toast.id); }} aria-label="Fechar">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

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

        {activeModule === 'cozinha' && !isPro && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 18px', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>🔒</span>
            <div>
              <div style={{ fontWeight: 700, color: '#92400e' }}>Tela de Cozinha (KDS) — Plano Pro</div>
              <div style={{ fontSize: 13, color: '#b45309', marginTop: 2 }}>
                O KDS está disponível no plano <strong>Pro</strong> (R$149/mês). Você ainda pode visualizar os pedidos, mas para uso em produção faça upgrade com o suporte.
              </div>
            </div>
          </div>
        )}

        {activeModule === 'cozinha' && (() => {
          const now = Date.now();
          const elapsed = (iso: string) => {
            const diff = Math.floor((now - new Date(iso).getTime()) / 1000);
            const m = Math.floor(diff / 60);
            const s = diff % 60;
            return m > 0 ? `${m}min ${s}s` : `${s}s`;
          };
          const urgentMs = 20 * 60 * 1000; // 20 min = urgente

          return (
            <section className="module-grid two-columns">

              {/* Pedidos de mesa */}
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">KDS — Mesas</span>
                    <h2>Pedidos em produção</h2>
                  </div>
                  <Utensils size={22} />
                </div>
                <div className="kitchen-list">
                  {kitchenOrders.length === 0 ? (
                    <p style={{ color: '#789088', padding: 12 }}>Fila vazia.</p>
                  ) : (
                    kitchenOrders.map((order) => {
                      const age = now - new Date(order.createdAt).getTime();
                      const urgent = age > urgentMs;
                      return (
                        <div className="kitchen-row" key={order.id} style={{ borderLeft: `4px solid ${urgent ? '#b91c1c' : '#16211d'}`, paddingLeft: 12, gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <strong style={{ fontSize: 15 }}>{order.tableName}</strong>
                              <span style={{ fontSize: 11, fontWeight: 700, color: urgent ? '#b91c1c' : '#789088', background: urgent ? '#fef2f2' : '#f1f5f0', borderRadius: 4, padding: '2px 6px' }}>
                                <Clock size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                                {elapsed(order.createdAt)}
                              </span>
                            </div>
                            <div style={{ fontSize: 13, color: '#4b5563' }}>
                              {order.items.map((i) => `${i.quantity}× ${i.productName}`).join(' • ')}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#789088' }}>{new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            <button type="button" className="primary-button" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => void advanceOrder(order)}>
                              {orderStatusLabel[order.status]} →
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Pedidos de delivery em preparo */}
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">KDS — Delivery</span>
                    <h2>Deliveries em preparo</h2>
                  </div>
                  <Bike size={22} />
                </div>
                <div className="kitchen-list">
                  {kitchenDeliveryOrders.length === 0 ? (
                    <p style={{ color: '#789088', padding: 12 }}>Nenhum delivery em preparo.</p>
                  ) : (
                    kitchenDeliveryOrders.map((order) => {
                      const age = now - new Date(order.createdAt).getTime();
                      const urgent = age > urgentMs;
                      return (
                        <div key={order.id} className="kitchen-row" style={{ borderLeft: `4px solid ${urgent ? '#b91c1c' : '#f1c44e'}`, paddingLeft: 12, gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <strong style={{ fontSize: 15 }}>{order.customerName}</strong>
                              <span style={{ fontSize: 11, background: '#fffbeb', color: '#92400e', borderRadius: 4, padding: '2px 6px', fontWeight: 700 }}>
                                🚲 Delivery
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: urgent ? '#b91c1c' : '#789088', background: urgent ? '#fef2f2' : '#f1f5f0', borderRadius: 4, padding: '2px 6px' }}>
                                <Clock size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                                {elapsed(order.createdAt)}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: '#789088', marginBottom: 4 }}>
                              <MapPin size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                              {order.customerAddress}
                            </div>
                            <div style={{ fontSize: 13, color: '#4b5563' }}>
                              {order.items.map((i) => `${i.quantity}× ${i.productName}`).join(' • ')}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#789088' }}>{new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            <button type="button" className="primary-button" style={{ fontSize: 12, padding: '5px 12px' }}
                              onClick={() => void advanceDeliveryStatus(order)}>
                              Saiu p/ entrega
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </section>
          );
        })()}

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

            {/* Formulário de criação / edição */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <form className="panel product-form" onSubmit={(event) => void createProduct(event)}>
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">{editingProduct ? 'Editar item' : 'Novo item'}</span>
                    <h2>{editingProduct ? `Editando: ${editingProduct.name}` : 'Inserir no cardápio'}</h2>
                  </div>
                  <ShoppingBag size={22} />
                </div>

                <label>
                  Nome
                  <input placeholder="Ex: Shawarma de cordeiro" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
                </label>

                <label>
                  Descrição
                  <textarea placeholder="Ingredientes, tamanho ou observações" rows={3} value={newProductDescription} onChange={(e) => setNewProductDescription(e.target.value)} style={{ resize: 'vertical' }} />
                </label>

                <label>
                  Categoria
                  <select value={newProductCategoryId} onChange={(e) => setNewProductCategoryId(e.target.value)}>
                    <option value="">— Sem categoria —</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </label>

                <div className="form-grid">
                  <label>
                    Preço (R$)
                    <input inputMode="decimal" placeholder="29,90" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} />
                  </label>
                  <label>
                    Preparo (min)
                    <input inputMode="numeric" placeholder="10" value={newProductPreparationMinutes} onChange={(e) => setNewProductPreparationMinutes(e.target.value)} />
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary-button" type="submit" style={{ flex: 1 }}>
                    {editingProduct ? 'Salvar alterações' : 'Salvar item'}
                  </button>
                  {editingProduct && (
                    <button className="secondary-button" type="button" onClick={cancelEdit}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>

              {/* Gerenciar categorias */}
              <div className="panel product-form">
                <div className="panel-header" style={{ cursor: 'pointer' }} onClick={() => setShowCategoryForm(!showCategoryForm)}>
                  <div>
                    <span className="eyebrow">Organização</span>
                    <h2>Categorias</h2>
                  </div>
                  <span style={{ fontSize: 13, color: '#789088' }}>{showCategoryForm ? '▲ Fechar' : '▼ Gerenciar'}</span>
                </div>

                {showCategoryForm && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        placeholder="Nome da nova categoria"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void createCategory())}
                        style={{ flex: 1 }}
                      />
                      <button className="primary-button" type="button" onClick={() => void createCategory()}>
                        Criar
                      </button>
                    </div>
                    {categories.length === 0 && <p style={{ fontSize: 13, color: '#789088', margin: 0 }}>Nenhuma categoria criada.</p>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(categories as Array<{ id: string; name: string; imageUrl?: string | null }>).map((cat) => (
                        <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                          {cat.imageUrl
                            ? <img src={cat.imageUrl} alt={cat.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                            : <div style={{ width: 48, height: 48, borderRadius: 6, background: '#eef2ef', display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0 }}>?</div>
                          }
                          <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{cat.name}</span>
                          <label style={{ cursor: 'pointer', background: '#fff', border: '1px dashed #d1d5db', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                            {cat.imageUrl ? 'Trocar foto' : '+ Foto'}
                            <input type="file" accept="image/*" style={{ display: 'none' }}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                try {
                                  const url = await api.uploadCategoryImage(file, cat.id);
                                  await api.updateCategoryImage(cat.id, url);
                                  await loadData();
                                  showToast('Foto da categoria atualizada!', 'success');
                                } catch (err) {
                                  showToast((err as Error).message, 'error');
                                }
                              }} />
                          </label>
                          {cat.imageUrl && (
                            <button type="button"
                              onClick={async () => {
                                await api.updateCategoryImage(cat.id, null);
                                await loadData();
                                showToast('Foto removida.', 'success');
                              }}
                              style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, padding: '4px 6px' }}
                              title="Remover foto">
                              x
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Lista de produtos agrupados por categoria */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Produtos</span>
                  <h2>Itens cadastrados</h2>
                </div>
                <ShoppingBag size={22} />
              </div>
              <div className="product-list catalog-list" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                {products.length === 0 && <p style={{ color: '#789088', fontSize: 14 }}>Nenhum produto cadastrado.</p>}
                {(() => {
                  // Agrupa por categoria real
                  const byCat: Record<string, { catName: string; items: Product[] }> = {};
                  products.forEach((p) => {
                    const cat = categories.find((c) => c.id === p.categoryId);
                    const key = cat?.id ?? 'sem-cat';
                    const label = cat?.name ?? 'Sem categoria';
                    if (!byCat[key]) byCat[key] = { catName: label, items: [] };
                    byCat[key].items.push(p);
                  });
                  return Object.entries(byCat).map(([key, group]) => (
                    <div key={key} style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#789088', marginBottom: 8, borderBottom: '1px solid #eef2ef', paddingBottom: 4 }}>
                        {group.catName}
                      </div>
                      {group.items.map((product) => (
                        <div key={product.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f4f6f4', opacity: product.available === false ? 0.55 : 1 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#18201d' }}>{product.name}</div>
                            {product.description && <div style={{ fontSize: 12, color: '#789088', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.description}</div>}
                          </div>
                          <b style={{ color: '#18201d', whiteSpace: 'nowrap' }}>{formatCurrency(product.price)}</b>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ padding: '4px 10px', fontSize: 12, color: product.available === false ? '#789088' : '#15803d', borderColor: product.available === false ? '#e5e7eb' : '#86efac' }}
                            onClick={async () => {
                              try {
                                await api.updateProduct(product.id, { available: product.available === false });
                                await loadData();
                                showToast(product.available === false ? 'Item ativado no cardápio.' : 'Item desativado do cardápio.', 'success');
                              } catch (e) {
                                showToast('Falha ao atualizar disponibilidade do item.', 'error');
                              }
                            }}
                          >
                            {product.available === false ? '◯ Desativado' : '● Ativo'}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={() => startEditProduct(product)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ padding: '4px 10px', fontSize: 12, color: '#b91c1c', borderColor: '#fca5a5' }}
                            onClick={() => confirmAction(`Remover "${product.name}"?`, async () => {
                              await api.deleteProduct(product.id);
                              await loadData();
                              showToast('Produto removido.', 'success');
                            })}
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </section>
        )}

        {activeModule === 'cadastros' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header super-panel-header">
                <div>
                  <span className="eyebrow">Novo cliente</span>
                  <h2>Criar restaurante / login</h2>
                </div>
              </div>
              <div style={{ background: 'linear-gradient(135deg, #667eea22 0%, #764ba222 100%)', borderRadius: 10, padding: '14px 16px', marginBottom: 20, border: '1.5px solid #c4b5fd', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Building size={22} style={{ color: '#7c3aed', flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: 13, color: '#4c1d95' }}>
                  Preencha os dados abaixo para criar um novo restaurante e seu administrador. O acesso será liberado imediatamente após a criação.
                </p>
              </div>

              <div style={{ padding: 12 }} className="product-form">
                <div className="form-grid">
                  <label>
                    Nome da empresa
                    <input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Nome da empresa"
                      style={createFieldErrors.companyName ? { borderColor: '#dc2626' } : {}} />
                    {createFieldErrors.companyName && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 2 }}>✕ {createFieldErrors.companyName}</span>}
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
                    <input value={newCompanyCnpj} onChange={(e) => setNewCompanyCnpj(e.target.value)} placeholder="00.000.000/0000-00"
                      style={createFieldErrors.cnpj ? { borderColor: '#dc2626' } : {}} />
                    {createFieldErrors.cnpj && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 2 }}>✕ {createFieldErrors.cnpj}</span>}
                  </label>
                  <label>
                    Mensalidade (R$)
                    <input value={newCompanyMonthlyFee} onChange={(e) => setNewCompanyMonthlyFee(e.target.value)} placeholder="0.00" />
                  </label>
                  <label>
                    Taxa da plataforma (%) <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>(descontada de todo pagamento via Mercado Pago)</span>
                    <input value={newCompanyDeliveryFeePercent} onChange={(e) => setNewCompanyDeliveryFeePercent(e.target.value)} placeholder="0" />
                  </label>
                  <label>
                    Email empresa
                    <input value={newCompanyEmail} onChange={(e) => setNewCompanyEmail(e.target.value)} placeholder="contato@exemplo.com"
                      style={createFieldErrors.companyEmail ? { borderColor: '#dc2626' } : {}} />
                    {createFieldErrors.companyEmail && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 2 }}>✕ {createFieldErrors.companyEmail}</span>}
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
                      <input value={newAdminEmail} onChange={(e) => setNewAdminEmail(e.target.value)} placeholder="admin@empresa.com"
                        style={createFieldErrors.adminEmail ? { borderColor: '#dc2626' } : {}} />
                      {createFieldErrors.adminEmail && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 2 }}>✕ {createFieldErrors.adminEmail}</span>}
                    </label>
                    <label>
                      Senha do administrador
                      <input type="password" value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
                      {newAdminPassword.length > 0 && newAdminPassword.length < 6 && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 2 }}>✕ Mínimo 6 caracteres.</span>}
                    </label>
                    <div />
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={Object.keys(createFieldErrors).length > 0 || (newAdminPassword.length > 0 && newAdminPassword.length < 6)}
                      onClick={() => void submitCreateCompany()}
                    >Criar</button>
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
              <div className="panel-header super-panel-header">
                <div>
                  <span className="eyebrow">Painel</span>
                  <h2>Gestão de clientes</h2>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="secondary-button" type="button" onClick={() => void loadCompanies()}>↻ Atualizar</button>
                  <button className="secondary-button" type="button" onClick={() => exportCompaniesCSV()}>CSV</button>
                  <button className="secondary-button" type="button" onClick={() => exportCompaniesPdf()}>PDF</button>
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
                    <div className="super-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12, marginBottom: 16 }}>
                      {[
                        { title: 'Empresas', value: totalCompanies },
                        { title: 'Assinaturas ativas', value: activeSubs },
                        { title: 'Receita mensal total', value: formatCurrency(totalMonthly) },
                        { title: 'Média mensal por empresa', value: formatCurrency(avgMonthly) }
                      ].map((m) => (
                        <div key={m.title} className="panel" style={{ padding: 12, minWidth: 0, overflow: 'hidden' }}>
                          <div style={{ color: '#6b7280', fontSize: 12, fontWeight: 800 }}>{m.title}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6, wordBreak: 'break-word' }}>{m.value}</div>
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
                  <div className="super-search-row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 0 }}>
                      Buscar
                      <input value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="Nome da empresa" style={{ flex: 1, minWidth: 0 }} />
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      Status
                      <select value={companyFilterStatus} onChange={(e) => setCompanyFilterStatus(e.target.value as any)}>
                        <option value="all">Todas</option>
                        <option value="overdue">Atrasadas</option>
                        <option value="pending">Pendentes</option>
                        <option value="paid">Pagas</option>
                      </select>
                    </label>
                  </div>

                  <div className="super-table-wrap" style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9fafb' }}>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Empresa</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>E-mail</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>CNPJ</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Plano</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Status</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' }}>Vencimento</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Mensalidade</th>
                        <th style={{ textAlign: 'right', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' }}>Acessos ao cardápio</th>
                        <th style={{ textAlign: 'left', padding: 12, fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingCompanies ? (
                        <tr><td colSpan={9} style={{ padding: 12, textAlign: 'center' }}>Carregando...</td></tr>
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
                        <tr><td colSpan={9} style={{ padding: 12, textAlign: 'center' }}>Nenhuma empresa cadastrada.</td></tr>
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
                            {(() => {
                              const plan = c.plan ?? 'STARTER';
                              const trialEnd = c.trialEndsAt ? new Date(c.trialEndsAt).getTime() : 0;
                              const inTrial = trialEnd > Date.now();
                              const planColors: Record<string, { bg: string; color: string }> = {
                                STARTER: { bg: '#f3f4f6', color: '#374151' },
                                TRIAL:   { bg: '#f0fdf4', color: '#166534' },
                                PRO: { bg: '#fffbeb', color: '#92400e' },
                                ENTERPRISE: { bg: '#eff6ff', color: '#1d4ed8' },
                              };
                              const pc = planColors[plan] ?? planColors.STARTER;
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ background: pc.bg, color: pc.color, border: `1px solid ${pc.color}30`, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, width: 'fit-content' }}>
                                    {plan}
                                  </span>
                                  {c.planMonthlyPrice > 0 && (
                                    <span style={{ fontSize: 10, color: pc.color }}>{formatCurrency(c.planMonthlyPrice)}/mês</span>
                                  )}
                                  {inTrial && (
                                    <span style={{ fontSize: 10, color: '#92400e' }}>
                                      Trial: {Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000))}d restantes
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ padding: 12 }}>
                            {(() => {
                              const expired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
                              const label = !c.active ? 'Suspensa' : expired ? 'Vencida' : 'Ativa';
                              const color = !c.active ? '#6b7280' : expired ? '#b91c1c' : '#15803d';
                              const bg    = !c.active ? '#f3f4f6' : expired ? '#fef2f2' : '#f0fdf4';
                              return (
                                <span style={{ background: bg, color, border: `1px solid ${color}30`, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                                  {expired && c.active && <AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                                  {label}
                                </span>
                              );
                            })()}
                          </td>
                          <td style={{ padding: 12, whiteSpace: 'nowrap', fontSize: 13 }}>
                            {(() => {
                              const r = formatRemaining(c.expiresAt);
                              const color = r.expired ? '#b91c1c' : r.urgent ? '#d97706' : '#15803d';
                              return (
                                <div>
                                  <div style={{ fontWeight: 600, color }}>{r.text}</div>
                                  {c.expiresAt && <div style={{ fontSize: 11, color: '#789088' }}>{formatExpiryDate(c.expiresAt)}</div>}
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ padding: 12 }}>{formatCurrency(Number(c.monthlyFee ?? 0))}</td>
                          <td style={{ padding: 12, textAlign: 'right' }}>
                            <span style={{ fontWeight: 600, color: (c.menuOpenCount ?? 0) > 0 ? '#2563eb' : '#9ca3af' }}>
                              {(c.menuOpenCount ?? 0).toLocaleString('pt-BR')}
                            </span>
                          </td>
                          <td style={{ padding: 12 }}>
                            <div style={{ position: 'relative' }} data-action-menu-id={c.id}>
                              <button 
                                type="button"
                                className="secondary-button"
                                onClick={(e) => {
                                  if (openActionMenuId === c.id) {
                                    closeActionMenu();
                                  } else {
                                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                    const menuWidth = 180;
                                    const rightSpace = window.innerWidth - rect.right;
                                    const estimatedHeight = c.active ? 270 : 230;
                                    const spaceBelow = window.innerHeight - rect.bottom - 8;
                                    const spaceAbove = rect.top - 8;
                                    const openUpwards = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
                                    setActionMenuPos({
                                      ...(openUpwards
                                        ? { bottom: window.innerHeight - rect.top + 4 }
                                        : { top: rect.bottom + 4 }),
                                      right: Math.max(8, Math.min(rightSpace, window.innerWidth - menuWidth - 8)),
                                      maxHeight: Math.max(120, Math.min(estimatedHeight, openUpwards ? spaceAbove : spaceBelow)),
                                    });
                                    setOpenActionMenuId(c.id);
                                  }
                                }}
                                style={{ padding: '6px 8px' }}
                              >
                                <MoreVertical size={16} />
                              </button>
                              {openActionMenuId === c.id && actionMenuPos && (
                                <div style={{
                                  position: 'fixed',
                                  top: actionMenuPos.top,
                                  bottom: actionMenuPos.bottom,
                                  right: actionMenuPos.right,
                                  background: '#fff',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: 8,
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                  minWidth: 180,
                                  maxWidth: 'calc(100vw - 16px)',
                                  maxHeight: actionMenuPos.maxHeight,
                                  overflowY: 'auto',
                                  zIndex: 9999,
                                }}>
                                  <button 
                                    type="button"
                                    onClick={() => { void handleRenew(c); closeActionMenu(); }}
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
                                    onClick={() => { openEditModalWithAdmin(c); closeActionMenu(); }}
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
                                    onClick={() => { void openUsersModal(c); closeActionMenu(); }}
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
                                        onClick={() => { void handleSuspendCompany(c.id); closeActionMenu(); }}
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
                                        onClick={() => { setInvoiceCompany(c); setShowInvoicesModal(true); closeActionMenu(); }}
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
                                      onClick={() => { void handleReactivateCompany(c.id); closeActionMenu(); }}
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
                                  <button
                                    type="button"
                                    onClick={() => { void handleDeleteCompany(c.id); closeActionMenu(); }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '8px 12px',
                                      border: 'none',
                                      borderTop: '1px solid #fee2e2',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      fontSize: 14,
                                      color: '#b91c1c'
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                  >
                                    Excluir empresa
                                  </button>
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
              <div className="panel-header super-panel-header">
                <div>
                  <span className="eyebrow">Análise</span>
                  <h2>Relatórios Financeiros</h2>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                  <select value={selectedReportCompany} onChange={(e) => setSelectedReportCompany(e.target.value)} style={{ padding: '9px 12px', borderRadius: 8, border: '2px solid #e5e7eb', fontSize: 14, fontWeight: 500, flex: '1 1 160px', minWidth: 0 }}>
                    <option value="all">Todos os restaurantes</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>

                  <div className="super-period-toggle" style={{ display: 'flex', gap: 4, padding: '4px', backgroundColor: '#f3f4f6', borderRadius: 8, flex: '1 1 auto' }}>
                    {reportPeriods.map((period) => (
                      <button key={period.value} type="button" onClick={() => setReportPeriod(period.value)}
                        style={{ padding: '7px 12px', borderRadius: 6, border: 'none', backgroundColor: reportPeriod === period.value ? '#ffffff' : 'transparent', color: reportPeriod === period.value ? '#1f2937' : '#6b7280', fontWeight: reportPeriod === period.value ? 600 : 500, cursor: 'pointer', boxShadow: reportPeriod === period.value ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.2s', whiteSpace: 'nowrap', fontSize: 13 }}>
                        {period.label}
                      </button>
                    ))}
                  </div>

                  <button className="secondary-button" type="button" onClick={() => void loadSuperReports()} disabled={loadingReport} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {loadingReport ? '⏳' : '↻ Atualizar'}
                  </button>
                </div>
              </div>

              {/* Abas de relatório com scroll horizontal */}
              <div className="super-report-tabs" style={{ display: 'flex', gap: 8, marginBottom: 18, overflowX: 'auto', paddingBottom: 6, scrollbarWidth: 'none' }}>
                {[
                  { id: 'revenue', label: '💰 Faturamento' },
                  { id: 'products', label: '📦 Produtos' },
                  { id: 'payments', label: '💳 Pagamentos' },
                  { id: 'users', label: '👥 Usuários' },
                  { id: 'audit', label: '📋 Auditoria' },
                  { id: 'health', label: '❤️ Sistema' },
                ].map((tab) => (
                  <button key={tab.id} type="button"
                    className={`secondary-button ${reportsTab === tab.id ? 'active' : ''}`}
                    onClick={() => setReportsTab(tab.id as any)}
                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Revenue Report */}
              {reportsTab === 'revenue' && revenueReport && (
                <div>
                  <h3 style={{ marginBottom: 14, fontSize: 17, fontWeight: 700 }}>Faturamento por Período</h3>
                  <div className="super-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
                    {[
                      { label: 'Total de Faturamento', value: formatCurrency(revenueReport.totalValue), bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', icon: <DollarSign size={28} style={{ opacity: 0.7 }} /> },
                      { label: 'Total de Pedidos', value: revenueReport.totalOrders, bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', icon: <ShoppingCart size={28} style={{ opacity: 0.7 }} /> },
                      { label: 'Total de Itens', value: revenueReport.totalItems, bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', icon: <ShoppingBag size={28} style={{ opacity: 0.7 }} /> },
                      { label: 'Ticket Médio', value: formatCurrency(revenueReport.totalOrders > 0 ? revenueReport.totalValue / revenueReport.totalOrders : 0), bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', icon: <TrendingUp size={28} style={{ opacity: 0.7 }} /> },
                    ].map((kpi) => (
                      <div key={kpi.label} className="panel" style={{ padding: 18, background: kpi.bg, color: '#fff', borderRadius: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kpi.label}</div>
                            <div className="kpi-value" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{kpi.value}</div>
                          </div>
                          <span className="kpi-icon">{kpi.icon}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <h4 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>Por Restaurante</h4>
                  <div className="super-table-wrap" style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
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
                        <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Target size={22} style={{ color: '#667eea' }} />
                          Top 10 Produtos Mais Vendidos
                        </h3>
                        <div className="super-table-wrap" style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
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
                        <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <AlertTriangle size={22} style={{ color: '#f59e0b' }} />
                          Produtos com Baixo Desempenho <span style={{ fontSize: 13, fontWeight: 500, color: '#9ca3af' }}>(menos de 5 vendas)</span>
                        </h3>
                        <div className="super-table-wrap" style={{ overflowX: 'auto', borderRadius: 10, border: '2px solid #fbbf24' }}>
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
                  <div style={{ display: 'grid', gap: 28 }}>
                    {paymentMethodsReport && (
                      <div>
                        <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Banknote size={22} style={{ color: '#10b981' }} />
                          Formas de Pagamento
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                          {paymentMethodsReport.methods?.map((method: any, idx: number) => {
                            const colors = [
                              { bg: '#f0fdf4', border: '#86efac', label: '#166534', badge: '#dcfce7', badgeText: '#166534' },
                              { bg: '#eff6ff', border: '#93c5fd', label: '#1e40af', badge: '#dbeafe', badgeText: '#1e40af' },
                              { bg: '#fdf4ff', border: '#d8b4fe', label: '#6b21a8', badge: '#f3e8ff', badgeText: '#6b21a8' },
                              { bg: '#fff7ed', border: '#fdba74', label: '#9a3412', badge: '#ffedd5', badgeText: '#9a3412' },
                            ];
                            const c = colors[idx % colors.length];
                            return (
                              <div key={method.method} style={{ padding: 16, borderRadius: 10, border: `2px solid ${c.border}`, background: c.bg }}>
                                <div style={{ color: c.label, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{method.method}</div>
                                <div style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 10 }}>{formatCurrency(method.totalAmount)}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ color: '#6b7280', fontSize: 12 }}>{method.count} transações</span>
                                  <span style={{ backgroundColor: c.badge, color: c.badgeText, padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>{method.percentage}%</span>
                                </div>
                              </div>
                            );
                          })}
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
                <div style={{ display: 'grid', gap: 28 }}>
                  {userActivityReport && (
                    <div>
                      <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Users size={22} style={{ color: '#667eea' }} />
                        Usuários Mais Ativos
                      </h3>
                      <div className="super-table-wrap" style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                              <th style={{ padding: '13px 16px', textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Usuário</th>
                              <th style={{ padding: '13px 16px', textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Email</th>
                              <th style={{ padding: '13px 16px', textAlign: 'center', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Função</th>
                              <th style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Pedidos</th>
                              <th style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Itens</th>
                            </tr>
                          </thead>
                          <tbody>
                            {userActivityReport.users?.length === 0 && (
                              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>Nenhum usuário ativo no período</td></tr>
                            )}
                            {userActivityReport.users?.map((user: any, idx: number) => (
                              <tr key={user.userId} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                                <td style={{ padding: '13px 16px', fontWeight: 600, color: '#1f2937' }}>{user.userName}</td>
                                <td style={{ padding: '13px 16px', color: '#6b7280', fontSize: 13 }}>{user.userEmail}</td>
                                <td style={{ padding: '13px 16px', textAlign: 'center' }}>
                                  <span style={{ background: '#ede9fe', color: '#5b21b6', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{user.userRole}</span>
                                </td>
                                <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 700, color: '#1f2937' }}>{user.ordersCreated}</td>
                                <td style={{ padding: '13px 16px', textAlign: 'right', color: '#6b7280' }}>{user.itemsSold}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {subscriptionReport && (
                    <div>
                      <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CheckCircle size={22} style={{ color: '#10b981' }} />
                        Status de Assinaturas
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                        {subscriptionReport.subscriptions?.map((sub: any) => {
                          const isAtivo = sub.status?.toUpperCase() === 'ATIVO';
                          const isSuspend = sub.status?.toUpperCase().includes('SUSPEND') || sub.status?.toUpperCase().includes('INATIVO');
                          const bg = isAtivo ? '#f0fdf4' : isSuspend ? '#fef2f2' : '#fffbeb';
                          const border = isAtivo ? '#86efac' : isSuspend ? '#fca5a5' : '#fcd34d';
                          const labelColor = isAtivo ? '#166534' : isSuspend ? '#991b1b' : '#92400e';
                          return (
                            <div key={sub.status} className="panel" style={{ padding: 16, background: bg, border: `2px solid ${border}`, borderRadius: 10 }}>
                              <div style={{ color: labelColor, fontSize: 13, fontWeight: 800, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {sub.status} <span style={{ background: border, color: labelColor, borderRadius: 99, padding: '2px 8px', fontSize: 12 }}>{sub.count}</span>
                              </div>
                              <div style={{ marginTop: 6, fontSize: 12, color: '#5d6c66' }}>
                                {sub.companies?.slice(0, 4).map((c: any) => (
                                  <div key={c.companyId} style={{ padding: '2px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>• {c.companyName}</div>
                                ))}
                                {sub.companies?.length > 4 && <div style={{ fontStyle: 'italic', marginTop: 4, color: '#9ca3af' }}>+{sub.companies.length - 4} mais</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Audit Report */}
              {reportsTab === 'audit' && auditLogReport && (
                <div>
                  <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Activity size={22} style={{ color: '#f59e0b' }} />
                    Histórico de Auditoria <span style={{ fontSize: 13, fontWeight: 500, color: '#9ca3af' }}>(últimas 100 ações)</span>
                  </h3>
                  <div className="super-table-wrap" style={{ overflowX: 'auto', maxHeight: '62vh', overflowY: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb', position: 'sticky', top: 0, zIndex: 1 }}>
                          <th style={{ padding: '13px 16px', textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 13, whiteSpace: 'nowrap' }}>Data/Hora</th>
                          <th style={{ padding: '13px 16px', textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Usuário</th>
                          <th style={{ padding: '13px 16px', textAlign: 'center', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Ação</th>
                          <th style={{ padding: '13px 16px', textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Entidade</th>
                          <th style={{ padding: '13px 16px', textAlign: 'left', fontWeight: 700, color: '#1f2937', fontSize: 13 }}>Restaurante</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogReport.logs?.length === 0 && (
                          <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>Nenhuma ação registrada no período</td></tr>
                        )}
                        {auditLogReport.logs?.map((log: any, idx: number) => {
                          const action = (log.action || '').toUpperCase();
                          const actionStyle = action.includes('DELETE') || action.includes('DELET')
                            ? { bg: '#fee2e2', color: '#991b1b' }
                            : action.includes('CREATE') || action.includes('INSERT')
                            ? { bg: '#dcfce7', color: '#166534' }
                            : action.includes('UPDATE') || action.includes('EDIT')
                            ? { bg: '#fef3c7', color: '#92400e' }
                            : { bg: '#dbeafe', color: '#1e40af' };
                          return (
                            <tr key={log.id} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                              <td style={{ padding: '11px 16px', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>{new Date(log.createdAt).toLocaleString('pt-BR')}</td>
                              <td style={{ padding: '11px 16px', fontWeight: 600, color: '#1f2937', fontSize: 13 }}>{log.userName}</td>
                              <td style={{ padding: '11px 16px', textAlign: 'center' }}>
                                <span style={{ background: actionStyle.bg, color: actionStyle.color, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{log.action}</span>
                              </td>
                              <td style={{ padding: '11px 16px', fontSize: 12, color: '#6b7280' }}>{log.entity}</td>
                              <td style={{ padding: '11px 16px', color: '#374151', fontSize: 13 }}>{log.companyName}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Health Report */}
              {reportsTab === 'health' && healthReport && (
                <div style={{ display: 'grid', gap: 28 }}>
                  <div>
                    <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Activity size={22} style={{ color: '#ef4444' }} />
                      Saúde do Sistema
                    </h3>
                    <div className="super-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
                      {[
                        { label: 'Empresas', value: healthReport.companies?.total ?? 0, icon: <Building size={26} style={{ opacity: 0.7 }} />, bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          sub: healthReport.companies?.byStatus?.map((s: any) => `${s.status}: ${s.count}`).join(' · ') },
                        { label: 'Usuários', value: healthReport.users?.total ?? 0, icon: <Users size={26} style={{ opacity: 0.7 }} />, bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                          sub: healthReport.users?.byRole?.slice(0,3).map((r: any) => `${r.role}: ${r.count}`).join(' · ') },
                        { label: 'Assinaturas Ativas', value: healthReport.subscriptions?.active ?? 0, icon: <CheckCircle size={26} style={{ opacity: 0.7 }} />, bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', sub: null },
                        { label: 'Mesas', value: healthReport.tables ?? 0, icon: <ShoppingBag size={26} style={{ opacity: 0.7 }} />, bg: 'linear-gradient(135deg, #fa8231 0%, #f7b731 100%)', sub: null },
                        { label: 'Produtos', value: healthReport.products ?? 0, icon: <ShoppingCart size={26} style={{ opacity: 0.7 }} />, bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', sub: null },
                        { label: 'Pedidos', value: healthReport.orders ?? 0, icon: <TrendingUp size={26} style={{ opacity: 0.7 }} />, bg: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', sub: null },
                      ].map((kpi) => (
                        <div key={kpi.label} className="panel" style={{ padding: 16, background: kpi.bg, color: '#fff', borderRadius: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kpi.label}</div>
                              <div className="kpi-value" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>{kpi.value}</div>
                              {kpi.sub && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6, lineHeight: 1.4 }}>{kpi.sub}</div>}
                            </div>
                            <span className="kpi-icon">{kpi.icon}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {hourlyPeaksReport && hourlyPeaksReport.peakHours?.length > 0 && (
                    <div>
                      <h3 style={{ marginBottom: 16, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Clock size={22} style={{ color: '#8b5cf6' }} />
                        Horários de Pico <span style={{ fontSize: 13, fontWeight: 500, color: '#9ca3af' }}>(Top 8)</span>
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                        {hourlyPeaksReport.peakHours?.map((peak: any, idx: number) => {
                          const intensity = idx === 0 ? '#7c3aed' : idx <= 2 ? '#8b5cf6' : '#a78bfa';
                          return (
                            <div key={peak.hour} className="panel" style={{ padding: 14, borderRadius: 10, border: `2px solid ${idx === 0 ? '#7c3aed' : '#e5e7eb'}`, position: 'relative', overflow: 'hidden' }}>
                              {idx === 0 && <div style={{ position: 'absolute', top: 6, right: 8, fontSize: 10, fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔥 Pico</div>}
                              <div style={{ fontSize: 18, fontWeight: 800, color: intensity, marginBottom: 8 }}>{peak.hour}</div>
                              <div style={{ fontSize: 12, color: '#6b7280', display: 'grid', gap: 3 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Pedidos</span><strong style={{ color: '#1f2937' }}>{peak.orders}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Itens</span><strong style={{ color: '#1f2937' }}>{peak.items}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}><span>Receita</span><strong style={{ color: '#059669' }}>{formatCurrency(peak.revenue)}</strong></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* SuperAdmin — Carteiras: saldo de cada empresa e fila de saques */}
        {activeModule === 'carteiras' && currentUser?.role === 'SUPER' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header super-panel-header">
                <div>
                  <span className="eyebrow">Plataforma</span>
                  <h2>Carteiras das empresas</h2>
                </div>
                <button className="secondary-button" type="button" onClick={() => void loadCarteirasData()} disabled={loadingWallets}>
                  {loadingWallets ? '⏳' : '↻ Atualizar'}
                </button>
              </div>

              <div style={{ background: platformMpStatus?.connected ? '#f0fdf4' : '#fffbeb', border: `1px solid ${platformMpStatus?.connected ? '#bbf7d0' : '#fde68a'}`, borderRadius: 10, padding: '14px 16px', marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Mercado Pago — conta master da plataforma</h3>
                    <p style={{ margin: 0, fontSize: 12, color: platformMpStatus?.connected ? '#15803d' : '#92400e' }}>
                      {platformMpStatus?.connected
                        ? `✅ Configurado${platformMpStatus.connectedAt ? ' em ' + new Date(platformMpStatus.connectedAt).toLocaleString('pt-BR') : ''}`
                        : '⚠️ Não configurado — pagamentos online ficarão indisponíveis até configurar o Access Token.'}
                    </p>
                  </div>
                </div>
                <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label>
                    Access Token {platformMpStatus?.connected && <span style={{ fontSize: 11, fontWeight: 400, color: '#789088' }}>(deixe em branco para manter o atual)</span>}
                    <input
                      type="password"
                      value={platformMpTokenInput}
                      onChange={(e) => setPlatformMpTokenInput(e.target.value)}
                      placeholder="APP_USR-..."
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Public Key <span style={{ fontSize: 11, fontWeight: 400, color: '#789088' }}>(opcional)</span>
                    <input
                      value={platformMpPublicKeyInput}
                      onChange={(e) => setPlatformMpPublicKeyInput(e.target.value)}
                      placeholder="APP_USR-..."
                      autoComplete="off"
                    />
                  </label>
                </div>
                <button className="primary-button" type="button" style={{ marginTop: 10, width: 'fit-content' }} disabled={savingPlatformMpToken} onClick={() => void savePlatformMercadoPagoToken()}>
                  {savingPlatformMpToken ? 'Salvando...' : 'Salvar configuração'}
                </button>
              </div>

              <div className="super-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
                {[
                  { label: 'Saldo total em carteiras', value: formatCurrency(companyWallets.reduce((s, w) => s + w.balance, 0)), bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
                  { label: 'Saques pendentes', value: String(pendingWithdrawals.length), bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
                  { label: 'Valor pendente de saque', value: formatCurrency(pendingWithdrawals.reduce((s, w) => s + w.amount, 0)), bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
                ].map((kpi) => (
                  <div key={kpi.label} className="panel" style={{ padding: 18, background: kpi.bg, color: '#fff', borderRadius: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kpi.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{kpi.value}</div>
                  </div>
                ))}
              </div>

              <h4 style={{ marginBottom: 12, fontSize: 16, fontWeight: 700 }}>Solicitações de saque pendentes</h4>
              {pendingWithdrawals.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 24 }}>Nenhuma solicitação pendente.</p>
              ) : (
                <div className="super-table-wrap" style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 24 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                        <th style={{ padding: 12, textAlign: 'left', fontWeight: 700, fontSize: 13 }}>Empresa</th>
                        <th style={{ padding: 12, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>Valor</th>
                        <th style={{ padding: 12, textAlign: 'left', fontWeight: 700, fontSize: 13 }}>Chave Pix</th>
                        <th style={{ padding: 12, textAlign: 'left', fontWeight: 700, fontSize: 13 }}>Origem</th>
                        <th style={{ padding: 12, textAlign: 'left', fontWeight: 700, fontSize: 13 }}>Solicitado em</th>
                        <th style={{ padding: 12, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingWithdrawals.map((w) => (
                        <tr key={w.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: 12 }}>{w.companyName}</td>
                          <td style={{ padding: 12, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(w.amount)}</td>
                          <td style={{ padding: 12 }}>{w.pixKeyUsed ?? '—'}</td>
                          <td style={{ padding: 12 }}>{w.isAutomatic ? 'Automático (domingo)' : 'Manual'}</td>
                          <td style={{ padding: 12 }}>{new Date(w.requestedAt).toLocaleString('pt-BR')}</td>
                          <td style={{ padding: 12, textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="primary-button" type="button" disabled={resolvingWithdrawalId === w.id}
                              onClick={() => confirmAction(`Confirmar que o repasse de ${formatCurrency(w.amount)} para ${w.companyName} foi pago via Pix?`, () => handleResolveWithdrawal(w.id, true))}>
                              ✅ Marcar pago
                            </button>
                            <button className="secondary-button" type="button" disabled={resolvingWithdrawalId === w.id}
                              onClick={() => confirmAction(`Rejeitar esse saque e devolver ${formatCurrency(w.amount)} ao saldo de ${w.companyName}?`, () => handleResolveWithdrawal(w.id, false))}>
                              ✕ Rejeitar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={{ marginBottom: 12, fontSize: 16, fontWeight: 700 }}>Saldo por empresa</h4>
              <div className="super-table-wrap" style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 700, fontSize: 13 }}>Empresa</th>
                      <th style={{ padding: 12, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>Saldo</th>
                      <th style={{ padding: 12, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>Taxa</th>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 700, fontSize: 13 }}>Chave Pix de repasse</th>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 700, fontSize: 13 }}>Atualizado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyWallets.map((w) => (
                      <tr key={w.companyId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: 12 }}>{w.companyName}</td>
                        <td style={{ padding: 12, textAlign: 'right', fontWeight: 700, color: '#15803d' }}>{formatCurrency(w.balance)}</td>
                        <td style={{ padding: 12, textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                            <input
                              type="text"
                              value={feeEditInputs[w.companyId] ?? String(w.deliveryFeePercent)}
                              onChange={(e) => setFeeEditInputs((prev) => ({ ...prev, [w.companyId]: e.target.value }))}
                              style={{ width: 56, padding: '4px 6px', fontSize: 13, textAlign: 'right', border: '1px solid #e5e7eb', borderRadius: 6 }}
                            />
                            <span style={{ fontSize: 13 }}>%</span>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ padding: '3px 8px', fontSize: 11 }}
                              disabled={savingFeeCompanyId === w.companyId || feeEditInputs[w.companyId] == null || feeEditInputs[w.companyId] === String(w.deliveryFeePercent)}
                              onClick={() => void saveCompanyDeliveryFee(w.companyId)}
                            >
                              {savingFeeCompanyId === w.companyId ? '...' : 'Salvar'}
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: 12 }}>{w.payoutPixKey ?? '—'}</td>
                        <td style={{ padding: 12 }}>{new Date(w.updatedAt).toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 300 }} onClick={() => setShowRenewModal(false)}>
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
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 300 }} onClick={() => setShowEditModal(false)}>
            <div style={{ background: '#fff', padding: 20, borderRadius: 10, minWidth: 360 }} onClick={(e) => e.stopPropagation()}>
              <h3>Editar — {selectedCompany.name}</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <label>Nome<input value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
                <label>Email<input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></label>
                <label>Telefone<input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} /></label>
                <label>Endereco<input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} /></label>
                <label>Mensalidade<input value={editMonthlyFee} onChange={(e) => setEditMonthlyFee(e.target.value)} /></label>
                <label>Taxa da plataforma (%)<input value={editDeliveryFeePercent} onChange={(e) => setEditDeliveryFeePercent(e.target.value)} /></label>
                <label>
                  Plano
                  <select
                    value={editPlan}
                    onChange={(e) => {
                      const p = e.target.value as 'STARTER' | 'TRIAL' | 'PRO' | 'ENTERPRISE';
                      setEditPlan(p);
                      if (!editPlanMonthlyPrice) {
                        setEditPlanMonthlyPrice(p === 'STARTER' ? '79' : p === 'PRO' ? '149' : '0');
                      }
                    }}
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    <option value="STARTER">Starter (até 10 mesas)</option>
                    <option value="TRIAL">Trial (acesso Pro por tempo limitado)</option>
                    <option value="PRO">Pro (mesas ilimitadas + KDS + Carteira)</option>
                    <option value="ENTERPRISE">Enterprise (personalizado)</option>
                  </select>
                </label>
                <label>
                  Preço do plano (R$/mês)
                  <input type="number" min="0" step="0.01" value={editPlanMonthlyPrice} onChange={(e) => setEditPlanMonthlyPrice(e.target.value)} placeholder="Ex: 149" />
                </label>
                <label>
                  Trial (dias a adicionar, deixe vazio para não alterar)
                  <input type="number" min="0" value={editTrialDays} onChange={(e) => setEditTrialDays(e.target.value)} placeholder="Ex: 14" />
                </label>
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
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 300 }} onClick={() => setShowInvoicesModal(false)}>
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

        {activeModule === 'delivery' && (() => {
          const dlvTotal = dlvItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0) + (Number(dlvDeliveryFee.replace(',', '.')) || 0);
          const statusConfig: Record<string, { label: string; color: string; bg: string; next: string }> = {
            RECEBIDO:          { label: 'Recebido',        color: '#92400e', bg: '#fffbeb', next: 'Iniciar preparo' },
            EM_PREPARO:        { label: 'Em preparo',      color: '#1e40af', bg: '#eff6ff', next: 'Saiu para entrega' },
            SAIU_PARA_ENTREGA: { label: 'Saiu p/ entrega', color: '#065f46', bg: '#ecfdf5', next: 'Marcar entregue' },
            ENTREGUE:          { label: 'Entregue',        color: '#15803d', bg: '#f0fdf4', next: '' },
            CANCELADO:         { label: 'Cancelado',       color: '#6b7280', bg: '#f3f4f6', next: '' },
          };

          return (
            <section className="module-grid two-columns">

              {/* Painel esquerdo: novo pedido */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 80px)' }}>
                {/* Abas */}
                <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 0 }}>
                  {(['novo', 'ativos'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setDlvTab(t)}
                      style={{ flex: 1, padding: '10px', fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer', borderBottom: dlvTab === t ? '2px solid #16211d' : '2px solid transparent', marginBottom: -2, background: 'none', color: dlvTab === t ? '#16211d' : '#789088' }}>
                      {t === 'novo' ? '+ Novo pedido' : `Pedidos ativos (${deliveryOrders.length})`}
                    </button>
                  ))}
                </div>

                {dlvTab === 'novo' && (
                  <div className="panel product-form" style={{ borderRadius: '0 0 12px 12px' }}>
                    {/* Dados do cliente */}
                    <div className="panel-header">
                      <div><span className="eyebrow">Cliente</span><h2>Dados de entrega</h2></div>
                      <Bike size={22} />
                    </div>

                    <label><User size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Nome do cliente
                      <input value={dlvCustomerName} onChange={(e) => setDlvCustomerName(e.target.value)} placeholder="Ex: João Silva" autoComplete="off" />
                    </label>
                    <label><Phone size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Telefone
                      <input value={dlvCustomerPhone} onChange={(e) => setDlvCustomerPhone(e.target.value)} placeholder="(00) 90000-0000" inputMode="tel" autoComplete="off" />
                    </label>
                    <label><MapPin size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Endereço de entrega
                      <input value={dlvCustomerAddress} onChange={(e) => setDlvCustomerAddress(e.target.value)} placeholder="Rua, número, bairro" autoComplete="off" />
                    </label>

                    <div className="form-grid">
                      <label>Forma de pagamento
                        <select value={dlvPaymentMethod} onChange={(e) => setDlvPaymentMethod(e.target.value)}>
                          <option value="DINHEIRO">💵 Dinheiro</option>
                          <option value="PIX">⚡ PIX</option>
                          <option value="CREDITO">💳 Crédito</option>
                          <option value="DEBITO">🏦 Débito</option>
                        </select>
                      </label>
                      <label>Taxa de entrega (R$)
                        <input value={dlvDeliveryFee} onChange={(e) => setDlvDeliveryFee(e.target.value)} inputMode="decimal" placeholder="0,00" autoComplete="off" />
                      </label>
                    </div>

                    <label>Observações
                      <input value={dlvNotes} onChange={(e) => setDlvNotes(e.target.value)} placeholder="Ex: Sem cebola, troco para R$50..." autoComplete="off" />
                    </label>

                    {/* Adicionar itens */}
                    <div style={{ borderTop: '1px solid #eef2ef', paddingTop: 14, marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#789088', marginBottom: 10 }}>Itens do pedido</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                        <div style={{ flex: 2, position: 'relative' }}>
                          <input
                            type="text"
                            placeholder="Buscar produto..."
                            autoComplete="off"
                            value={dlvProductSearch}
                            onChange={(e) => {
                              setDlvProductSearch(e.target.value);
                              setDlvSelectedProduct('');
                              setDlvProductDropdownOpen(true);
                            }}
                            onFocus={() => setDlvProductDropdownOpen(true)}
                            onBlur={() => setTimeout(() => setDlvProductDropdownOpen(false), 150)}
                            style={{ width: '100%', borderColor: dlvSelectedProduct ? '#16a34a' : undefined }}
                          />
                          {dlvProductDropdownOpen && dlvProductSearch.trim().length > 0 && (() => {
                            const filtered = products.filter((p) => p.available && p.name.toLowerCase().includes(dlvProductSearch.toLowerCase()));
                            if (filtered.length === 0) return null;
                            return (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #dbe3de', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                                {filtered.map((p) => (
                                  <div
                                    key={p.id}
                                    onMouseDown={() => {
                                      setDlvSelectedProduct(p.id);
                                      setDlvProductSearch(p.name);
                                      setDlvProductDropdownOpen(false);
                                    }}
                                    style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid #f0f2f0' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8faf8')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                                  >
                                    <span>{p.name}</span>
                                    <span style={{ color: '#7a8a7a', fontWeight: 600 }}>{formatCurrency(p.price)}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                        <input value={dlvProductQty} onChange={(e) => setDlvProductQty(e.target.value)} inputMode="numeric" placeholder="Qtd" style={{ width: 60 }} />
                        <button type="button" className="primary-button" style={{ padding: '0 12px' }} onClick={addDeliveryItem}>
                          <Plus size={16} />
                        </button>
                      </div>
                      <input value={dlvProductNote} onChange={(e) => setDlvProductNote(e.target.value)} placeholder="Observação do item (opcional)" style={{ marginBottom: 10 }} autoComplete="off" />

                      {dlvItems.length === 0 && <p style={{ fontSize: 13, color: '#789088', textAlign: 'center', padding: 12 }}>Nenhum item adicionado.</p>}
                      {dlvItems.map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#f9fbf9', borderRadius: 8, marginBottom: 6 }}>
                          <span style={{ flex: 1, fontSize: 13 }}><strong>{item.quantity}×</strong> {item.productName}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{formatCurrency(item.quantity * item.unitPrice)}</span>
                          <button type="button" onClick={() => removeDeliveryItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>

                    {/* Totais */}
                    {dlvItems.length > 0 && (
                      <div style={{ background: '#16211d', color: '#f4f7f2', borderRadius: 10, padding: '12px 16px', marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#9aada6' }}>
                          <span>Subtotal</span><span>{formatCurrency(dlvItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0))}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#9aada6' }}>
                          <span>Taxa de entrega</span><span>{formatCurrency(Number(dlvDeliveryFee.replace(',', '.')) || 0)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                          <span>Total</span><span>{formatCurrency(dlvTotal)}</span>
                        </div>
                      </div>
                    )}

                    <button className="primary-button" type="button" style={{ marginTop: 12 }} onClick={() => void submitDeliveryOrder()}>
                      <Bike size={16} style={{ marginRight: 8 }} /> Confirmar pedido
                    </button>
                  </div>
                )}

                {dlvTab === 'ativos' && (
                  <div className="panel" style={{ borderRadius: '0 0 12px 12px' }}>
                    <div className="panel-header">
                      <div><span className="eyebrow">Em andamento</span><h2>Pedidos ativos</h2></div>
                      <button className="secondary-button" type="button" onClick={() => void loadDeliveryOrders()} style={{ fontSize: 12 }}>Atualizar</button>
                    </div>
                    {loadingDelivery && <p style={{ textAlign: 'center', color: '#789088', padding: 20 }}>Carregando...</p>}
                    {!loadingDelivery && deliveryOrders.length === 0 && (
                      <p style={{ textAlign: 'center', color: '#789088', padding: 20 }}>Nenhum pedido ativo no momento.</p>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {deliveryOrders.map((order) => {
                        const cfg = statusConfig[order.status] ?? statusConfig.RECEBIDO;
                        const hasCancellationRequest = !!(order as any).cancellationRequestedAt;
                        return (
                          <div key={order.id} style={{ border: hasCancellationRequest ? '1.5px solid #f97316' : '1.5px solid #e5e7eb', borderRadius: 12, padding: 16, background: hasCancellationRequest ? '#fff7ed' : '#fafbfa' }}>
                            {hasCancellationRequest && (
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#ffedd5', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                                <span style={{ fontSize: 16 }}>⚠️</span>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 700, fontSize: 13, color: '#c2410c' }}>Estorno solicitado</div>
                                  {order.status === 'ENTREGUE' && <div style={{ fontSize: 12, color: '#9a3412', fontWeight: 600, marginTop: 2 }}>⚠️ Atenção: pedido já foi entregue. Possível má fé.</div>}
                                  {(order as any).cancellationReason && <div style={{ fontSize: 12, color: '#7c2d12', marginTop: 4 }}>Motivo: {(order as any).cancellationReason}</div>}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                    <button type="button"
                                      disabled={approvingRefundId === order.id}
                                      style={{ flex: 1, padding: '8px 0', background: approvingRefundId === order.id ? '#86efac' : '#16a34a', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: approvingRefundId === order.id ? 'not-allowed' : 'pointer', transition: 'background .15s' }}
                                      onClick={async () => {
                                        if (approvingRefundId) return;
                                        if (!confirm(order.status === 'ENTREGUE' ? '⚠️ O pedido já foi entregue. Tem certeza que deseja aprovar o estorno?' : `Aprovar estorno de ${formatCurrency(order.total)} para ${order.customerName}?\n\nO valor será devolvido automaticamente via Mercado Pago.`)) return;
                                        setApprovingRefundId(order.id);
                                        // Remove imediatamente da lista (otimista)
                                        setDeliveryOrders((prev: DeliveryOrder[]) => prev.filter((o) => o.id !== order.id));
                                        try {
                                          const result = await api.approveRefund(order.id);
                                          if (result.warning) {
                                            showToast(`⚠️ ${result.warning}`, 'warning');
                                          } else if (result.action === 'refunded') {
                                            showToast('Estorno aprovado. O valor foi devolvido via Mercado Pago.', 'success');
                                          } else if (result.action === 'cancelled_no_refund') {
                                            showToast('Pedido cancelado. Pagamento em dinheiro — sem estorno online.', 'info');
                                          } else {
                                            showToast('Pedido cancelado com sucesso.', 'success');
                                          }
                                          void loadDeliveryOrders();
                                        } catch (e: any) {
                                          void loadDeliveryOrders();
                                          showToast(e.message ?? 'Falha ao aprovar estorno.', 'error');
                                        } finally {
                                          setApprovingRefundId(null);
                                        }
                                      }}>
                                      {approvingRefundId === order.id ? 'Processando...' : '✓ Aprovar estorno'}
                                    </button>
                                    <button type="button" style={{ flex: 1, padding: '8px 0', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                                      onClick={async () => {
                                        if (!confirm('Rejeitar solicitação de cancelamento? O pedido continuará ativo.')) return;
                                        // Remove o banner de estorno otimisticamente
                                        setDeliveryOrders((prev: DeliveryOrder[]) => prev.map((o) => o.id !== order.id ? o : { ...o, cancellationRequestedAt: null, cancellationReason: null } as any));
                                        try { await api.rejectRefund(order.id); void loadDeliveryOrders(); showToast('Solicitação rejeitada. Pedido continua ativo.', 'info'); }
                                        catch (e: any) { void loadDeliveryOrders(); showToast(e.message ?? 'Falha ao rejeitar.', 'error'); }
                                      }}>
                                      ✗ Rejeitar
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 15 }}>{order.customerName}</div>
                                {order.customerPhone && <div style={{ fontSize: 12, color: '#789088', marginTop: 2 }}><Phone size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{order.customerPhone}</div>}
                                <div style={{ fontSize: 12, color: '#789088', marginTop: 2 }}><MapPin size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{order.customerAddress}</div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}30`, borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  {cfg.label}
                                </span>
                                {order.status !== 'ENTREGUE' && order.status !== 'CANCELADO' && order.createdAt && (() => {
                                  const mins = Math.floor((nowTick - new Date(order.createdAt).getTime()) / 60000);
                                  const color = mins >= 30 ? '#b91c1c' : mins >= 15 ? '#92400e' : '#15803d';
                                  const bg = mins >= 30 ? '#fef2f2' : mins >= 15 ? '#fffbeb' : '#f0fdf4';
                                  return (
                                    <span style={{ background: bg, color, border: `1px solid ${color}30`, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                      ⏱ {mins < 1 ? '<1 min' : `${mins} min`}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 10 }}>
                              {order.items.map((item, i) => (
                                <span key={i}>{item.quantity}× {item.productName}{i < order.items.length - 1 ? ', ' : ''}</span>
                              ))}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: 16 }}>{formatCurrency(order.total)}</span>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button type="button" className="secondary-button" style={{ fontSize: 12, padding: '6px 10px' }} onClick={(e) => { e.stopPropagation(); printDeliveryReceipt(order); }}>
                                  🖨 Recibo
                                </button>
                                {cfg.next && (
                                  <button type="button" className="primary-button" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => void advanceDeliveryStatus(order)}>
                                    {cfg.next}
                                  </button>
                                )}
                                {order.status !== 'ENTREGUE' && order.status !== 'CANCELADO' && (
                                  <button type="button" className="secondary-button" style={{ fontSize: 12, padding: '6px 10px', color: '#b91c1c', borderColor: '#fca5a5' }} onClick={() => cancelDeliveryOrder(order)}>
                                    Cancelar
                                  </button>
                                )}
                              </div>
                            </div>
                            {order.notes && <div style={{ marginTop: 8, fontSize: 12, color: '#789088', background: '#f9fbf9', borderRadius: 6, padding: '6px 10px' }}>📝 {order.notes}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Painel direito: resumo do dia */}
              <div className="panel" style={{ alignSelf: 'flex-start' }}>
                <div className="panel-header">
                  <div><span className="eyebrow">Resumo</span><h2>Delivery de hoje</h2></div>
                  <Package size={22} />
                </div>

                {/* Toggle aberto / fechado */}
                {(role === 'ADMIN' || role === 'GERENTE') && currentCompany && (() => {
                  const manualOpen = currentCompany.isOpen !== false;
                  const opening = currentCompany.openingTime ?? '18:00';
                  const closing = currentCompany.closingTime ?? '00:00';
                  const now = new Date();
                  const [oh, om] = opening.split(':').map(Number);
                  const [ch, cm] = closing.split(':').map(Number);
                  const nowMin = now.getHours() * 60 + now.getMinutes();
                  const openMin = (oh ?? 0) * 60 + (om ?? 0);
                  const closeMin = (ch ?? 0) * 60 + (cm ?? 0);
                  const inHours = closeMin <= openMin
                    ? nowMin >= openMin || nowMin < closeMin
                    : nowMin >= openMin && nowMin < closeMin;
                  const effectivelyOpen = manualOpen && inHours;
                  const statusColor = effectivelyOpen ? '#15803d' : '#b91c1c';
                  const statusBg = effectivelyOpen ? '#f0fdf4' : '#fef2f2';
                  const statusBorder = effectivelyOpen ? '#86efac' : '#fca5a5';
                  const closedReason = !manualOpen ? 'fechado manualmente' : !inHours ? `fora do horário (${opening}–${closing})` : '';
                  return (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#789088', marginBottom: 8 }}>Status do cardápio online</div>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = !manualOpen;
                          setCurrentCompany((prev: any) => prev ? { ...prev, isOpen: next } : prev);
                          try {
                            await api.setStoreIsOpen(next);
                            showToast(next ? 'Loja marcada como aberta manualmente.' : 'Loja marcada como fechada manualmente.', 'info');
                          } catch (e: any) {
                            setCurrentCompany((prev: any) => prev ? { ...prev, isOpen: !next } : prev);
                            showToast(e?.message || 'Falha ao atualizar status.', 'error');
                          }
                        }}
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                          background: statusBg, color: statusColor, border: `1.5px solid ${statusBorder}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        }}
                      >
                        {effectivelyOpen ? '🟢 Estamos abertos' : '🔴 Estamos fechados'}
                      </button>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>
                        {effectivelyOpen
                          ? `Horário: ${opening}–${closing} · Clique para fechar manualmente`
                          : closedReason
                            ? `Fechado: ${closedReason}${!manualOpen ? ' · Clique para abrir manualmente' : ''}`
                            : 'Clique para abrir manualmente'}
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const today = new Date().toDateString();
                  const entregues = deliveryOrdersAll.filter((o) => o.status === 'ENTREGUE' && new Date(o.createdAt).toDateString() === today).length;
                  const emAndamento = deliveryOrders.filter((o) => !['ENTREGUE', 'CANCELADO'].includes(o.status)).length;
                  const totalReceita = deliveryOrdersAll.filter((o) => o.status === 'ENTREGUE' && new Date(o.createdAt).toDateString() === today).reduce((s, o) => s + o.total, 0);
                  return (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {[
                        { label: 'Em andamento', value: emAndamento, color: '#1e40af' },
                        { label: 'Entregues', value: entregues, color: '#15803d' },
                        { label: 'Receita delivery', value: formatCurrency(totalReceita), color: '#16211d', large: true },
                      ].map((s) => (
                        <div key={s.label} style={{ padding: 14, background: '#f9fbf9', borderRadius: 10, border: '1px solid #eef2ef' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#789088', marginBottom: 4 }}>{s.label}</div>
                          <div style={{ fontSize: s.large ? 22 : 28, fontWeight: 800, color: s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

            </section>
          );
        })()}

        {activeModule === 'caixa' && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>

            {/* Sub-abas de Caixa */}
            <div style={{ background: '#fff', flexShrink: 0, borderBottom: '2px solid #eef2ef' }}>
              <div style={{ display: 'flex', gap: 0, padding: '0 8px', overflowX: 'auto' }}>
                {([
                  { key: 'operacao',   label: '🏧 Operação' },
                  { key: 'relatorios', label: '📊 Relatórios' },
                  { key: 'recibos',    label: '🧾 Recibos' },
                  { key: 'carteira',   label: '💰 Carteira' },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCaixaSubTab(tab.key)}
                    style={{
                      background: 'none', border: 'none',
                      borderBottom: caixaSubTab === tab.key ? '3px solid #18201d' : '3px solid transparent',
                      marginBottom: -2, padding: '14px 20px 13px',
                      fontWeight: caixaSubTab === tab.key ? 700 : 500,
                      fontSize: 14,
                      color: caixaSubTab === tab.key ? '#18201d' : '#789088',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                      transition: 'color 0.15s, border-color 0.15s',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── ABA: OPERAÇÃO ── */}
            {caixaSubTab === 'operacao' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Métricas rápidas */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                  <div className="panel metric-panel" style={{ margin: 0 }}>
                    <span className="eyebrow">Pedidos ativos</span>
                    <strong>{formatCurrency(totalOpenOrders)}</strong>
                    <p>valor em comandas abertas</p>
                  </div>
                  {cashRegister && (
                    <>
                      <div className="panel metric-panel" style={{ margin: 0 }}>
                        <span className="eyebrow">Pagamentos no caixa</span>
                        <strong>{formatCurrency(cashRegister.totalPayments)}</strong>
                        <p>{cashRegister.paymentsCount} transações</p>
                      </div>
                      <div className="panel metric-panel" style={{ margin: 0, background: cashRegister.totalPayments + cashRegister.initialAmount > 0 ? '#f0fdf4' : undefined }}>
                        <span className="eyebrow">Saldo esperado</span>
                        <strong>{formatCurrency(cashRegister.initialAmount + cashRegister.totalPayments)}</strong>
                        <p>inicial + pagamentos</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Controle de caixa */}
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
                        {/* Alerta de diferença no fechamento */}
                        {(() => {
                          const closing = Number(currentCashClosingAmount.replace(',', '.'));
                          const expected = cashRegister.initialAmount + cashRegister.totalPayments;
                          const diff = closing - expected;
                          if (!currentCashClosingAmount || isNaN(closing) || Math.abs(diff) < 0.01) return null;
                          const isShort = diff < 0;
                          return (
                            <div style={{ background: isShort ? '#fef2f2' : '#f0fdf4', border: `1px solid ${isShort ? '#fca5a5' : '#86efac'}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: isShort ? '#b91c1c' : '#15803d' }}>
                              {isShort ? '⚠️' : '✅'} Diferença de <strong>{formatCurrency(Math.abs(diff))}</strong> em relação ao esperado ({formatCurrency(expected)}).
                              {isShort ? ' Verifique se há troco ou pagamentos não registrados.' : ' Caixa com sobra.'}
                            </div>
                          );
                        })()}
                        <button
                          className="primary-button"
                          type="button"
                          onClick={async () => {
                            const value = Number(currentCashClosingAmount.replace(',', '.'));
                            if (Number.isNaN(value)) return showToast('Informe um valor de fechamento válido.', 'warning');
                            try {
                              await api.closeCashRegister(value);
                              await loadData();
                              setCurrentCashClosingAmount('');
                              showToast('Caixa fechado com sucesso!', 'success');
                            } catch (error) {
                              console.error(error);
                              showToast('Erro ao fechar o caixa.', 'error');
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
                          <input inputMode="decimal" placeholder="100.00" value={initialCashAmount} onChange={(event) => setInitialCashAmount(event.target.value)} />
                        </label>
                        <button
                          className="primary-button"
                          type="button"
                          onClick={async () => {
                            const value = Number(initialCashAmount.replace(',', '.'));
                            if (Number.isNaN(value)) return showToast('Informe um valor inicial válido.', 'warning');
                            try {
                              await api.openCashRegister(value);
                              await loadData();
                              showToast('Caixa aberto com sucesso!', 'success');
                            } catch (error) {
                              console.error(error);
                              showToast('Erro ao abrir o caixa.', 'error');
                            }
                          }}
                        >
                          Abrir caixa
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── ABA: RELATÓRIOS ── */}
            {caixaSubTab === 'relatorios' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* ── Seletor de período ── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', background: '#eef0ee', borderRadius: 10, padding: 3, gap: 2 }}>
                    {reportPeriods.map((option) => (
                      <button key={option.value} type="button" onClick={() => setReportPeriod(option.value)}
                        style={{ border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: reportPeriod === option.value ? 700 : 500, cursor: 'pointer', background: reportPeriod === option.value ? '#18201d' : 'transparent', color: reportPeriod === option.value ? '#f1c44e' : '#6b7a6b', transition: 'background 0.15s, color 0.15s', minHeight: 'unset' }}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {reportPeriod === 'daily' && <input type="date" value={reportRefDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReportRefDate(e.target.value)} style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: '1px solid #dbe3de', height: 34 }} />}
                    {reportPeriod === 'weekly' && <input type="date" value={reportRefDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReportRefDate(e.target.value)} style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: '1px solid #dbe3de', height: 34 }} />}
                    {reportPeriod === 'monthly' && <input type="month" value={reportRefDate.slice(0, 7)} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setReportRefDate(`${e.target.value}-01`)} style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: '1px solid #dbe3de', height: 34 }} />}
                    {reportPeriod === 'yearly' && <select value={reportRefDate.slice(0, 4)} onChange={(e) => setReportRefDate(`${e.target.value}-01-01`)} style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: '1px solid #dbe3de', height: 34 }}>{Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}</select>}
                    <button type="button" className="secondary-button" style={{ height: 34, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '0 14px' }} onClick={() => void previewReportPdf()}><ReceiptText size={15} />Visualizar</button>
                    <button type="button" className="primary-button" style={{ height: 34, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '0 14px' }} onClick={() => void exportReportPdf()}>↓ Exportar PDF</button>
                  </div>
                </div>

                {/* ── KPI Cards ── */}
                {reportSummary && (() => {
                  const avgTicket = reportSummary.totalOrders > 0 ? reportSummary.totalValue / reportSummary.totalOrders : 0;
                  const delta = prevMonthTotal !== null && prevMonthTotal > 0 && reportPeriod === 'monthly'
                    ? Math.round((reportSummary.totalValue - prevMonthTotal) / prevMonthTotal * 100) : null;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                      {/* Faturamento — destaque */}
                      <div style={{ background: '#18201d', borderRadius: 14, padding: '18px 20px', gridColumn: 'span 1' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#6b8c75', display: 'block', marginBottom: 8 }}>Faturamento</span>
                        <strong style={{ fontSize: 24, color: '#f1c44e', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px', display: 'block' }}>{formatCurrency(reportSummary.totalValue)}</strong>
                        {delta !== null && (
                          <div style={{ fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, color: delta >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                            <span>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%</span>
                            <span style={{ color: '#4a6b54', fontWeight: 400 }}>vs mês anterior</span>
                          </div>
                        )}
                        {prevMonthTotal !== null && prevMonthTotal === 0 && reportPeriod === 'monthly' && (
                          <div style={{ fontSize: 11, marginTop: 6, color: '#4a6b54' }}>sem dados anteriores</div>
                        )}
                      </div>
                      {/* Pedidos */}
                      <div style={{ background: '#f8faf8', border: '1px solid #dbe3de', borderRadius: 14, padding: '18px 20px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#7a8a7a', display: 'block', marginBottom: 8 }}>Pedidos</span>
                        <strong style={{ fontSize: 24, color: '#18201d', fontVariantNumeric: 'tabular-nums', display: 'block' }}>{reportSummary.totalOrders}</strong>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>comandas + deliveries</div>
                      </div>
                      {/* Ticket Médio */}
                      <div style={{ background: '#f8faf8', border: '1px solid #dbe3de', borderRadius: 14, padding: '18px 20px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#7a8a7a', display: 'block', marginBottom: 8 }}>Ticket Médio</span>
                        <strong style={{ fontSize: 24, color: '#18201d', fontVariantNumeric: 'tabular-nums', display: 'block' }}>{avgTicket > 0 ? formatCurrency(avgTicket) : '—'}</strong>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>por pedido</div>
                      </div>
                      {/* Itens */}
                      <div style={{ background: '#f8faf8', border: '1px solid #dbe3de', borderRadius: 14, padding: '18px 20px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#7a8a7a', display: 'block', marginBottom: 8 }}>Itens Vendidos</span>
                        <strong style={{ fontSize: 24, color: '#18201d', fontVariantNumeric: 'tabular-nums', display: 'block' }}>{reportSummary.totalItems}</strong>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>unidades no período</div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Gráfico de barras diário ── */}
                {reportPeriod === 'monthly' && (
                  <div className="panel" style={{ padding: '20px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                      <div>
                        <span className="eyebrow">Evolução</span>
                        <h3 style={{ margin: 0, fontSize: 15 }}>Faturamento por dia</h3>
                      </div>
                      {loadingChart
                        ? <span style={{ fontSize: 12, color: '#9ca3af' }}>Carregando...</span>
                        : <span style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>Hoje: <span style={{ background: '#f1c44e', padding: '2px 8px', borderRadius: 4, color: '#18201d', fontWeight: 700, fontSize: 11 }}>■</span></span>
                      }
                    </div>
                    {dailyChartData.length > 0 ? (() => {
                      const maxVal = Math.max(...dailyChartData.map((d) => d.value), 1);
                      const chartH = 140;
                      const padT = 8, padB = 24, padL = 48, padR = 8;
                      const totalDays = dailyChartData.length;
                      const svgW = Math.max(totalDays * 22, 480);
                      const plotW = svgW - padL - padR;
                      const plotH = chartH - padT - padB;
                      const barW = Math.max(8, (plotW / totalDays) * 0.68);
                      const gridVals = [0, 0.25, 0.5, 0.75, 1];
                      return (
                        <div style={{ overflowX: 'auto' }}>
                          <svg width={svgW} height={chartH} style={{ display: 'block' }}>
                            {/* Grid lines + y labels */}
                            {gridVals.map((t) => {
                              const y = padT + plotH * (1 - t);
                              const label = maxVal * t;
                              return (
                                <g key={t}>
                                  <line x1={padL} y1={y} x2={svgW - padR} y2={y} stroke="#dbe3de" strokeWidth={1} />
                                  <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">
                                    {label >= 1000 ? `${(label / 1000).toFixed(1)}k` : Math.round(label)}
                                  </text>
                                </g>
                              );
                            })}
                            {/* Bars */}
                            {dailyChartData.map((d, i) => {
                              const barH = Math.max(d.value > 0 ? 4 : 0, Math.round((d.value / maxVal) * plotH));
                              const x = padL + (i + 0.5) * (plotW / totalDays) - barW / 2;
                              const y = padT + plotH - barH;
                              const isToday = d.day === new Date().getDate() && reportRefDate.slice(0, 7) === new Date().toISOString().slice(0, 7);
                              return (
                                <g key={d.day}>
                                  <title>{`Dia ${d.day}: ${formatCurrency(d.value)}`}</title>
                                  <rect x={x} y={y} width={barW} height={barH} rx={3}
                                    fill={isToday ? '#f1c44e' : d.value > 0 ? '#18201d' : '#e8ece9'}
                                    style={{ cursor: 'default', transition: 'opacity .1s' }}
                                    onMouseOver={(e) => { (e.target as SVGElement).style.opacity = '0.7'; }}
                                    onMouseOut={(e) => { (e.target as SVGElement).style.opacity = '1'; }}
                                  />
                                  {(totalDays <= 15 || d.day % 5 === 0 || d.day === 1) && (
                                    <text x={x + barW / 2} y={chartH - 6} textAnchor="middle" fontSize={9} fill="#9ca3af">{d.day}</text>
                                  )}
                                </g>
                              );
                            })}
                          </svg>
                        </div>
                      );
                    })() : !loadingChart && (
                      <p style={{ color: '#9ca3af', fontSize: 13, padding: '20px 0' }}>Nenhum dado para o período selecionado.</p>
                    )}
                  </div>
                )}

                {/* ── Por origem ── */}
                {reportSummary ? (() => {
                  const allTables = [...reportSummary.tables].filter((t) => t.tableId !== '__delivery__').sort((a, b) => b.totalValue - a.totalValue);
                  const delivery = reportSummary.tables.find((t) => t.tableId === '__delivery__');
                  const grandTotal = reportSummary.totalValue || 1;
                  return (
                    <div className="panel" style={{ padding: '20px 22px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div>
                          <span className="eyebrow">Relatório</span>
                          <h3 style={{ margin: 0, fontSize: 15 }}>Resumo {reportSummary.periodLabel}</h3>
                        </div>
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#7a8a7a', marginBottom: 10 }}>Por origem</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                        {delivery && (() => {
                          const pct = Math.round((delivery.totalValue / grandTotal) * 100);
                          return (
                            <div key="delivery" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
                              <span style={{ fontSize: 15 }}>🛵</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                  <span style={{ fontWeight: 600, fontSize: 13, color: '#18201d' }}>Delivery</span>
                                  <span style={{ fontSize: 12, color: '#92400e' }}>{delivery.totalItems} pedidos</span>
                                </div>
                                <div style={{ background: '#fde68a', borderRadius: 100, height: 4 }}>
                                  <div style={{ background: '#f59e0b', borderRadius: 100, height: 4, width: `${pct}%` }} />
                                </div>
                              </div>
                              <strong style={{ fontSize: 14, color: '#92400e', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatCurrency(delivery.totalValue)}</strong>
                            </div>
                          );
                        })()}
                        {allTables.map((table) => {
                          const pct = Math.round((table.totalValue / grandTotal) * 100);
                          return (
                            <div key={table.tableId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#f8faf8', border: '1px solid #dbe3de', borderRadius: 10 }}>
                              <span style={{ fontSize: 15 }}>🍽️</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                  <span style={{ fontWeight: 600, fontSize: 13, color: '#18201d' }}>{table.tableName}</span>
                                  <span style={{ fontSize: 12, color: '#7a8a7a' }}>{table.totalItems} itens</span>
                                </div>
                                <div style={{ background: '#dbe3de', borderRadius: 100, height: 4 }}>
                                  <div style={{ background: '#18201d', borderRadius: 100, height: 4, width: `${pct}%` }} />
                                </div>
                              </div>
                              <strong style={{ fontSize: 14, color: '#18201d', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatCurrency(table.totalValue)}</strong>
                            </div>
                          );
                        })}
                        {allTables.length === 0 && !delivery && (
                          <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum dado no período.</p>
                        )}
                      </div>
                      {/* Total row */}
                      {(allTables.length > 0 || delivery) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid #dbe3de' }}>
                          <span style={{ fontSize: 12, color: '#7a8a7a', fontWeight: 600 }}>Total do período</span>
                          <strong style={{ fontSize: 16, color: '#18201d', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(reportSummary.totalValue)}</strong>
                        </div>
                      )}
                    </div>
                  );
                })() : hasReportAccess ? (
                  <div className="panel" style={{ padding: '28px 22px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Carregando relatório...</div>
                ) : (
                  <div className="panel" style={{ padding: '28px 22px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Seu perfil não tem acesso ao relatório financeiro.</div>
                )}
              </div>
            )}

            {/* ── ABA: RECIBOS ── */}
            {caixaSubTab === 'recibos' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                <div className="panel">
                  <div className="panel-header">
                    <div><span className="eyebrow">Histórico</span><h2>Recibos</h2></div>
                  </div>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="date" value={receiptsDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setReceiptsDate(e.target.value); setDailyReceipts([]); setSelectedReceipt(null); }} style={{ flex: 1, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid #dbe3de' }} />
                      <button className="primary-button" type="button" onClick={() => void loadDailyReceipts()} disabled={loadingReceipts} style={{ whiteSpace: 'nowrap' }}>Carregar</button>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text" placeholder="Nº do recibo (mesa)" value={searchReceiptNumber} onChange={(e) => setSearchReceiptNumber(e.target.value)} inputMode="numeric" />
                      <button className="secondary-button" type="button" onClick={() => void searchReceiptByNumber()} disabled={loadingReceipts}>Buscar</button>
                    </div>
                    {selectedReceipt && (
                      <div style={{ padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                          <div><strong>Recibo Nº</strong><p style={{ margin: 0 }}>{selectedReceipt.receiptNumber ? String(selectedReceipt.receiptNumber).padStart(6, '0') : '—'}</p></div>
                          <div><strong>Mesa</strong><p style={{ margin: 0 }}>{selectedReceipt.tableName}</p></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                          <div><strong>Subtotal</strong><p style={{ margin: 0 }}>{formatCurrency(selectedReceipt.subtotal)}</p></div>
                          <div><strong>Total</strong><p style={{ margin: 0, fontWeight: 700 }}>{formatCurrency(selectedReceipt.total)}</p></div>
                        </div>
                        {selectedReceipt.orders && selectedReceipt.orders.length > 0 && (
                          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                            <strong style={{ display: 'block', marginBottom: 8 }}>Itens</strong>
                            <div style={{ display: 'grid', gap: 6 }}>
                              {selectedReceipt.orders.flatMap((order: any) => order.items.map((item: any) => (
                                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                  <span>{item.productName} x{item.quantity}</span>
                                  <span>{formatCurrency(item.total)}</span>
                                </div>
                              )))}
                            </div>
                          </div>
                        )}
                        <button className="secondary-button" type="button" onClick={() => setSelectedReceipt(null)} style={{ marginTop: 12, width: '100%' }}>Fechar</button>
                      </div>
                    )}
                    {!selectedReceipt && (
                      <div style={{ overflowY: 'auto', maxHeight: 400 }}>
                        {loadingReceipts ? <p>Carregando recibos...</p> : dailyReceipts.length === 0 ? <p>Nenhum recibo encontrado.</p> : (
                          <div style={{ display: 'grid', gap: 6 }}>
                            {dailyReceipts.map((receipt) => (
                              <button key={receipt.id} type="button" className="secondary-button" onClick={() => setSelectedReceipt(receipt)}
                                style={{ textAlign: 'left', padding: '8px 12px', background: receipt.type === 'delivery' ? (receipt.paymentStatus === 'ESTORNADO' ? '#fef2f2' : receipt.status === 'CANCELADO' ? '#f9fafb' : '#fffbeb') : undefined, borderColor: receipt.type === 'delivery' ? (receipt.paymentStatus === 'ESTORNADO' ? '#fca5a5' : receipt.status === 'CANCELADO' ? '#e5e7eb' : '#fde68a') : undefined }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span>{receipt.type === 'delivery' ? <><strong>🚲 {receipt.receiptNumber ? `Nº ${String(receipt.receiptNumber).padStart(6, '0')} – ` : ''}{receipt.tableName}</strong></> : <><strong>Nº {String(receipt.receiptNumber).padStart(6, '0')}</strong> - {receipt.tableName}</>}</span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {receipt.type === 'delivery' && receipt.paymentStatus === 'ESTORNADO' && <span style={{ fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 6px' }}>ESTORNADO</span>}
                                    {receipt.type === 'delivery' && receipt.status === 'CANCELADO' && receipt.paymentStatus !== 'ESTORNADO' && <span style={{ fontSize: 10, fontWeight: 700, background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 6px' }}>CANCELADO</span>}
                                    <span style={{ fontWeight: 700, color: receipt.paymentStatus === 'ESTORNADO' || receipt.status === 'CANCELADO' ? '#9ca3af' : undefined, textDecoration: receipt.paymentStatus === 'ESTORNADO' ? 'line-through' : undefined }}>{formatCurrency(receipt.total)}</span>
                                  </div>
                                </div>
                                {receipt.type === 'delivery' && receipt.status && <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>{receipt.status} · {receipt.paymentMethod}</div>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── ABA: CARTEIRA ── */}
            {caixaSubTab === 'carteira' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                {(role === 'ADMIN' || role === 'GERENTE' || role === 'CAIXA' || role === 'FINANCEIRO') && (
                  <div className="panel">
                    <div className="panel-header">
                      <div><span className="eyebrow">Saldo</span><h2>Carteira</h2></div>
                    </div>
                    <div style={{ display: 'grid', gap: 14 }}>
                      {!isPro && (
                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
                          🔒 <strong>Plano Pro</strong> — Pagamentos online via Pix e Cartão, e saldo na Carteira, estão disponíveis no plano Pro. Entre em contato com o suporte para fazer upgrade.
                        </div>
                      )}
                      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px' }}>
                        <div style={{ fontSize: 12, color: '#15803d', fontWeight: 700, textTransform: 'uppercase' }}>Saldo disponível</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: '#15803d' }}>{formatCurrency(walletInfo?.balance ?? 0)}</div>
                        {walletInfo && walletInfo.deliveryFeePercent > 0 && (
                          <div style={{ fontSize: 12, color: '#4ade80', marginTop: 2 }}>Taxa da plataforma: {walletInfo.deliveryFeePercent}%</div>
                        )}
                      </div>
                      <label>
                        Chave Pix de repasse <span style={{ fontSize: 11, fontWeight: 400 }}>(usada pelo AdminSuper para transferir seus saques)</span>
                        <input value={walletPixKeyInput} onChange={(e) => setWalletPixKeyInput(e.target.value)} placeholder="Ex: +5511999999999 ou email@exemplo.com" autoComplete="off" />
                      </label>
                      <button className="secondary-button" type="button" style={{ width: 'fit-content' }} disabled={walletSavingPixKey} onClick={() => void saveWalletPixKey()}>
                        {walletSavingPixKey ? 'Salvando...' : 'Salvar chave Pix'}
                      </button>
                      {walletWithdrawals.some((w) => w.status === 'SOLICITADO') ? (
                        <p style={{ margin: 0, fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px' }}>
                          ⏳ Saque de {formatCurrency(walletWithdrawals.find((w) => w.status === 'SOLICITADO')?.amount ?? 0)} solicitado — aguardando transferência do AdminSuper.
                        </p>
                      ) : (
                        <button className="primary-button" type="button" style={{ width: 'fit-content' }} disabled={walletRequestingWithdrawal || !walletInfo || walletInfo.balance <= 0 || !walletInfo.payoutPixKey} onClick={() => void requestWalletWithdrawal()}>
                          {walletRequestingWithdrawal ? 'Solicitando...' : '💸 Solicitar saque'}
                        </button>
                      )}
                      {walletInfo && walletInfo.balance > 0 && !walletInfo.payoutPixKey && (
                        <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Cadastre a chave Pix de repasse acima para poder solicitar saque.</p>
                      )}
                      <div>
                        <h3 style={{ margin: '4px 0 8px', fontSize: 13 }}>Últimos lançamentos</h3>
                        {walletTransactions.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>Nenhum lançamento ainda.</p>
                        ) : (
                          <div style={{ display: 'grid', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                            {walletTransactions.map((t) => (
                              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, borderBottom: '1px solid #eef2ef', paddingBottom: 6 }}>
                                <div>
                                  <div>{t.description ?? t.type}</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{new Date(t.createdAt).toLocaleString()}</div>
                                </div>
                                <strong style={{ color: t.amount >= 0 ? '#15803d' : '#b91c1c', whiteSpace: 'nowrap' }}>
                                  {t.amount >= 0 ? '+' : ''}{formatCurrency(t.amount)}
                                </strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {activeModule === 'ajustes' && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>

            {/* Sub-abas de Ajustes */}
            <div style={{ position: 'relative', background: '#fff', flexShrink: 0 }}>
            <div className="ajustes-subtabs" style={{ display: 'flex', gap: 0, borderBottom: '2px solid #eef2ef', background: '#fff', padding: '0 8px', overflowX: 'auto', flexShrink: 0 }}>
              {([
                { key: 'loja',        label: '🏪 Dados da Loja' },
                { key: 'tecnico',     label: '⚙️ Configurações Técnicas' },
                { key: 'pagamentos',  label: '💳 Pagamentos' },
                { key: 'assinatura',  label: '📋 Assinatura' },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setAjustesSubTab(tab.key)}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: ajustesSubTab === tab.key ? '3px solid #18201d' : '3px solid transparent',
                    marginBottom: -2,
                    padding: '14px 20px 13px',
                    fontWeight: ajustesSubTab === tab.key ? 700 : 500,
                    fontSize: 14,
                    color: ajustesSubTab === tab.key ? '#18201d' : '#789088',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Indicador de scroll → só aparece no mobile via CSS */}
            <div className="ajustes-subtabs-hint" aria-hidden="true">
              <span>›</span>
            </div>
            </div>{/* fim wrapper position:relative */}

            {/* ── ABA: DADOS DA LOJA ── */}
            {ajustesSubTab === 'loja' && (
              <div className="module-grid two-columns" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                <div className="panel settings-list">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">Recibo / Comprovante</span>
                      <h2>Dados da loja</h2>
                    </div>
                    <Settings size={22} />
                  </div>
                  <p style={{ fontSize: 12, color: '#9ca3af', margin: '-8px 0 8px' }}>
                    Essas informações aparecem nos recibos e comprovantes emitidos pelo sistema.
                  </p>
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
                    <input value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} placeholder="Rua, número - Bairro" />
                  </label>
                  <label>
                    Cidade
                    <input value={storeCity} onChange={(e) => setStoreCity(e.target.value)} placeholder="Ex: Recife" />
                  </label>
                  <label>
                    Telefone
                    <input value={storePhone} onChange={(e) => setStorePhone(e.target.value)} placeholder="(00) 0000-0000" />
                  </label>
                  <button className="primary-button" type="button" style={{ width: 'fit-content' }} onClick={saveStoreSettings}>Salvar dados da loja</button>
                </div>

                {/* Link público de Delivery */}
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">Delivery</span>
                      <h2>Link do cardápio online</h2>
                    </div>
                  </div>
                  <div style={{ padding: '0 0 8px' }}>
                    <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
                      Compartilhe este link com seus clientes. Ao acessar, eles verão o cardápio da sua loja e poderão fazer pedidos de delivery sem precisar de login.
                    </p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        readOnly
                        value={getPublicDeliveryLink()}
                        style={{ flex: 1, fontSize: 12, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', color: '#374151' }}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          void navigator.clipboard.writeText(getPublicDeliveryLink());
                          showToast('Link copiado!', 'success');
                        }}
                      >
                        Copiar
                      </button>
                    </div>
                    {currentUser?.companyId && (
                      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>QR Code para impressão ou exibição:</div>
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getPublicDeliveryLink())}`}
                          alt="QR Code delivery"
                          style={{ width: 160, height: 160, borderRadius: 8, border: '1px solid #e5e7eb' }}
                        />
                      </div>
                    )}
                    <div style={{ borderTop: '1px solid #f3f4f6', marginTop: 20, paddingTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Entrega e Horário</div>
                      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>Exibidos no cardápio online para o cliente antes de montar o pedido.</p>
                      <div style={{ display: 'grid', gap: 12 }}>
                        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                          Taxa de entrega (R$) — deixe 0 para "Frete grátis"
                          <input
                            type="number"
                            min="0"
                            step="0.50"
                            value={storeDeliveryFeeAmount}
                            onChange={(e) => setStoreDeliveryFeeAmount(e.target.value)}
                            placeholder="0"
                            style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
                          />
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                            Abre às
                            <input
                              type="time"
                              value={storeOpeningTime}
                              onChange={(e) => setStoreOpeningTime(e.target.value)}
                              style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                            Fecha às
                            <input
                              type="time"
                              value={storeClosingTime}
                              onChange={(e) => setStoreClosingTime(e.target.value)}
                              style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
                            />
                          </label>
                        </div>
                        <button className="primary-button" type="button" style={{ width: 'fit-content' }} onClick={saveStoreSettings}>
                          Salvar entrega e horário
                        </button>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid #f3f4f6', marginTop: 20, paddingTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Banner do cardápio</div>
                      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>Imagem exibida no topo do cardápio online. Ideal: 1200×400px.</p>
                      {currentCompany?.menuBannerUrl && (
                        <div style={{ marginBottom: 10, position: 'relative', display: 'inline-block' }}>
                          <img src={currentCompany.menuBannerUrl} alt="Banner" style={{ width: '100%', maxWidth: 400, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', display: 'block' }} />
                          <button type="button"
                            onClick={async () => {
                              await supabase.from('Company').update({ menuBannerUrl: null }).eq('id', currentUser?.companyId ?? '');
                              void loadCurrentCompany();
                              showToast('Banner removido.', 'success');
                            }}
                            style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>
                            Remover
                          </button>
                        </div>
                      )}
                      <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#374151' }}>
                        {currentCompany?.menuBannerUrl ? 'Trocar banner' : '+ Adicionar banner'}
                        <input type="file" accept="image/*" style={{ display: 'none' }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              await api.uploadMenuBanner(file);
                              void loadCurrentCompany();
                              showToast('Banner atualizado!', 'success');
                            } catch (err) {
                              showToast((err as Error).message, 'error');
                            }
                          }} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── ABA: CONFIGURAÇÕES TÉCNICAS ── */}
            {ajustesSubTab === 'tecnico' && (
              <div className="module-grid two-columns" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

                {/* Salão — Quantidade de mesas */}
                {(role === 'ADMIN' || role === 'GERENTE') && (
                  <div className="panel settings-list">
                    <div className="panel-header">
                      <div>
                        <span className="eyebrow">Salão</span>
                        <h2>Quantidade de mesas</h2>
                      </div>
                    </div>
                    <label>
                      Número de mesas ativas
                      <input
                        type="number"
                        min={0}
                        value={storeTableCount}
                        onChange={(e) => setStoreTableCount(e.target.value)}
                      />
                    </label>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>
                      Atual: <strong>{storeTableCountOriginal}</strong>. Aumentar adiciona novas mesas numeradas em sequência; diminuir remove as de maior número que estiverem livres (mesas ocupadas não são removidas).
                    </p>
                    <button
                      type="button"
                      style={{
                        marginTop: 10,
                        background: savingTableCount || Math.max(0, Math.floor(Number(storeTableCount) || 0)) === storeTableCountOriginal ? '#9ca3af' : '#18201d',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '8px 18px',
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: savingTableCount || Math.max(0, Math.floor(Number(storeTableCount) || 0)) === storeTableCountOriginal ? 'not-allowed' : 'pointer',
                        transition: 'background 0.2s',
                        width: 'fit-content',
                      }}
                      disabled={savingTableCount || Math.max(0, Math.floor(Number(storeTableCount) || 0)) === storeTableCountOriginal}
                      onClick={() => void saveTableCount()}
                    >
                      {savingTableCount ? 'Salvando...' : 'Aplicar quantidade de mesas'}
                    </button>
                  </div>
                )}

                {/* Impressoras térmicas — Electron mostra lista de impressoras instaladas; mobile/web usa nome/IP digitado */}
                <div className="panel settings-list">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">Hardware</span>
                      <h2>Impressoras térmicas</h2>
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', marginBottom: 4 }}>
                    <input type="checkbox" checked={printingDisabled} onChange={(e) => setPrintingDisabled(e.target.checked)} style={{ width: 'auto' }} />
                    <span>Desativar impressão (não imprimir nada automaticamente)</span>
                  </label>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: '#9ca3af' }}>
                    Use se não tiver impressora térmica ou não quiser imprimir os pedidos/recibos. Nenhuma tela de impressão será aberta no celular ou computador.
                  </p>
                  {!printingDisabled && ((window as any).sistema?.listPrinters ? (
                    <>
                      <label>
                        Impressora do Caixa
                        <select value={printerCashier} onChange={(e) => setPrinterCashier(e.target.value)}>
                          <option value="">— Selecione —</option>
                          {availablePrinters.map((p) => (
                            <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (padrão)' : ''}</option>
                          ))}
                        </select>
                      </label>
                      <label style={{ marginTop: 10 }}>
                        Impressora da Cozinha <span style={{ fontSize: 11, color: '#789088', fontWeight: 400 }}>(imprime automaticamente ao criar pedido)</span>
                        <select value={printerKitchen} onChange={(e) => setPrinterKitchen(e.target.value)}>
                          <option value="">— Selecione —</option>
                          {availablePrinters.map((p) => (
                            <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (padrão)' : ''}</option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="secondary-button" style={{ marginTop: 8, fontSize: 12 }}
                        onClick={() => {
                          const sistema = (window as any).sistema;
                          if (sistema?.listPrinters) sistema.listPrinters().then((list: any[]) => setAvailablePrinters(list));
                        }}>
                        🔄 Atualizar lista de impressoras
                      </button>
                    </>
                  ) : (
                    <>
                      <label>
                        Impressora do Caixa <span style={{ fontSize: 11, color: '#789088', fontWeight: 400 }}>(nome ou IP da impressora térmica)</span>
                        <input
                          type="text"
                          placeholder="Ex.: 192.168.0.50 ou Caixa-58mm"
                          value={printerCashier}
                          onChange={(e) => setPrinterCashier(e.target.value)}
                        />
                      </label>
                      <label style={{ marginTop: 10 }}>
                        Impressora da Cozinha <span style={{ fontSize: 11, color: '#789088', fontWeight: 400 }}>(nome ou IP da impressora térmica)</span>
                        <input
                          type="text"
                          placeholder="Ex.: 192.168.0.51 ou Cozinha-58mm"
                          value={printerKitchen}
                          onChange={(e) => setPrinterKitchen(e.target.value)}
                        />
                      </label>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>
                        Ao confirmar pedidos ou fechar a conta, escolha essa impressora na tela de impressão do dispositivo.
                      </p>
                    </>
                  ))}
                  <button className="primary-button" type="button" style={{ marginTop: 8, width: 'fit-content' }} onClick={saveStoreSettings}>Salvar impressoras</button>
                </div>

                {/* Segurança — Alterar senha */}
                <div className="panel settings-list">
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
                  <button className="primary-button" type="button" style={{ width: 'fit-content' }} onClick={() => void submitPasswordChange()}>Alterar senha</button>
                </div>
              </div>
            )}

            {/* ── ABA: PAGAMENTOS ── */}
            {ajustesSubTab === 'pagamentos' && (
              <div className="module-grid two-columns" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

                {/* Chave Pix estática — QR ao encerrar mesa */}
                <div className="panel settings-list">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">Pix estático</span>
                      <h2>QR Code ao encerrar mesa</h2>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: '#9ca3af', margin: '-8px 0 8px' }}>
                    Chave Pix exibida como QR Code quando uma mesa é encerrada sem pagamento digital. Usada para recebimentos manuais (dinheiro/Pix na mão).
                  </p>
                  <label>
                    Chave Pix <span>(email, CPF, CNPJ, telefone com +55 ou chave aleatória)</span>
                    <input
                      value={storePixKey}
                      onChange={(e) => setStorePixKey(e.target.value)}
                      placeholder="Ex: +5511999999999 ou email@exemplo.com"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Cidade <span>(obrigatório para gerar o QR Pix)</span>
                    <input value={storeCity} onChange={(e) => setStoreCity(e.target.value)} placeholder="Ex: Recife" />
                  </label>
                  <button className="primary-button" type="button" style={{ width: 'fit-content' }} onClick={saveStoreSettings}>Salvar chave Pix</button>
                </div>

                {/* Mercado Pago */}
                {(role === 'ADMIN' || role === 'GERENTE') && (
                  <div className="panel settings-list">
                    <div className="panel-header">
                      <div>
                        <span className="eyebrow">Pix online / Cobrança automática</span>
                        <h2>Mercado Pago</h2>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                      <span style={{ fontSize: 18 }}>✅</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#15803d' }}>Ativo</div>
                        <div style={{ fontSize: 12, color: '#4ade80' }}>Pagamentos online processados automaticamente pela plataforma Integra360.</div>
                      </div>
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: '#9ca3af' }}>
                      Cobranças Pix dinâmicas (mesa/comanda e delivery) com confirmação automática via webhook. O valor líquido é creditado na sua <strong>Carteira</strong>, na aba Caixa.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── ABA: ASSINATURA ── */}
            {ajustesSubTab === 'assinatura' && (() => {
              const plan = currentCompany?.plan ?? 'STARTER';
              const planLabel: Record<string, string> = { STARTER: 'Starter', TRIAL: 'Trial', PRO: 'Pro', ENTERPRISE: 'Enterprise' };
              const planPrice: Record<string, string> = { STARTER: 'R$ 79/mês', TRIAL: 'Gratuito', PRO: 'R$ 149/mês', ENTERPRISE: 'Sob consulta' };
              const planFeatures: Record<string, string[]> = {
                STARTER: ['Até 10 mesas', 'Delivery básico', 'Cardápio digital', 'Impressão de recibos', 'Relatórios básicos'],
                TRIAL:   ['Acesso completo ao Plano Pro por tempo limitado'],
                PRO: ['Mesas ilimitadas', 'Delivery completo', 'Pagamentos online (Pix + Cartão)', 'Carteira e saques', 'KDS (Cozinha)', 'Relatórios avançados', 'WhatsApp automático'],
                ENTERPRISE: ['Tudo do Pro', 'Múltiplas unidades', 'SLA prioritário', 'Onboarding dedicado'],
              };

              const handleSubscribe = async (targetPlan: 'STARTER' | 'PRO') => {
                if (!currentCompany) return;
                setSubscribing(targetPlan);
                try {
                  const result = await api.createMpSubscription(
                    currentCompany.id,
                    targetPlan,
                    window.location.href.split('?')[0]
                  );
                  window.open(result.initPoint, '_blank');
                } catch (e: any) {
                  showToast(e?.message || 'Falha ao iniciar assinatura.', 'error');
                } finally {
                  setSubscribing(null);
                }
              };

              const handleCancel = async () => {
                if (!currentCompany) return;
                if (!window.confirm('Deseja cancelar sua assinatura recorrente? O acesso continuará até o fim do período pago.')) return;
                try {
                  await api.cancelMpSubscription(currentCompany.id);
                  showToast('Assinatura cancelada. Seu acesso continua até o vencimento.', 'success');
                } catch (e: any) {
                  showToast(e?.message || 'Falha ao cancelar assinatura.', 'error');
                }
              };

              const canSubscribePlan = (p: string) => p === 'STARTER' || p === 'PRO';

              return (
                <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Plano atual */}
                  <div className="panel" style={{ padding: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <span className="eyebrow">Sua assinatura</span>
                        <h2 style={{ margin: 0 }}>Plano atual</h2>
                      </div>
                      <span style={{ background: isPro ? '#f0fdf4' : '#fef2f2', color: isPro ? '#15803d' : '#991b1b', border: `1px solid ${isPro ? '#bbf7d0' : '#fecaca'}`, borderRadius: 20, padding: '4px 14px', fontWeight: 700, fontSize: 13 }}>
                        {planLabel[plan] ?? plan}
                      </span>
                    </div>
                    {trialDaysLeft > 0 && (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', marginBottom: 16 }}>
                        ⏳ <strong>Trial Pro ativo</strong> — {trialDaysLeft} dia{trialDaysLeft !== 1 ? 's' : ''} restante{trialDaysLeft !== 1 ? 's' : ''}. Assine o plano Pro para continuar com acesso completo.
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(planFeatures[plan] ?? []).map((f) => (
                        <span key={f} style={{ background: '#f3f4f6', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#374151' }}>✓ {f}</span>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>
                      Valor: <strong style={{ color: '#18201d' }}>{planPrice[plan] ?? '—'}</strong>
                    </div>
                    {(plan === 'PRO' || plan === 'ENTERPRISE') && (
                      <button
                        onClick={handleCancel}
                        style={{ marginTop: 16, background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 14px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
                      >
                        Cancelar assinatura recorrente
                      </button>
                    )}
                  </div>

                  {/* Cards de planos */}
                  {plan !== 'ENTERPRISE' && (
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 12px' }}>Planos disponíveis</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                        {(['STARTER', 'PRO', 'ENTERPRISE'] as const).map((p) => {
                          const isCurrent = p === plan || (p === 'PRO' && plan === 'TRIAL');
                          const isDowngrade = p === 'STARTER' && (plan === 'PRO' || plan === 'ENTERPRISE');
                          const isLoading = subscribing === p;
                          return (
                            <div key={p} style={{ background: '#fff', border: isCurrent ? '2px solid #18201d' : '1px solid #e5e7eb', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong style={{ fontSize: 16 }}>{planLabel[p]}</strong>
                                {isCurrent && <span style={{ background: '#18201d', color: '#fff', borderRadius: 10, padding: '2px 10px', fontSize: 11 }}>Atual</span>}
                              </div>
                              <div style={{ fontSize: 20, fontWeight: 800, color: '#18201d' }}>{planPrice[p]}</div>
                              <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {planFeatures[p].map((f) => <li key={f}>{f}</li>)}
                              </ul>
                              {!isCurrent && !isDowngrade && canSubscribePlan(p) && (
                                <button
                                  onClick={() => handleSubscribe(p as 'STARTER' | 'PRO')}
                                  disabled={isLoading}
                                  style={{ display: 'block', width: '100%', textAlign: 'center', background: '#18201d', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 700, fontSize: 13, cursor: isLoading ? 'wait' : 'pointer', marginTop: 'auto', opacity: isLoading ? 0.7 : 1 }}
                                >
                                  {isLoading ? 'Aguarde...' : 'Assinar agora →'}
                                </button>
                              )}
                              {!isCurrent && !isDowngrade && !canSubscribePlan(p) && (
                                <a
                                  href={`https://wa.me/5587999710850?text=${encodeURIComponent(`Olá! Sou cliente do Integra360 (${currentCompany?.name ?? ''}) e gostaria de contratar o plano Enterprise.`)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ display: 'block', textAlign: 'center', background: '#18201d', color: '#fff', borderRadius: 8, padding: '10px 0', fontWeight: 700, fontSize: 13, textDecoration: 'none', marginTop: 'auto' }}
                                >
                                  Falar com suporte →
                                </a>
                              )}
                              {isDowngrade && (
                                <span style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 'auto' }}>Plano inferior ao atual</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Contato suporte */}
                  <div className="panel" style={{ padding: 20, background: '#f8fafc' }}>
                    <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Dúvidas sobre sua assinatura?</h3>
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>Entre em contato com nosso suporte via WhatsApp.</p>
                    <a
                      href={`https://wa.me/5587999710850?text=${encodeURIComponent('Olá! Preciso de ajuda com minha assinatura do Integra360.')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#25d366', color: '#fff', borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
                    >
                      💬 Falar com suporte
                    </a>
                  </div>
                </div>
              );
            })()}

          </section>
        )}
      </section>
    </main>
  );
}
