-- OrderItem.productId é NOT NULL, então SET NULL não funciona.
-- Muda para CASCADE: produto deletado = item deletado junto.

ALTER TABLE "OrderItem"
  DROP CONSTRAINT "OrderItem_productId_fkey",
  ADD CONSTRAINT "OrderItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
