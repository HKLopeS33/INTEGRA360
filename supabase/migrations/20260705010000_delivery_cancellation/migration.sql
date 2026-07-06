-- Campos para rastreamento do fluxo de cancelamento/estorno de pedidos delivery.
-- O cancelamento nunca é automático — o estabelecimento sempre precisa aprovar.

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "cancellationReason"      TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationRequestedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "refundMpId"              TEXT;

-- 'ESTORNADO' como valor válido de paymentStatus (já existem PAGO e PENDENTE).
-- Não há CHECK CONSTRAINT no schema atual; este comentário documenta os valores.
-- paymentStatus: PENDENTE | PAGO | ESTORNADO
-- status:        AGUARDANDO_PAGAMENTO | RECEBIDO | EM_PREPARO | SAIU_PARA_ENTREGA | ENTREGUE | CANCELADO

-- RPC para o cliente solicitar cancelamento (sem autenticação — apenas anon).
-- Só aceita pedidos com status diferente de CANCELADO e que ainda não tenham
-- uma solicitação pendente (cancellationRequestedAt IS NULL).
CREATE OR REPLACE FUNCTION request_delivery_cancellation(
  p_order_id TEXT,
  p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT id, status, "cancellationRequestedAt"
    INTO v_order
    FROM "DeliveryOrder"
   WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado.');
  END IF;

  IF v_order.status = 'CANCELADO' THEN
    RETURN jsonb_build_object('error', 'Pedido já foi cancelado.');
  END IF;

  IF v_order."cancellationRequestedAt" IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Já existe uma solicitação de cancelamento para este pedido.');
  END IF;

  UPDATE "DeliveryOrder"
     SET "cancellationReason"      = p_reason,
         "cancellationRequestedAt" = NOW()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION request_delivery_cancellation(TEXT, TEXT) TO anon, authenticated;
