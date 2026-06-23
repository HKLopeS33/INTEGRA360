-- Configuração da conta Mercado Pago MASTER da plataforma (única, usada para
-- todos os pagamentos online de todas as empresas). O AdminSuper configura
-- essa credencial pela própria interface (aba Carteiras), em vez de precisar
-- usar a CLI do Supabase. O token é um SEGREDO — nunca deve ser lido por
-- clientes normais, só escrito via RPC abaixo e lido pelas Edge Functions
-- com a service-role key.

CREATE TABLE IF NOT EXISTS "PlatformSettings" (
  id boolean PRIMARY KEY DEFAULT true,
  "mercadoPagoAccessToken" text,
  "mercadoPagoPublicKey" text,
  "mercadoPagoConnectedAt" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_singleton CHECK (id)
);

INSERT INTO "PlatformSettings" (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE "PlatformSettings" ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy de SELECT/INSERT/UPDATE para authenticated/anon — toda
-- leitura de status e escrita passam pelas funções SECURITY DEFINER abaixo,
-- e a leitura do token em si só acontece via service-role (Edge Functions).

REVOKE ALL ON "PlatformSettings" FROM authenticated, anon;
GRANT SELECT ON "PlatformSettings" TO service_role;

-- RPC: AdminSuper salva/substitui o access token master.
CREATE OR REPLACE FUNCTION public.set_platform_mercado_pago_token(
  p_access_token text,
  p_public_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM "User" WHERE id = auth.uid()::text;
  IF v_role IS DISTINCT FROM 'SUPER' THEN
    RAISE EXCEPTION 'Apenas o AdminSuper pode configurar o Mercado Pago da plataforma.';
  END IF;

  UPDATE "PlatformSettings"
     SET "mercadoPagoAccessToken" = NULLIF(trim(p_access_token), ''),
         "mercadoPagoPublicKey" = NULLIF(trim(coalesce(p_public_key, '')), ''),
         "mercadoPagoConnectedAt" = CASE WHEN NULLIF(trim(p_access_token), '') IS NULL THEN NULL ELSE now() END,
         "updatedAt" = now()
   WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_platform_mercado_pago_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_platform_mercado_pago_token(text, text) TO authenticated;

-- RPC: AdminSuper consulta status SEM nunca ler o token em si.
CREATE OR REPLACE FUNCTION public.get_platform_mercado_pago_status()
RETURNS TABLE (connected boolean, public_key text, connected_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM "User" WHERE id = auth.uid()::text;
  IF v_role IS DISTINCT FROM 'SUPER' THEN
    RAISE EXCEPTION 'Apenas o AdminSuper pode ver essa configuração.';
  END IF;

  RETURN QUERY
  SELECT ("mercadoPagoAccessToken" IS NOT NULL), "mercadoPagoPublicKey", "mercadoPagoConnectedAt"
  FROM "PlatformSettings"
  WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_mercado_pago_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_mercado_pago_status() TO authenticated;
