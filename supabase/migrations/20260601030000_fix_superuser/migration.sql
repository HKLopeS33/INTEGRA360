-- Remove the old super user row that had a fake/hardcoded ID.
-- The real SUPER user is created via Supabase Auth (email: super@sistema.local)
-- and a matching User row is created automatically on first login.
-- This migration just cleans up the stale seed data.

DELETE FROM "User"    WHERE "id" = 'user_super_admin';
DELETE FROM "Company" WHERE "id" = 'company_super_admin';
