-- Expõe a Public Key da conta Mercado Pago master para clientes anônimos
-- (necessário para o cardápio público montar o Card Payment Brick no
-- navegador do cliente). Public Key não é segredo — é feita para ser
-- embutida em páginas de checkout; o Access Token continua protegido,
-- nunca exposto por esta função.

CREATE OR REPLACE FUNCTION public.get_platform_mercado_pago_public_key()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT "mercadoPagoPublicKey" FROM "PlatformSettings" WHERE id = true;
$$;

REVOKE ALL ON FUNCTION public.get_platform_mercado_pago_public_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_mercado_pago_public_key() TO anon, authenticated;
