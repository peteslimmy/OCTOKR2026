import { z } from "zod";
import { api, fail, requirePerm } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { testAnthropic, testOpenAiCompatible, testSmtp, testWebhook, type SmtpSettings } from "@/lib/integrations/adapters";
import { DecryptError, decryptSecret } from "@/lib/integrations/crypto";
import { checkSettings, withDefaults, type IntegrationKind, type TestResult } from "@/lib/integrations/types";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Try an integration without saving it, or the saved one (ADR-076). Values typed in the form are used as typed; a secret left empty falls back to the saved
 * one of the integration named by `id`. A test only ever sends harmless fixed content: a message to the person who asks, a fixed sentence to an AI provider,
 * a TEST_PING event to a webhook. The outcome of a test of a saved integration is stored and audited.
 */
interface SavedIntegration { id: string; kind: string; settings: Record<string, unknown>; secrets: Record<string, string> }
const body = z.object({
  id: z.string().uuid().optional(),
  kind: z.string().trim().max(40).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string().max(40), z.string().max(2000)).optional(),
  sendMail: z.boolean().optional(),
});

export const POST = api({ stepUp: true, body }, async ({ actor, body: b, rpc }): Promise<TestResult> => {
  requirePerm(actor, "integrations.test");
  if (await rateLimited(`integration-test:${actor.id}`, 10, 60_000)) throw fail("RATE_LIMITED", 429, "Too many tests. Please wait a minute.");
  const sb = adminClient();

  let saved: SavedIntegration | null = null as SavedIntegration | null;
  if (b.id) {
    const { data } = await sb.rpc("ops_integration_get", { p_id: b.id });
    saved = (data as SavedIntegration | null) ?? null;
    if (!saved) throw fail("NOT_FOUND", 404, "That integration does not exist.");
  }
  const kindCode = saved?.kind ?? b.kind;
  const { data: kindRow } = await sb.from("integration_kinds").select("code, slot, label, description, setting_fields, secret_fields").eq("code", kindCode ?? "").maybeSingle();
  const kind = kindRow as IntegrationKind | null;
  if (!kind) throw fail("VALIDATION_ERROR", 422, "Choose a kind of integration.");

  const settings = withDefaults(kind, b.settings ?? saved?.settings ?? {});
  const problems = checkSettings(kind, settings);
  if (problems.length) return { ok: false, message: problems[0] };

  // the secret to use: what was typed, otherwise the saved one
  const secret = async (field: string): Promise<string | undefined> => {
    const typed = b.secrets?.[field];
    if (typed && typed.trim()) return typed;
    const stored = saved?.secrets[field];
    if (!stored) return undefined;
    try { return decryptSecret(stored, field); }
    catch (e) { if (e instanceof DecryptError) throw fail("INTEGRATIONS_KEY_MISSING", 409, e.message); throw fail("INTEGRATIONS_KEY_MISSING", 503, "This server has no encryption key for the saved secrets, so the saved connection cannot be tested. Type the secret again, or ask the person who runs the server to set INTEGRATIONS_ENCRYPTION_KEY."); }
  };

  let result: TestResult;
  switch (kind.code) {
    case "SMTP": result = await testSmtp(settings as unknown as SmtpSettings, await secret("password"), b.sendMail === false ? null : actor.email); break;
    case "ANTHROPIC": result = await testAnthropic(settings as { model: string; baseUrl?: string }, (await secret("apiKey")) ?? ""); break;
    case "OPENAI_COMPATIBLE": result = await testOpenAiCompatible(settings as { model: string; baseUrl: string }, await secret("apiKey")); break;
    case "WEBHOOK": result = await testWebhook(settings as { url: string; format?: "JSON" | "TEXT" }, await secret("signingSecret")); break;
    default: throw fail("VALIDATION_ERROR", 422, "This kind of integration cannot be tested yet.");
  }
  if (b.id) await rpc("ops_integration_record_test", { p_actor: actor.id, p_id: b.id, p_ok: result.ok, p_message: result.message });
  return result;
});
