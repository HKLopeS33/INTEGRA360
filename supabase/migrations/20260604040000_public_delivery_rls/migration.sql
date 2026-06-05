-- Permite acesso público (anon) para a página de delivery do cliente.
-- Leitura do nome da empresa, cardápio e inserção de pedidos sem autenticação.

-- Habilita RLS nas tabelas (se ainda não estiver habilitado)
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOrderItem" ENABLE ROW LEVEL SECURITY;

-- Leitura pública do nome e logo da empresa (pelo companyId)
CREATE POLICY "public_read_company_name"
  ON "Company" FOR SELECT
  TO anon
  USING (active = true);

-- Leitura pública das categorias ativas
CREATE POLICY "public_read_categories"
  ON "Category" FOR SELECT
  TO anon
  USING (active = true);

-- Leitura pública dos produtos disponíveis
CREATE POLICY "public_read_products"
  ON "Product" FOR SELECT
  TO anon
  USING (active = true AND available = true);

-- Inserção pública de pedidos de delivery
CREATE POLICY "public_insert_delivery_order"
  ON "DeliveryOrder" FOR INSERT
  TO anon
  WITH CHECK (true);

-- Inserção pública dos itens do pedido
CREATE POLICY "public_insert_delivery_order_item"
  ON "DeliveryOrderItem" FOR INSERT
  TO anon
  WITH CHECK (true);
