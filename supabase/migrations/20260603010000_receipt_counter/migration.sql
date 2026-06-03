-- Contador de recibo único por empresa, compartilhado entre Mesa e Delivery.
-- O UPDATE atômico garante que dois pedidos nunca recebam o mesmo número.

CREATE TABLE "ReceiptCounter" (
  "companyId" TEXT NOT NULL PRIMARY KEY,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ReceiptCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
);

-- Inicializa o contador com o maior número já existente (Tab e DeliveryOrder)
INSERT INTO "ReceiptCounter" ("companyId", "lastNumber")
SELECT
  c.id,
  COALESCE(
    GREATEST(
      (SELECT MAX("receiptNumber") FROM "Tab" t WHERE t."companyId" = c.id),
      (SELECT MAX("receiptNumber") FROM "DeliveryOrder" d WHERE d."companyId" = c.id)
    ), 0
  )
FROM "Company" c
ON CONFLICT ("companyId") DO NOTHING;

-- Função que incrementa atomicamente e retorna o próximo número
CREATE OR REPLACE FUNCTION next_receipt_number(p_company_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  -- Garante que o contador existe para esta empresa
  INSERT INTO "ReceiptCounter" ("companyId", "lastNumber")
  VALUES (p_company_id, 0)
  ON CONFLICT ("companyId") DO NOTHING;

  UPDATE "ReceiptCounter"
  SET "lastNumber" = "lastNumber" + 1
  WHERE "companyId" = p_company_id
  RETURNING "lastNumber" INTO v_next;

  RETURN v_next;
END;
$$;

-- RLS
ALTER TABLE "ReceiptCounter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ReceiptCounter company access" ON "ReceiptCounter"
  USING (auth.uid() IS NOT NULL);
