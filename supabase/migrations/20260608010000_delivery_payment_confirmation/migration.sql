-- Online-payment confirmation gate for public delivery orders.
--
-- When a customer pays via Mercado Pago Pix on the public delivery link, the
-- order must NOT reach the company (kitchen/delivery queue) until the payment
-- is actually approved. We do this with a "AGUARDANDO_PAGAMENTO" status that
-- is excluded from company-facing listings; the webhook promotes the order to
-- "RECEBIDO" (and paymentStatus to 'PAGO') only on approval.

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "paymentStatus" text NOT NULL DEFAULT 'PAGO';

-- Existing/offline payment methods (cash, card-on-delivery, static Pix) are
-- considered confirmed immediately — only online MP charges start as PENDENTE.
ALTER TABLE "DeliveryOrder"
  ADD CONSTRAINT "DeliveryOrder_paymentStatus_check"
  CHECK ("paymentStatus" IN ('PENDENTE', 'PAGO'));

CREATE INDEX IF NOT EXISTS "DeliveryOrder_paymentStatus_idx" ON "DeliveryOrder"("paymentStatus");

-- Allow the public (anon) flow to read its own pending order to poll payment
-- status — already covered by existing "public_read_delivery_order_by_id"
-- policy from migration 20260605020000 (selects by id), no change needed there.
