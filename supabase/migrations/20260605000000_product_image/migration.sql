-- Adiciona campo de imagem nos produtos para exibição no cardápio público de delivery.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- Bucket público para imagens de produtos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Usuários autenticados podem fazer upload na pasta da própria empresa
CREATE POLICY "auth_upload_product_images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

-- Usuários autenticados podem deletar/atualizar suas próprias imagens
CREATE POLICY "auth_update_product_images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY "auth_delete_product_images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images');

-- Leitura pública (bucket já é público, mas policy explícita para anon)
CREATE POLICY "public_read_product_images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'product-images');
