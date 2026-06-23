// Resolve o access token da conta Mercado Pago MASTER da plataforma.
// Prioriza o valor configurado pelo AdminSuper (tabela PlatformSettings,
// editável pela UI) e cai para a secret MP_MASTER_ACCESS_TOKEN (definida via
// `supabase secrets set`) caso a tabela ainda não tenha sido configurada —
// isso evita quebrar instalações que já usavam a secret antes desta tabela
// existir.
export async function getMasterAccessToken(adminClient: any): Promise<string | null> {
  const { data } = await adminClient
    .from('PlatformSettings')
    .select('mercadoPagoAccessToken')
    .eq('id', true)
    .maybeSingle();

  return data?.mercadoPagoAccessToken ?? Deno.env.get('MP_MASTER_ACCESS_TOKEN') ?? null;
}
