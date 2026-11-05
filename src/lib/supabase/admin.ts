import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. Server-only: it bypasses RLS and is the only principal allowed to
 * execute mutation RPCs (ADR-035). The verified actor id is always passed explicitly.
 */
export function adminClient(correlationId?: string, extraHeaders?: Record<string, string>): SupabaseClient {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { ...(correlationId ? { "x-correlation-id": correlationId } : {}), ...(extraHeaders ?? {}) } },
  });
}
