import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { auditHeaders } from "@/lib/audit/context";
import { requestAudit } from "@/lib/audit/request-context";

/**
 * Service-role client. Server-only: it bypasses RLS and is the only principal allowed to
 * execute mutation RPCs (ADR-035). The verified actor id is always passed explicitly.
 */
export function adminClient(correlationId?: string, extraHeaders?: Record<string, string>): SupabaseClient {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // inside a request, every audited write carries the request's address, location and user agent unless the caller passes its own headers
    global: { headers: { ...(correlationId ? { "x-correlation-id": correlationId } : {}), ...(extraHeaders ?? auditHeaders(requestAudit.getStore())) } },
  });
}
