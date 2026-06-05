-- Foto por categoria e banner do cardápio público.

ALTER TABLE "Category"
  ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "menuBannerUrl" TEXT;
