-- Add DEFAULT gen_random_uuid()::text to all id columns so inserts without explicit id never fail

ALTER TABLE "Company"         ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Subscription"    ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "PaymentRecord"   ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "User"            ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "RestaurantTable" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Tab"             ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Category"        ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Product"         ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Order"           ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "OrderItem"       ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "CashRegister"    ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Payment"         ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "SyncEvent"       ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "AuditLog"        ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
