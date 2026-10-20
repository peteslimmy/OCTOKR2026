#!/usr/bin/env bash
# Writes .env.local for CI from the local Supabase stack that this job just started. Throwaway keys of a throwaway stack: nothing secret.
set -euo pipefail
npx supabase status -o env > /tmp/supabase.env
val() { grep "^$1=" /tmp/supabase.env | cut -d= -f2- | tr -d '"'; }
{
  echo "NEXT_PUBLIC_SUPABASE_URL=$(val API_URL)"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(val ANON_KEY)"
  echo "SUPABASE_SERVICE_ROLE_KEY=$(val SERVICE_ROLE_KEY)"
  echo "JOBS_SECRET=ci-only-jobs-secret-value"
  echo "INTEGRATIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)"
  echo "DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  # development mail goes to files so the email tests can read it; no provider is needed in CI
  echo "EMAIL_TRANSPORT=file"
  echo "EMAIL_FILE_DIR=.dev-mail"
  echo "APP_BASE_URL=http://localhost:3000"
} > "${CI_ENV_FILE:-.env.local}"
