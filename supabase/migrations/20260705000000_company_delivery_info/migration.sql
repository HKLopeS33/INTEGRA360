-- Taxa de entrega e horário de funcionamento por empresa.
-- Exibidos no cardápio online público para o cliente antes de montar o carrinho.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "deliveryFeeAmount" NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openingTime"       TEXT          NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS "closingTime"        TEXT          NOT NULL DEFAULT '00:00';
