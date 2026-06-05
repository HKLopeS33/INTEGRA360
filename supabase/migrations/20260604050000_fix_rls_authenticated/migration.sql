-- A migration anterior habilitou RLS em Company, Category e Product
-- mas não criou políticas para usuários autenticados, bloqueando o acesso.
-- Esta migration restaura o acesso completo para authenticated.

-- Company: autenticados vêem tudo (controle de acesso é feito na aplicação)
CREATE POLICY "authenticated_full_company"
  ON "Company" FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Category: autenticados vêem tudo
CREATE POLICY "authenticated_full_category"
  ON "Category" FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Product: autenticados vêem tudo
CREATE POLICY "authenticated_full_product"
  ON "Product" FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
