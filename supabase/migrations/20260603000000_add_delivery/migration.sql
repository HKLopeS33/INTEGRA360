-- Tabela de pedidos de delivery
CREATE TABLE "DeliveryOrder" (
    "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "companyId"       TEXT NOT NULL,
    "customerName"    TEXT NOT NULL,
    "customerPhone"   TEXT,
    "customerAddress" TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'RECEBIDO',
    "paymentMethod"   TEXT NOT NULL DEFAULT 'DINHEIRO',
    "deliveryFee"     DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total"           DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes"           TEXT,
    "receiptNumber"   INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"        TIMESTAMP(3),
    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeliveryOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
);

-- Itens do pedido de delivery
CREATE TABLE "DeliveryOrderItem" (
    "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "deliveryOrderId" TEXT NOT NULL,
    "productId"       TEXT,
    "productName"     TEXT NOT NULL,
    "quantity"        INTEGER NOT NULL DEFAULT 1,
    "unitPrice"       DECIMAL(10,2) NOT NULL,
    "note"            TEXT,
    CONSTRAINT "DeliveryOrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeliveryOrderItem_orderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE
);

-- Índices
CREATE INDEX "DeliveryOrder_companyId_status_idx" ON "DeliveryOrder"("companyId", "status");
CREATE INDEX "DeliveryOrderItem_orderId_idx" ON "DeliveryOrderItem"("deliveryOrderId");

-- RLS
ALTER TABLE "DeliveryOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOrderItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "DeliveryOrder company access" ON "DeliveryOrder"
    USING (auth.jwt() ->> 'role' = 'SUPER' OR "companyId" = (auth.jwt() -> 'user_metadata' ->> 'companyId'));

CREATE POLICY "DeliveryOrderItem access" ON "DeliveryOrderItem"
    USING (EXISTS (
        SELECT 1 FROM "DeliveryOrder" d
        WHERE d.id = "DeliveryOrderItem"."deliveryOrderId"
        AND (auth.jwt() ->> 'role' = 'SUPER' OR d."companyId" = (auth.jwt() -> 'user_metadata' ->> 'companyId'))
    ));
