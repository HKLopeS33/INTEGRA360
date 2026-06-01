-- Insert a default company and a SUPER administrator user
-- This migration is intended for Supabase remote DB only.

INSERT INTO "Company" ("id", "name", "cnpj", "email", "phone", "address", "city", "state", "country", "pixKey", "active", "createdAt", "updatedAt")
VALUES (
  'company_super_admin',
  'Empresa Super Admin',
  '00000000000191',
  'admin@shawarma.local',
  '(00) 00000-0000',
  'Rua Principal, 123',
  'Sao Paulo',
  'SP',
  'BR',
  NULL,
  true,
  NOW(),
  NOW()
);

INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "active", "mustChangePassword", "companyId", "createdAt", "updatedAt")
VALUES (
  'user_super_admin',
  'Super Administrador',
  'super@shawarma.local',
  'admin1',
  'SUPER',
  true,
  false,
  'company_super_admin',
  NOW(),
  NOW()
);
