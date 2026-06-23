-- Sistema de carteira (wallet): pagamentos online (delivery + mesa/comanda)
-- passam a usar uma única conta Mercado Pago "master" da plataforma. O valor
-- líquido (descontada a comissão de delivery, definida por restaurante pelo
-- AdminSuper) é creditado num saldo (ledger) por empresa, com saque manual
-- (solicitado pelo restaurante) ou automático (toda semana).
--
-- Segurança: "Wallet"/"WalletTransaction"/"WalletWithdrawal" só têm policy de
-- SELECT para authenticated — todo INSERT/UPDATE passa por função
-- SECURITY DEFINER (que valida role/empresa do chamador) ou pela service-role
-- key (Edge Functions), nunca por escrita direta do cliente.

-- ── Tabelas ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Wallet" (
  "companyId" text PRIMARY KEY REFERENCES "Company"(id) ON DELETE CASCADE,
  "balance" numeric(12,2) NOT NULL DEFAULT 0,
  "deliveryFeePercent" numeric(5,2) NOT NULL DEFAULT 0,
  "payoutPixKey" text,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "WalletTransaction" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "companyId" text NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
  "type" text NOT NULL CHECK ("type" IN ('CREDITO_DELIVERY', 'CREDITO_MESA', 'SAQUE_SOLICITADO', 'SAQUE_PAGO', 'SAQUE_REJEITADO', 'AJUSTE')),
  "amount" numeric(12,2) NOT NULL,
  "balanceAfter" numeric(12,2) NOT NULL,
  "deliveryOrderId" text REFERENCES "DeliveryOrder"(id) ON DELETE SET NULL,
  "tabId" text REFERENCES "Tab"(id) ON DELETE SET NULL,
  "withdrawalId" text,
  "description" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_tx_company_idx ON "WalletTransaction" ("companyId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "WalletWithdrawal" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "companyId" text NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
  "amount" numeric(12,2) NOT NULL,
  "status" text NOT NULL DEFAULT 'SOLICITADO' CHECK ("status" IN ('SOLICITADO', 'PAGO', 'REJEITADO')),
  "pixKeyUsed" text,
  "isAutomatic" boolean NOT NULL DEFAULT false,
  "requestedAt" timestamptz NOT NULL DEFAULT now(),
  "paidAt" timestamptz,
  "note" text
);

CREATE INDEX IF NOT EXISTS wallet_withdrawal_company_idx ON "WalletWithdrawal" ("companyId", "requestedAt" DESC);
CREATE INDEX IF NOT EXISTS wallet_withdrawal_status_idx ON "WalletWithdrawal" ("status");

-- ── RLS: apenas leitura para authenticated; escrita só via RPC/service-role ──

ALTER TABLE "Wallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalletTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalletWithdrawal" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_read"
  ON "Wallet" FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'SUPER'
    OR "companyId" = (SELECT "companyId" FROM "User" WHERE id = auth.uid()::text)
  );

CREATE POLICY "wallet_tx_read"
  ON "WalletTransaction" FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'SUPER'
    OR "companyId" = (SELECT "companyId" FROM "User" WHERE id = auth.uid()::text)
  );

CREATE POLICY "wallet_withdrawal_read"
  ON "WalletWithdrawal" FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'role' = 'SUPER'
    OR "companyId" = (SELECT "companyId" FROM "User" WHERE id = auth.uid()::text)
  );

-- ── Backfill + criação automática de carteira para empresas novas ──────────

INSERT INTO "Wallet" ("companyId")
SELECT id FROM "Company"
ON CONFLICT ("companyId") DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_wallet_for_new_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "Wallet" ("companyId") VALUES (NEW.id)
  ON CONFLICT ("companyId") DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_wallet_for_new_company ON "Company";
CREATE TRIGGER trg_create_wallet_for_new_company
  AFTER INSERT ON "Company"
  FOR EACH ROW
  EXECUTE FUNCTION public.create_wallet_for_new_company();

