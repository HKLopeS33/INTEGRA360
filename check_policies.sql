SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('Company','Category','Product','DeliveryOrder','DeliveryOrderItem')
ORDER BY tablename, policyname;
