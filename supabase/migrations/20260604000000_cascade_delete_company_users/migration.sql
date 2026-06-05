-- Ao excluir uma empresa, seus usuários também devem ser removidos.
-- Altera a FK de SET NULL para CASCADE.

ALTER TABLE "User"
  DROP CONSTRAINT "User_companyId_fkey",
  ADD CONSTRAINT "User_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
