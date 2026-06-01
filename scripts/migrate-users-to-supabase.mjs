#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
const fetchImpl = (typeof globalThis.fetch === 'function') ? globalThis.fetch.bind(globalThis) : undefined;
if (!fetchImpl) {
  console.error('global fetch is not available in this Node runtime. Install node-fetch or run with Node >=18.');
  process.exit(1);
}
const fetch = fetchImpl;

// This script migrates users from the local Prisma DB to Supabase Auth
// Usage:
//  - Dry run (default): node scripts/migrate-users-to-supabase.mjs
//  - Apply: node scripts/migrate-users-to-supabase.mjs --apply
// Requirements: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

async function getSupabaseUserByEmail(email) {
  // Use the Supabase Auth admin endpoint to search by email
  const url = `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (res.status === 200) {
    const data = await res.json();
    // admin returns { users: [...] } or an array depending on version — normalize
    if (Array.isArray(data)) return data[0] ?? null;
    if (data && Array.isArray(data.users)) return data.users[0] ?? null;
    return null;
  }
  const txt = await res.text();
  throw new Error(`Supabase admin GET user failed: ${res.status} ${txt}`);
}

async function createSupabaseUser({ email, name, password, metadata }) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users`;
  const body = {
    email,
    password,
    user_metadata: metadata,
    email_confirm: true
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Create user failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function updateSupabaseUser(id, { password, metadata }) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`;
  const body = {
    password,
    user_metadata: metadata
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Update user failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

function pickUserFields(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    companyId: u.companyId,
    mustChangePassword: u.mustChangePassword ?? false,
    passwordHash: u.passwordHash
  };
}

async function run() {
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Dry run: ${!APPLY}`);

  const users = await prisma.user.findMany({
    where: {},
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      companyId: true,
      mustChangePassword: true,
      passwordHash: true,
      active: true
    }
  });

  const result = [];

  for (const u of users) {
    const picked = pickUserFields(u);
    // skip inactive users
    if (!u.active) {
      console.log(`Skipping inactive user ${u.email}`);
      continue;
    }

    console.log(`Processing ${u.email} (${u.id})`);
    let existing = null;
    try {
      existing = await getSupabaseUserByEmail(u.email);
    } catch (err) {
      console.warn('Could not query Supabase for existing user:', err.message);
    }

    const metadata = { role: u.role, companyId: u.companyId };

    if (!APPLY) {
      // dry-run: just show what would be done
      console.log(`  -> would create user with metadata: ${JSON.stringify(metadata)}`);
      result.push({ localId: u.id, email: u.email, action: 'dry-run-create', metadata });
      continue;
    }

    const password = u.passwordHash || `${Math.random().toString(36).slice(2, 12)}A1!`;

    if (existing) {
      console.log(`  -> exists in Supabase as ${existing.id}`);
      if (password) {
        try {
          await updateSupabaseUser(existing.id, { password, metadata });
          console.log(`  -> updated existing Supabase user password and metadata for ${u.email}`);
          result.push({ localId: u.id, email: u.email, supabaseId: existing.id, action: 'updated' });
          continue;
        } catch (err) {
          console.error(`  -> failed to update existing user ${u.email}:`, err.message);
          result.push({ localId: u.id, email: u.email, supabaseId: existing.id, action: 'error', error: err.message });
          continue;
        }
      }
      result.push({ localId: u.id, email: u.email, supabaseId: existing.id, action: 'exists' });
      continue;
    }

    try {
      const created = await createSupabaseUser({ email: u.email, name: u.name, password, metadata });
      console.log(`  -> created supabase user ${created.id}`);
      result.push({ localId: u.id, email: u.email, supabaseId: created.id, action: 'created' });
    } catch (err) {
      console.error(`  -> failed to create ${u.email}:`, err.message);
      result.push({ localId: u.id, email: u.email, action: 'error', error: err.message });
    }
  }

  const outPath = './users-migration-result.json';
  await fs.writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`Wrote migration report to ${outPath}`);

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
