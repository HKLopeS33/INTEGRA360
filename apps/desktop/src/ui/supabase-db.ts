import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

// Cache do usuário autenticado — evita 2 roundtrips a cada chamada de API.
// Invalidado no logout ou quando o usuário é explicitamente recarregado.
let _cachedUser: AppUser | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export function invalidateUserCache() {
  _cachedUser = null;
  _cacheTimestamp = 0;
}

export function setCachedUser(user: AppUser) {
  _cachedUser = user;
  _cacheTimestamp = Date.now();
}

export interface AppUser {
  id: string;
  email: string | null;
  name: string;
  role: string | null;
  companyId: string | null;
  active: boolean;
  emailConfirmed: boolean;
  raw: User;
}

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  active: boolean;
  companyId: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
}

export interface CompanyRow {
  id: string;
  name: string;
  email: string;
  cnpj: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pixKey: string | null;
  kitchenPrinter: string | null;
  cashierPrinter: string | null;
  printingDisabled: boolean;
  active: boolean;
  subscription?: {
    id: string;
    status: string;
    monthlyFee: string;
    expiresAt: string;
    lastRenewed: string;
    lastLoginAt: string | null;
  };
}

const USERS_TABLE = 'User';
const COMPANIES_TABLE = 'Company';

const normalizeMetadata = (user: User) => {
  const metadata = (user.user_metadata as Record<string, any> | null) ?? {};
  return {
    name: metadata.name ?? user.email ?? 'Usuário',
    role: metadata.role ?? null,
    companyId: metadata.companyId ?? null
  };
};

const mapUserRow = (user: User, row: UserRow): AppUser => ({
  id: user.id,
  email: user.email,
  name: row.name ?? user.email ?? 'Usuário',
  role: row.role ?? (normalizeMetadata(user).role ?? null),
  companyId: row.companyId ?? normalizeMetadata(user).companyId ?? null,
  active: row.active,
  emailConfirmed: Boolean(user.email_confirmed_at),
  raw: user
});

async function getAuthUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    const msg = error?.message ?? 'Usuário não autenticado.';
    // Refresh token inválido ou sessão ausente → força logout na UI
    if (
      msg.includes('Refresh Token') ||
      msg.includes('Auth session missing') ||
      msg.includes('Invalid Refresh Token') ||
      error?.status === 401
    ) {
      void supabase.auth.signOut();
      window.dispatchEvent(new CustomEvent('sistema:unauthorized'));
    }
    throw new Error(msg);
  }
  return data.user;
}

export async function getUserRowById(userId: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from<UserRow>(USERS_TABLE)
    .select('id,name,email,role,active,companyId,passwordHash,mustChangePassword')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Falha ao buscar usuário.');
  }

  return data ?? null;
}

export async function getCompanyById(companyId: string): Promise<CompanyRow | null> {
  const { data, error } = await supabase
    .from<CompanyRow>(COMPANIES_TABLE)
    .select('id,name,email,cnpj,phone,address,city,state,country,pixKey,kitchenPrinter,cashierPrinter,printingDisabled,active,plan,planMonthlyPrice,trialEndsAt,deliveryFeeAmount,openingTime,closingTime,menuBannerUrl,subscription:Subscription(id,status,monthlyFee,expiresAt,lastRenewed,lastLoginAt)')
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Falha ao buscar empresa.');
  }

  return data ?? null;
}

async function createUserRow(user: User, metadata: { name: string; role: string | null; companyId: string | null }): Promise<UserRow> {
  const now = new Date().toISOString();
  const insert = {
    id: user.id,
    name: metadata.name,
    email: user.email ?? '',
    role: metadata.role ?? 'CAIXA',
    active: true,
    companyId: metadata.companyId,
    passwordHash: 'supabase-auth',
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now
  };

  const { data, error } = await supabase.from<UserRow>(USERS_TABLE).insert(insert).select('id,name,email,role,active,companyId,passwordHash,mustChangePassword').single();
  if (error) {
    throw new Error(error.message || 'Falha ao criar registro de usuário.');
  }
  return data;
}

export async function loadCurrentUser(forceRefresh = false): Promise<AppUser> {
  if (!forceRefresh && _cachedUser && Date.now() - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedUser;
  }

  const authUser = await getAuthUser();
  let userRow = await getUserRowById(authUser.id);

  if (!userRow) {
    const metadata = normalizeMetadata(authUser);
    userRow = await createUserRow(authUser, metadata);
  }

  if (!userRow.active) {
    throw new Error('Usuário inativo.');
  }

  if (userRow.companyId) {
    const company = await getCompanyById(userRow.companyId);
    if (!company || !company.active) {
      throw new Error('Empresa inativa.');
    }
    if (company.subscription && ['SUSPENSO', 'EXPIRADO'].includes(company.subscription.status)) {
      throw new Error('Assinatura inativa.');
    }
  }

  const appUser = mapUserRow(authUser, userRow);
  setCachedUser(appUser);
  return appUser;
}

export async function requireCompanyUser() {
  const currentUser = await loadCurrentUser();
  if (!currentUser.companyId) {
    throw new Error('Usuário sem empresa associada.');
  }
  return currentUser;
}

export async function requireCompanyUserWithRoles(roles: string[]) {
  const currentUser = await requireCompanyUser();
  if (!currentUser.role || !roles.includes(currentUser.role)) {
    throw new Error('Acesso negado.');
  }
  return currentUser;
}

export async function requireSuperUser() {
  const currentUser = await loadCurrentUser();
  if (currentUser.role !== 'SUPER') {
    throw new Error('Acesso negado.');
  }
  return currentUser;
}

export async function getCompanyForCurrentUser() {
  const currentUser = await requireCompanyUser();
  const company = await getCompanyById(currentUser.companyId as string);
  if (!company) {
    throw new Error('Empresa não encontrada.');
  }
  return company;
}
