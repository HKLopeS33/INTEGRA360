-- Adiciona ESTORNO_DELIVERY ao CHECK constraint de WalletTransaction.type.
-- O tipo já é usado pela Edge Function mercado-pago-refund ao cancelar pedidos
-- com estorno — sem esta alteração o INSERT na tabela seria rejeitado.

ALTER TABLE "WalletTransaction"
  DROP CONSTRAINT IF EXISTS "WalletTransaction_type_check";

ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT "WalletTransaction_type_check"
  CHECK ("type" IN (
    'CREDITO_DELIVERY',
    'CREDITO_MESA',
    'ESTORNO_DELIVERY',
    'SAQUE_SOLICITADO',
    'SAQUE_PAGO',
    'SAQUE_REJEITADO',
    'AJUSTE'
  ));
