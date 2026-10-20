/**
 * Moves every saved integration secret to the current encryption key (ADR-076). Run it after changing INTEGRATIONS_ENCRYPTION_KEY, with the old key kept
 * in INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS so the existing secrets can still be read:
 *
 *   1. generate a new key and put the OLD one in INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS, the new one in INTEGRATIONS_ENCRYPTION_KEY
 *   2. restart the application (it can now read both), then:  OPERATOR="your name" npm run integrations:rewrap
 *   3. when it reports nothing left to do, remove INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS and restart
 *
 * Each secret is decrypted and encrypted again; nothing is printed. A secret that cannot be decrypted (its key is gone) is reported by integration and field and
 * left alone: type it in again under Administration → Integrations. Every change is written to the audit log (INTEGRATION_KEY_ROTATED).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { DecryptError, decryptSecret, encryptSecret, keyringFromEnv, needsRewrap } from "../src/lib/integrations/crypto";

config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
  const ring = keyringFromEnv();
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("ops_integration_secrets_all");
  if (error) { console.error(error.message); process.exit(1); }
  let moved = 0, current = 0, unreadable = 0;
  for (const row of (data as { id: string; secrets: Record<string, string> }[]) ?? []) {
    const next: Record<string, string> = {}; let changed = false;
    for (const [field, token] of Object.entries(row.secrets)) {
      if (!needsRewrap(token, ring)) { next[field] = token; current++; continue; }
      try { next[field] = encryptSecret(decryptSecret(token, field, ring), field, ring); changed = true; moved++; }
      catch (e) { next[field] = token; unreadable++; console.error(`Cannot read ${field} of integration ${row.id}: ${e instanceof DecryptError ? e.message : "unknown error"}`); }
    }
    if (changed) {
      const r = await sb.rpc("ops_integration_rewrap", { p_id: row.id, p_secrets: next, p_operator: process.env.OPERATOR ?? process.env.USERNAME ?? process.env.USER ?? "unknown" });
      if (r.error) { console.error(`Integration ${row.id} was not updated: ${r.error.message}`); process.exit(1); }
    }
  }
  console.log(`Re-encrypted ${moved} secret(s); ${current} were already on the current key; ${unreadable} could not be read.`);
  if (moved === 0 && unreadable === 0) console.log("Nothing left to do: INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS can be removed.");
  process.exit(unreadable ? 2 : 0);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
