import { z } from "zod";
import { api, fail, requirePerm } from "@/lib/api/handler";
import { requestConfigChange } from "@/lib/api/config-request";
import { KeyMissingError, encryptSecret, keyringFromEnv } from "@/lib/integrations/crypto";
import { forgetRuntime } from "@/lib/integrations/runtime";
import { randomUUID } from "node:crypto";
import { assertPublicHost, assertPublicUrl, UnsafeAddressError } from "@/lib/integrations/ssrf";
import { checkSettings, withDefaults, type IntegrationKind } from "@/lib/integrations/types";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Ask for an integration to be added, changed, switched on or off, or removed (ADR-076). The change is a request that a Super Admin approves (the topic is
 * protected). Secrets arrive in plain text over HTTPS, are encrypted here, and only the ciphertext is stored in the request: the approver sees "changed",
 * never the value, and neither the request nor the audit log can reveal it.
 */
const body = z.object({
  action: z.enum(["CREATE", "UPDATE", "DELETE"]),
  id: z.string().uuid().optional(),
  kind: z.string().trim().max(40).optional(),
  name: z.string().trim().max(100).optional(),
  enabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string().max(40), z.string().max(2000).nullable()).optional(),
  reason: z.string().trim().min(1).max(2000),
  applyNow: z.boolean().optional(),
});

interface SavedIntegration { id: string; kind: string; name: string; enabled: boolean; settings: Record<string, unknown>; secrets: Record<string, string> }
const unprocessable = (message: string, details?: unknown) => fail("VALIDATION_ERROR", 422, message, details);

export const POST = api({ stepUp: true, body }, async (ctx) => {
  const { actor, body: b } = ctx;
  requirePerm(actor, "integrations.configure");
  // A Super Admin who is the only approver can apply the change at once: no second approver, a fresh authenticator code, a written reason, and the
  // emergency record that alerts the other administrators. The database checks the permission (config.emergency); this is the same path as Approvals.
  const send = async (topic: string, target: string | null, proposed: Record<string, unknown>) => {
    if (!b.applyNow) return requestConfigChange(ctx, topic, target, proposed, b.reason);
    if (b.reason.length < 10) throw unprocessable("Give a reason of at least 10 characters to apply a change without a second approver.");
    const out = await ctx.rpc("emergency_config_change", { p_actor: actor.id, p_topic: topic, p_target: target, p_proposed: proposed, p_reason: b.reason, p_idempotency_key: randomUUID() });
    forgetRuntime();
    return out;
  };
  const sb = adminClient();

  let kindCode = b.kind;
  let existing: SavedIntegration | null = null as SavedIntegration | null;
  if (b.action !== "CREATE") {
    if (!b.id) throw unprocessable("Choose the integration.");
    const { data } = await sb.rpc("ops_integration_get", { p_id: b.id });
    existing = (data as SavedIntegration | null) ?? null;
    if (!existing) throw fail("NOT_FOUND", 404, "That integration does not exist.");
    kindCode = existing.kind;
  }

  if (b.action === "DELETE") {
    return send("INTEGRATION", b.id!, { action: "DELETE" });
  }

  const { data: kindRow } = await sb.from("integration_kinds").select("code, slot, label, description, setting_fields, secret_fields").eq("code", kindCode ?? "").maybeSingle();
  const kind = kindRow as IntegrationKind | null;
  if (!kind) throw unprocessable("Choose a kind of integration.");

  const name = (b.name ?? existing?.name ?? "").trim();
  if (!name) throw unprocessable("Give the integration a name.");
  const settings = withDefaults(kind, b.settings ?? {});
  const problems = checkSettings(kind, settings);

  const secretKeys = new Set(kind.secret_fields.map((f) => f.key));
  const secrets = b.secrets ?? {};
  for (const k of Object.keys(secrets)) if (!secretKeys.has(k)) problems.push(`Unknown secret: ${k}`);
  for (const f of kind.secret_fields) {
    const given = secrets[f.key];
    const alreadySet = !!existing?.secrets[f.key];
    if (f.required && (given === undefined ? !alreadySet : given === null || given.trim() === "")) problems.push(`${f.label} is required.`);
  }
  if (problems.length) throw unprocessable(problems[0], problems);

  // where the server will connect to must be a public address (see ssrf.ts)
  try {
    for (const f of kind.setting_fields) {
      const v = settings[f.key];
      // only addresses the server CONNECTS to are checked; the email kind's address of this application is just text for a link
      if (f.type === "url" && typeof v === "string" && v && kind.code !== "SMTP") await assertPublicUrl(v);
    }
    if (kind.code === "SMTP") await assertPublicHost(String(settings.host));
  } catch (e) {
    if (e instanceof UnsafeAddressError) throw unprocessable(e.message);
    throw e;
  }

  const encrypted: Record<string, string | null> = {};
  const toEncrypt = Object.entries(secrets).filter(([, v]) => typeof v === "string" && v.trim() !== "") as [string, string][];
  if (toEncrypt.length) {
    try {
      const ring = keyringFromEnv();
      for (const [k, v] of toEncrypt) encrypted[k] = encryptSecret(v, k, ring);
    } catch (e) {
      if (e instanceof KeyMissingError) throw fail("INTEGRATIONS_KEY_MISSING", 503, "This server has no encryption key for secrets (INTEGRATIONS_ENCRYPTION_KEY), so passwords and API keys cannot be stored. Ask the person who runs the server to set it.");
      throw e;
    }
  }
  for (const [k, v] of Object.entries(secrets)) if (v === null) encrypted[k] = null;               // null removes a secret

  const proposed = { action: b.action, kind: kind.code, name, enabled: b.enabled ?? existing?.enabled ?? false, settings, secrets: encrypted };
  const target = b.action === "CREATE" ? `${kind.code}:${name.toLowerCase()}` : b.id!;
  return send("INTEGRATION", target, proposed);
});
