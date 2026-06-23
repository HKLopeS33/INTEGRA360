-- 1) Corrige a policy de leitura do AdminSuper em Wallet/WalletTransaction/
--    WalletWithdrawal. `auth.jwt() ->> 'role'` é o role do POSTGRES da sessão
--    (sempre 'authenticated'), não o role da aplicação (SUPER/ADMIN/...) —
--    por isso o AdminSuper nunca conseguia ver as carteiras de outras
--    empresas (a tabela "Saldo por empresa" ficava sempre vazia). O role da
--    aplicação mora na tabela "User", igual já é resolvido em todas as
--    funções SECURITY DEFINER deste sistema (ex.: set_company_delivery_fee).

DROP POLICY IF EXISTS "wallet_read" ON "Wallet";
CREATE POLICY "wallet_read"
  ON "Wallet" FOR SELECT
  TO authenticated
  USING (
    "companyId" = (SELECT "companyId" FROM "User" WHERE id = auth.uid()::text)
    OR (SELECT role FROM "User" WHERE id = auth.uid()::text) = 'SUPER'
  );

DROP POLICY IF EXISTS "wallet_tx_read" ON "WalletTransaction";
CREATE POLICY "wallet_tx_read"
  ON "WalletTransaction" FOR SELECT
  TO authenticated
  USING (
    "companyId" = (SELECT "companyId" FROM "User" WHERE id = auth.uid()::text)
    OR (SELECT role FROM "User" WHERE id = auth.uid()::text) = 'SUPER'
  );

DROP POLICY IF EXISTS "wallet_withdrawal_read" ON "WalletWithdrawal";
CREATE POLICY "wallet_withdrawal_read"
  ON "WalletWithdrawal" FOR SELECT
  TO authenticated
  USING (
    "companyId" = (SELECT "companyId" FROM "User" WHERE id = auth.uid()::text)
    OR (SELECT role FROM "User" WHERE id = auth.uid()::text) = 'SUPER'
  );

-- 2) "deliveryFeePercent" passa a ser a taxa única da plataforma, descontada
--    de TODO pagamento processado pelo Mercado Pago (delivery por cartão ou
--    Pix, e também Pix de mesa/comanda — que antes não tinha comissão
--    nenhuma). Mantemos o nome da coluna/RPC para não quebrar nada que já
--    referencia "deliveryFeePercent"/"set_company_delivery_fee"; só o
--    significado de uso passa a ser mais amplo (refletido nos rótulos da
--    interface, não no banco).
