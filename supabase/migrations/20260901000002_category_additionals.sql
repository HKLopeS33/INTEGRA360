-- Adiciona campo de itens adicionais por categoria (JSONB)
-- Formato: [{ "name": "Milho", "price": 0 }, { "name": "Queijo Extra", "price": 2.50 }]
-- price: 0 = gratuito/incluso
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "additionals" JSONB;
