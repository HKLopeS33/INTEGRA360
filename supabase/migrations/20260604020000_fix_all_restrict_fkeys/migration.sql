-- Corrige todas as FKs com RESTRICT que bloqueavam o delete em cascata
-- ao excluir uma empresa. Referências a User viram SET NULL para preservar
-- histórico; referências entre tabelas filhas da empresa viram CASCADE.

-- Tab → RestaurantTable (CASCADE: mesa deletada = comanda deletada)
ALTER TABLE "Tab"
  DROP CONSTRAINT "Tab_tableId_fkey",
  ADD CONSTRAINT "Tab_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Tab → User (SET NULL: usuário deletado não apaga a comanda)
ALTER TABLE "Tab"
  DROP CONSTRAINT "Tab_openedById_fkey",
  ADD CONSTRAINT "Tab_openedById_fkey"
    FOREIGN KEY ("openedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Product → Category (CASCADE: categoria deletada = produto deletado)
ALTER TABLE "Product"
  DROP CONSTRAINT "Product_categoryId_fkey",
  ADD CONSTRAINT "Product_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Order → Tab (CASCADE: comanda deletada = pedido deletado)
ALTER TABLE "Order"
  DROP CONSTRAINT "Order_tabId_fkey",
  ADD CONSTRAINT "Order_tabId_fkey"
    FOREIGN KEY ("tabId") REFERENCES "Tab"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Order → User (SET NULL: usuário deletado não apaga o pedido)
ALTER TABLE "Order"
  DROP CONSTRAINT "Order_userId_fkey",
  ADD CONSTRAINT "Order_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- OrderItem → Order (CASCADE: pedido deletado = itens deletados)
ALTER TABLE "OrderItem"
  DROP CONSTRAINT "OrderItem_orderId_fkey",
  ADD CONSTRAINT "OrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- OrderItem → Product (CASCADE: productId é NOT NULL, item vai junto com o produto)
ALTER TABLE "OrderItem"
  DROP CONSTRAINT "OrderItem_productId_fkey",
  ADD CONSTRAINT "OrderItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CashRegister → User (SET NULL: usuário deletado não apaga o caixa)
ALTER TABLE "CashRegister"
  DROP CONSTRAINT "CashRegister_openedById_fkey",
  ADD CONSTRAINT "CashRegister_openedById_fkey"
    FOREIGN KEY ("openedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
