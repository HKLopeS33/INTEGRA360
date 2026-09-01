-- Adiciona suporte a produtos personalizáveis (ex: "Monte o Seu")
-- customOptions é um JSON com: label, maxSelections, options[]
-- Exemplo: {"label":"Escolha os sabores","maxSelections":4,"options":["Frango","Queijo","Calabresa"]}

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "customOptions" JSONB;
