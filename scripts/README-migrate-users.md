Migration helper: migrate users from Prisma DB to Supabase Auth

Usage:

1. Set environment variables (example):

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
```

2. Dry-run to see actions (no changes):

```bash
node scripts/migrate-users-to-supabase.mjs
```

3. Apply migration (creates users in Supabase):

```bash
node scripts/migrate-users-to-supabase.mjs --apply
```

The script writes `users-migration-result.json` with the outcome per user.

Notes:
- Created users receive a generated password. Consider sending password-reset emails or forcing change on first login.
- Script uses Supabase Admin REST endpoints; requires `SERVICE_ROLE` key.
