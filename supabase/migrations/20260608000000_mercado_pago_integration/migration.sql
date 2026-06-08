-- Mercado Pago integration: each company can store its own access token to
-- create Pix charges through Mercado Pago. The token is a SECRET — it must
-- never be readable by normal clients. It's written by the company's own
-- ADMIN/GERENTE (via RPC below, never via direct table SELECT/UPDATE) and
-- read only by the Edge Function using the service-role key.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "mercadoPagoAccessToken" text,
  ADD COLUMN IF NOT EXISTS "mercadoPagoPublicKey" text,
  ADD COLUMN IF NOT EXISTS "mercadoPagoConnectedAt" timestamptz;

-- Make sure RLS never exposes the token through normal SELECT on Company:
-- we enforce this at the application layer (api.ts never selects this column),
-- but additionally revoke column-level select for the anon/authenticated roles
-- as defense in depth.
REVOKE SELECT ("mercadoPagoAccessToken") ON "Company" FROM authenticated, anon;
GRANT SELECT ("mercadoPagoAccessToken") ON "Company" TO service_role;

-- RPC used by the company's ADMIN/GERENTE to save/replace their own access
-- token. SECURITY DEFINER lets it write the protected column while still
-- checking the caller's role and company ownership explicitly.
CREATE OR REPLACE FUNCTION public.set_company_mercado_pago_token(
  p_access_token text,
  p_public_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text;
  v_role text;
BEGIN
  SELECT "companyId", role INTO v_company_id, v_role
  FROM "User"
  WHERE id = auth.uid()::text;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário sem empresa associada.';
  END IF;

  IF v_role NOT IN ('ADMIN', 'GERENTE') THEN
    RAISE EXCEPTION 'Apenas ADMIN ou GERENTE podem configurar o Mercado Pago.';
  END IF;

  UPDATE "Company"
     SET "mercadoPagoAccessToken" = NULLIF(trim(p_access_token), ''),
         "mercadoPagoPublicKey" = NULLIF(trim(coalesce(p_public_key, '')), ''),
         "mercadoPagoConnectedAt" = CASE WHEN NULLIF(trim(p_access_token), '') IS NULL THEN NULL ELSE now() END
   WHERE id = v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_mercado_pago_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_company_mercado_pago_token(text, text) TO authenticated;

-- RPC so the company can check connection status WITHOUT ever reading the
-- token itself (returns only a boolean + masked info).
CREATE OR REPLACE FUNCTION public.get_company_mercado_pago_status()
RETURNS TABLE (connected boolean, public_key text, connected_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text;
BEGIN
  SELECT "companyId" INTO v_company_id FROM "User" WHERE id = auth.uid()::text;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário sem empresa associada.';
  END IF;

  RETURN QUERY
  SELECT ("mercadoPagoAccessToken" IS NOT NULL), "mercadoPagoPublicKey", "mercadoPagoConnectedAt"
  FROM "Company"
  WHERE id = v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_mercado_pago_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_mercado_pago_status() TO authenticated;

-- Tracks Mercado Pago Pix charges, linked to the existing Payment/Tab records.
CREATE TABLE IF NOT EXISTS "MercadoPagoPayment" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "companyId" text NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
  "tabId" text REFERENCES "Tab"(id) ON DELETE SET NULL,
  "deliveryOrderId" text REFERENCES "DeliveryOrder"(id) ON DELETE SET NULL,
  "mpPaymentId" text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL,
  "qrCode" text,
  "qrCodeBase64" text,
  "ticketUrl" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "paidAt" timestamptz
);

CREATE INDEX IF NOT EXISTS mp_payment_company_idx ON "MercadoPagoPayment" ("companyId");
CREATE INDEX IF NOT EXISTS mp_payment_status_idx ON "MercadoPagoPayment" (status);

ALTER TABLE "MercadoPagoPayment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mp_payment_company_read"
  ON "MercadoPagoPayment" FOR SELECT
  TO authenticated
  USING ("companyId" = (SELECT "companyId" FROM "User" WHERE id = auth.uid()::text));

-- Inserts/updates are performed exclusively by the Edge Function via the
-- service-role key (bypasses RLS) — no policy granted for authenticated writes.