-- ── Função interna: credita/debita saldo + grava lançamento no ledger ──────
-- Não exposta a authenticated/anon — só chamada por outras funções deste
-- arquivo e pelas Edge Functions via service-role (que já bypassam RLS, mas
-- usar a função garante que o UPDATE do saldo e o INSERT do lançamento
-- aconteçam atomicamente numa única transação).

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_company_id text,
  p_amount numeric,
  p_type text,
  p_description text DEFAULT NULL,
  p_delivery_order_id text DEFAULT NULL,
  p_tab_id text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE "Wallet"
     SET "balance" = "balance" + p_amount,
         "updatedAt" = now()
   WHERE "companyId" = p_company_id
   RETURNING "balance" INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Carteira não encontrada para a empresa %', p_company_id;
  END IF;

  INSERT INTO "WalletTransaction"
    ("companyId", "type", "amount", "balanceAfter", "deliveryOrderId", "tabId", "description")
  VALUES
    (p_company_id, p_type, p_amount, v_new_balance, p_delivery_order_id, p_tab_id, p_description);

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet(text, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(text, numeric, text, text, text, text) TO service_role;

-- ── RPC: empresa define sua chave Pix de repasse (saque) ──────────────────

CREATE OR REPLACE FUNCTION public.set_payout_pix_key(p_pix_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text;
  v_role text;
BEGIN
  SELECT "companyId", role INTO v_company_id, v_role FROM "User" WHERE id = auth.uid()::text;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário sem empresa associada.';
  END IF;
  IF v_role NOT IN ('ADMIN', 'GERENTE') THEN
    RAISE EXCEPTION 'Apenas ADMIN ou GERENTE podem configurar a chave Pix de repasse.';
  END IF;

  UPDATE "Wallet"
     SET "payoutPixKey" = NULLIF(trim(p_pix_key), ''),
         "updatedAt" = now()
   WHERE "companyId" = v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_payout_pix_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_payout_pix_key(text) TO authenticated;

-- ── RPC: AdminSuper define a % de comissão de delivery por empresa ────────

CREATE OR REPLACE FUNCTION public.set_company_delivery_fee(p_company_id text, p_percent numeric)
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
    RAISE EXCEPTION 'Apenas o AdminSuper pode definir a comissão de delivery.';
  END IF;
  IF p_percent < 0 OR p_percent > 100 THEN
    RAISE EXCEPTION 'Percentual inválido.';
  END IF;

  UPDATE "Wallet"
     SET "deliveryFeePercent" = p_percent,
         "updatedAt" = now()
   WHERE "companyId" = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_delivery_fee(text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_company_delivery_fee(text, numeric) TO authenticated;

-- ── RPC: empresa solicita saque do saldo disponível ────────────────────────

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_amount numeric)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text;
  v_role text;
  v_balance numeric;
  v_pix_key text;
  v_pending_count int;
  v_withdrawal_id text;
BEGIN
  SELECT "companyId", role INTO v_company_id, v_role FROM "User" WHERE id = auth.uid()::text;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário sem empresa associada.';
  END IF;
  IF v_role NOT IN ('ADMIN', 'GERENTE') THEN
    RAISE EXCEPTION 'Apenas ADMIN ou GERENTE podem solicitar saque.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valor de saque inválido.';
  END IF;

  SELECT "balance", "payoutPixKey" INTO v_balance, v_pix_key FROM "Wallet" WHERE "companyId" = v_company_id;

  IF v_pix_key IS NULL THEN
    RAISE EXCEPTION 'Cadastre a chave Pix de repasse antes de solicitar saque.';
  END IF;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Valor solicitado maior que o saldo disponível.';
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM "WalletWithdrawal"
  WHERE "companyId" = v_company_id AND "status" = 'SOLICITADO';
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Já existe uma solicitação de saque pendente.';
  END IF;

  UPDATE "Wallet" SET "balance" = "balance" - p_amount, "updatedAt" = now() WHERE "companyId" = v_company_id;

  INSERT INTO "WalletWithdrawal" ("companyId", "amount", "pixKeyUsed")
  VALUES (v_company_id, p_amount, v_pix_key)
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO "WalletTransaction" ("companyId", "type", "amount", "balanceAfter", "withdrawalId", "description")
  VALUES (v_company_id, 'SAQUE_SOLICITADO', -p_amount, v_balance - p_amount, v_withdrawal_id, 'Saque solicitado');

  RETURN v_withdrawal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_wallet_withdrawal(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_wallet_withdrawal(numeric) TO authenticated;

-- ── RPC: AdminSuper aprova (marca pago) ou rejeita (devolve saldo) ────────

CREATE OR REPLACE FUNCTION public.resolve_wallet_withdrawal(
  p_withdrawal_id text,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_company_id text;
  v_amount numeric;
  v_status text;
  v_new_balance numeric;
BEGIN
  SELECT role INTO v_role FROM "User" WHERE id = auth.uid()::text;
  IF v_role IS DISTINCT FROM 'SUPER' THEN
    RAISE EXCEPTION 'Apenas o AdminSuper pode resolver solicitações de saque.';
  END IF;

  SELECT "companyId", "amount", "status" INTO v_company_id, v_amount, v_status
  FROM "WalletWithdrawal" WHERE id = p_withdrawal_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Solicitação de saque não encontrada.';
  END IF;
  IF v_status <> 'SOLICITADO' THEN
    RAISE EXCEPTION 'Esta solicitação já foi resolvida.';
  END IF;

  IF p_approve THEN
    UPDATE "WalletWithdrawal"
       SET "status" = 'PAGO', "paidAt" = now(), "note" = p_note
     WHERE id = p_withdrawal_id;

    INSERT INTO "WalletTransaction" ("companyId", "type", "amount", "balanceAfter", "withdrawalId", "description")
    SELECT v_company_id, 'SAQUE_PAGO', 0, "balance", p_withdrawal_id, coalesce(p_note, 'Saque pago')
    FROM "Wallet" WHERE "companyId" = v_company_id;
  ELSE
    UPDATE "WalletWithdrawal"
       SET "status" = 'REJEITADO', "note" = p_note
     WHERE id = p_withdrawal_id;

    UPDATE "Wallet" SET "balance" = "balance" + v_amount, "updatedAt" = now()
     WHERE "companyId" = v_company_id
     RETURNING "balance" INTO v_new_balance;

    INSERT INTO "WalletTransaction" ("companyId", "type", "amount", "balanceAfter", "withdrawalId", "description")
    VALUES (v_company_id, 'SAQUE_REJEITADO', v_amount, v_new_balance, p_withdrawal_id, coalesce(p_note, 'Saque rejeitado — saldo devolvido'));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_wallet_withdrawal(text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_wallet_withdrawal(text, boolean, text) TO authenticated;

-- ── Saque automático semanal (domingo 22h BRT = segunda 01:00 UTC) ────────
-- Brasil não tem mais horário de verão desde 2019 (UTC-3 fixo).

CREATE OR REPLACE FUNCTION public.process_weekly_withdrawals()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_withdrawal_id text;
BEGIN
  FOR r IN
    SELECT w."companyId", w."balance", w."payoutPixKey"
    FROM "Wallet" w
    WHERE w."balance" > 0
      AND w."payoutPixKey" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "WalletWithdrawal" ww
        WHERE ww."companyId" = w."companyId" AND ww."status" = 'SOLICITADO'
      )
  LOOP
    UPDATE "Wallet" SET "balance" = "balance" - r."balance", "updatedAt" = now()
    WHERE "companyId" = r."companyId";

    INSERT INTO "WalletWithdrawal" ("companyId", "amount", "pixKeyUsed", "isAutomatic")
    VALUES (r."companyId", r."balance", r."payoutPixKey", true)
    RETURNING id INTO v_withdrawal_id;

    INSERT INTO "WalletTransaction" ("companyId", "type", "amount", "balanceAfter", "withdrawalId", "description")
    VALUES (r."companyId", 'SAQUE_SOLICITADO', -r."balance", 0, v_withdrawal_id, 'Saque automático semanal');
  END LOOP;
END;
$$;

-- Não conceder EXECUTE a authenticated/anon — só roda via pg_cron (role postgres).
REVOKE ALL ON FUNCTION public.process_weekly_withdrawals() FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'weekly-wallet-withdrawal',
  '0 1 * * 1',
  $$ SELECT public.process_weekly_withdrawals(); $$
);

-- ── Desliga as conexões individuais de Mercado Pago por empresa ──────────
-- Os pagamentos online agora passam todos pela conta master da plataforma
-- (token configurado via `supabase secrets set MP_MASTER_ACCESS_TOKEN=...`).

UPDATE "Company" SET "mercadoPagoAccessToken" = NULL, "mercadoPagoPublicKey" = NULL, "mercadoPagoConnectedAt" = NULL;

REVOKE ALL ON FUNCTION public.set_company_mercado_pago_token(text, text) FROM authenticated;
