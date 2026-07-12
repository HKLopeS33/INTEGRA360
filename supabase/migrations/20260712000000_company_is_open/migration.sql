-- Adiciona flag manual de aberto/fechado para o estabelecimento
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT TRUE;
