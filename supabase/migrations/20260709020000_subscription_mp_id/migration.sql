-- Adiciona coluna para rastrear o ID de assinatura recorrente do Mercado Pago
ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "mpSubscriptionId" TEXT;

CREATE INDEX IF NOT EXISTS subscription_mp_id_idx ON "Subscription" ("mpSubscriptionId")
  WHERE "mpSubscriptionId" IS NOT NULL;
