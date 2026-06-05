import { createClient, type User } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: localStorage
  }
});

// Client sem sessão — usado para requisições públicas (cardápio de delivery)
// Evita que JWT expirado do admin seja enviado junto com pedidos de clientes anônimos
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'supabase-anon-public'
  }
});

// Cliente com service role key — usado apenas para criar usuários via admin API
// (necessário para aceitar emails com domínios internos como .local)
// storageKey diferente evita conflito de GoTrueClient no mesmo contexto
export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: 'supabase-admin-auth'
      }
    })
  : null;

export const getAuthToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

export const setAuthToken = async (token: string | null, refreshToken?: string | null) => {
  if (!token) {
    await supabase.auth.signOut();
    return;
  }
  const { error } = await supabase.auth.setSession({
    access_token: token,
    refresh_token: refreshToken ?? token
  });
  if (error) {
    throw error;
  }
};

export const parseSupabaseUser = (user: User) => ({
  id: user.id,
  email: user.email,
  name: (user.user_metadata as any)?.name ?? user.email,
  role: (user.user_metadata as any)?.role,
  companyId: (user.user_metadata as any)?.companyId,
  emailConfirmed: Boolean(user.email_confirmed_at),
  raw: user
});
