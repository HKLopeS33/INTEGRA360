-- Adiciona flag para indicar se o produto precisa ir para a cozinha (preparo)
-- Ex: refrigerantes, águas = false; pastéis, salgados = true (padrão)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "requiresKitchen" BOOLEAN NOT NULL DEFAULT true;
