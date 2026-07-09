-- Adiciona TRIAL como plano válido na RPC set_company_plan
CREATE OR REPLACE FUNCTION set_company_plan(
  p_company_id       TEXT,
  p_plan             TEXT,
  p_trial_days       INT     DEFAULT NULL,
  p_monthly_price    NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role    TEXT;
  v_price   NUMERIC;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM "User" WHERE id = v_user_id::TEXT;
  IF v_role IS DISTINCT FROM 'SUPER' THEN
    RETURN jsonb_build_object('error', 'Acesso negado. Apenas SUPER pode alterar planos.');
  END IF;

  IF p_plan NOT IN ('STARTER', 'TRIAL', 'PRO', 'ENTERPRISE') THEN
    RETURN jsonb_build_object('error', 'Plano inválido. Use STARTER, TRIAL, PRO ou ENTERPRISE.');
  END IF;

  v_price := CASE
    WHEN p_monthly_price IS NOT NULL THEN p_monthly_price
    WHEN p_plan = 'STARTER' THEN 79.00
    WHEN p_plan = 'PRO'     THEN 149.00
    ELSE 0.00
  END;

  UPDATE "Company"
  SET
    "plan"             = p_plan,
    "planMonthlyPrice" = v_price,
    "trialEndsAt"      = CASE
      WHEN p_trial_days IS NOT NULL THEN NOW() + (p_trial_days || ' days')::INTERVAL
      ELSE "trialEndsAt"
    END,
    "updatedAt" = NOW()
  WHERE id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'plan', p_plan, 'planMonthlyPrice', v_price);
END;
$$;

GRANT EXECUTE ON FUNCTION set_company_plan(TEXT, TEXT, INT, NUMERIC) TO authenticated;
