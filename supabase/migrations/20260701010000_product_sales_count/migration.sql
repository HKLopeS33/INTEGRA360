-- Contador de vendas por produto — usado para montar a seção "Mais pedidos"
-- no cardápio online. Incrementado automaticamente via trigger sempre que
-- um item é inserido em DeliveryOrderItem.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "salesCount" INTEGER NOT NULL DEFAULT 0;

-- Trigger que incrementa salesCount a cada item de pedido inserido.
-- SECURITY DEFINER não é necessário pois a função é chamada pelo próprio
-- mecanismo de trigger (contexto service-role), nunca pelo cliente.
CREATE OR REPLACE FUNCTION increment_product_sales_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Product"
  SET "salesCount" = "salesCount" + NEW.quantity
  WHERE id = NEW."productId";
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_increment_product_sales ON "DeliveryOrderItem";
CREATE TRIGGER trg_increment_product_sales
  AFTER INSERT ON "DeliveryOrderItem"
  FOR EACH ROW
  EXECUTE FUNCTION increment_product_sales_count();
