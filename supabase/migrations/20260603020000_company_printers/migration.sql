-- Salva o nome das impressoras configuradas por empresa no banco,
-- para persistir após reinstalação do app.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "kitchenPrinter" TEXT,
  ADD COLUMN IF NOT EXISTS "cashierPrinter" TEXT;
