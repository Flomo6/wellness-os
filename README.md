# Wellness OS (Cursor build)
Monorepo: apps/api (Node/TS), apps/web (React), packages/shared (types).
Use pnpm.

### Run
- Start Postgres (or connect to Supabase DATABASE_URL)
- Apply migrations (use your preferred tool or Supabase SQL)
- Copy apps/api/.env.example to apps/api/.env and set DATABASE_URL
- pnpm --filter @wellness/api dev
