import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { configuredTransport } from "@/lib/email/transport";
import type { Mail, Transport } from "@/lib/email/deliver";
import { smtpFrom, smtpTransportFor, type SmtpSettings } from "./adapters";
import { decryptSecret, keyringFromEnv, type Keyring } from "./crypto";

/**
 * What the application uses at run time (ADR-076). The enabled integration for a slot is read from the database (settings in the clear, secrets as ciphertext),
 * the secrets are decrypted here and nowhere else, and the result is kept for 30 seconds so a delivery run does not read the database for every message.
 * Email falls back to the server's EMAIL_* settings when no email integration is enabled, so an installation that already works keeps working.
 */
interface RuntimeRow { id: string; kind: string; name: string; version: number; settings: Record<string, unknown>; secrets: Record<string, string> }

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: RuntimeRow | null }>();

export async function loadRuntime(slot: "EMAIL" | "AI"): Promise<RuntimeRow | null> {
  const hit = cache.get(slot);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await adminClient().rpc("ops_integration_runtime", { p_slot: slot });
  if (error) throw new Error(`integrations unavailable: ${error.message}`);
  const value = (data as RuntimeRow | null) ?? null;
  cache.set(slot, { at: Date.now(), value });
  return value;
}
/** After a change is approved the next use must see it; the 30-second cache would otherwise delay it. */
export const forgetRuntime = () => cache.clear();

export function decryptFields(secrets: Record<string, string>, ring: Keyring = keyringFromEnv()): Record<string, string> {
  return Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, decryptSecret(v, k, ring)]));
}

export interface EmailRuntime { transport: Transport | null; appUrl?: string; source: "integration" | "environment" | "none"; name?: string }

/** The email transport in force: the enabled SMTP integration, else the server environment, else none (mail waits and expires). */
export async function resolveEmail(): Promise<EmailRuntime> {
  let row: RuntimeRow | null = null;
  try { row = await loadRuntime("EMAIL"); } catch (e) { console.error(e instanceof Error ? e.message : e); }
  if (row && row.kind === "SMTP") {
    try {
      const s = row.settings as unknown as SmtpSettings;
      const password = row.secrets.password ? decryptFields({ password: row.secrets.password }).password : undefined;
      const t = smtpTransportFor(s, password);
      const from = smtpFrom(s);
      const transport: Transport = { name: `smtp:${s.host}`, send: async (m: Mail) => { await t.sendMail({ from, to: m.to, subject: m.subject, text: m.text }); } };
      return { transport, appUrl: s.baseUrl, source: "integration", name: row.name };
    } catch (e) {
      console.error("the email integration cannot be used:", e instanceof Error ? e.message : e);
      return { transport: null, source: "integration", name: row.name };           // configured but unusable (for example its key is gone): mail waits, health shows it
    }
  }
  const env = configuredTransport();
  return { transport: env, appUrl: process.env.APP_BASE_URL, source: env ? "environment" : "none" };
}

export interface AiRuntime { kind: "ANTHROPIC" | "OPENAI_COMPATIBLE"; name: string; settings: Record<string, unknown>; apiKey?: string }
/**
 * The AI provider in force, with its key decrypted, for features that need one. NOTHING in the application calls this yet: no feature sends data to an AI
 * provider. It exists so that the first feature to do so uses the configured, approved connection rather than a key in a file, and so that it can
 * show a clear message when none is configured. Adding such a feature needs the owner's decision on what data may leave (data-protection review).
 */
export async function activeAi(): Promise<AiRuntime | null> {
  const row = await loadRuntime("AI");
  if (!row) return null;
  const secrets = decryptFields(row.secrets);
  return { kind: row.kind as AiRuntime["kind"], name: row.name, settings: row.settings, apiKey: secrets.apiKey };
}
