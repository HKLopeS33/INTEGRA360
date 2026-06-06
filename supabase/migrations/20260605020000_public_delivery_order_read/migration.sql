-- Permite que clientes anônimos leiam o status do próprio pedido pelo ID.
-- Usado pela tela de acompanhamento de pedido no link público de delivery.

CREATE POLICY "public_read_delivery_order_by_id"
  ON "DeliveryOrder" FOR SELECT
  TO anon
  USING (true);
