-- Payment estava com RESTRICT nas FKs de Tab e CashRegister,
-- bloqueando o delete em cascata ao excluir uma empresa.

ALTER TABLE "Payment"
  DROP CONSTRAINT "Payment_tabId_fkey",
  ADD CONSTRAINT "Payment_tabId_fkey"
    FOREIGN KEY ("tabId") REFERENCES "Tab"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
  DROP CONSTRAINT "Payment_cashRegisterId_fkey",
  ADD CONSTRAINT "Payment_cashRegisterId_fkey"
    FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
