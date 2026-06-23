-- Permite que o estabelecimento desative completamente a impressão
-- (cozinha e caixa) quando não tiver impressora térmica ou não quiser imprimir.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "printingDisabled" BOOLEAN NOT NULL DEFAULT false;
