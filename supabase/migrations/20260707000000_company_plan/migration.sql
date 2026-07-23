-- Adiciona controle de planos na tabela Company
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "plan"        TEXT NOT NULL DEFAULT 'STARTER',
  ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMPTZ;

-- Novos estabelecimentos ganham 14 dias de trial Pro automaticamente.
-- Aplica trial apenas às empresas que ainda não têm trialEndsAt definido.
UPDATE "Company"
  SET "trialEndsAt" = NOW() + INTERVAL '14 days'
  WHERE "trialEndsAt" IS NULL;

-- RPC para SuperAdmin alterar o plano de uma empresa
CREATE OR REPLACE FUNCTION set_company_plan(
  p_company_id TEXT,
  p_plan       TEXT,
  p_trial_days INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role    TEXT;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM "User" WHERE id = v_user_id::TEXT;
  IF v_role IS DISTINCT FROM 'SUPER' THEN
    RETURN jsonb_build_object('error', 'Acesso negado. Apenas SUPER pode alterar planos.');
  END IF;

  IF p_plan NOT IN ('STARTER', 'PRO', 'ENTERPRISE') THEN
    RETURN jsonb_build_object('error', 'Plano inválido. Use STARTER, PRO ou ENTERPRISE.');
  END IF;

  UPDATE "Company"
  SET
    "plan" = p_plan,
    "trialEndsAt" = CASE
      WHEN p_trial_days IS NOT NULL THEN NOW() + (p_trial_days || ' days')::INTERVAL
      ELSE "trialEndsAt"
    END,
    "updatedAt" = NOW()
  WHERE id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'plan', p_plan);
END;
$$;

GRANT EXECUTE ON FUNCTION set_company_plan(TEXT, TEXT, INT) TO authenticated;
