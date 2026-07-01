-- Contador de acessos ao cardápio online por estabelecimento.
-- Incrementado anonimamente toda vez que alguém abre o link público do cardápio.

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "menuOpenCount" INTEGER NOT NULL DEFAULT 0;

-- RPC acessível por anônimos (não requer autenticação) para registrar a abertura
-- do cardápio. SECURITY DEFINER + search_path fixo garantem que não há escalada
-- de privilégios — a função só incrementa o contador da empresa informada.
CREATE OR REPLACE FUNCTION increment_menu_open_count(p_company_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE "Company"
  SET "menuOpenCount" = "menuOpenCount" + 1
  WHERE id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_menu_open_count(TEXT) TO anon, authenticated;
