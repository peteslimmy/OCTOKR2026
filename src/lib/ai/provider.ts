import "server-only";
import { activeAi } from "@/lib/integrations/runtime";
import { adminClient } from "@/lib/supabase/admin";
import { callProvider, costUsd, ProviderFailure, type ProviderMessage, type ProviderReply } from "./provider-call";

/**
 * The one door through which 4COREPAL talks to an AI provider. It checks that the module is on and a provider is configured, that the day's spend and the
 * person's hourly allowance have room, makes the call, and records every attempt (tokens, cost, outcome) whatever happens.
 *
 * It never throws: a provider outage, a timeout or a budget stop comes back as { ok: false, reason, message }, so no page of the existing OKR application
 * can be broken by it. Anything that needs the model (the assistant, the closure wording, the report commentary) goes through here and only here.
 */
export interface AiRequest { purpose: string; system: string; messages: ProviderMessage[]; maxTokens?: number; userId?: string | null; conversationId?: string | null }
export type AiFailureReason = "DISABLED" | "NOT_CONFIGURED" | "BUDGET" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER_ERROR";
export type AiResult =
  | ({ ok: true; costUsd: number } & ProviderReply)
  | { ok: false; reason: AiFailureReason; message: string };

interface UsageStatus { enabled: boolean; todayUsd: number; ceilingUsd: number; userCallsHour: number; userLimitHour: number; timeoutSeconds: number; maxRetries: number; inputPrice: number; outputPrice: number }

const MESSAGES: Record<AiFailureReason, string> = {
  DISABLED: "The AI Performance Agent is not switched on.",
  NOT_CONFIGURED: "No AI provider is configured. An administrator can add one under Integrations.",
  BUDGET: "The daily AI spending limit has been reached. It resets tomorrow, or an administrator can raise it.",
  RATE_LIMIT: "You have reached the hourly limit of questions. Please try again later.",
  TIMEOUT: "The AI provider did not answer in time.",
  PROVIDER_ERROR: "The AI provider could not answer.",
};

export async function aiStatus(userId: string | null): Promise<UsageStatus> {
  const { data, error } = await adminClient().rpc("ai_usage_status", { p_user: userId });
  if (error) throw new Error("ai_usage_status failed");
  return data as UsageStatus;
}

export async function complete(req: AiRequest): Promise<AiResult> {
  let status: UsageStatus;
  try { status = await aiStatus(req.userId ?? null); } catch { return { ok: false, reason: "PROVIDER_ERROR", message: MESSAGES.PROVIDER_ERROR }; }
  if (!status.enabled) return { ok: false, reason: "DISABLED", message: MESSAGES.DISABLED };
  const runtime = await activeAi().catch(() => null);
  if (!runtime) return { ok: false, reason: "NOT_CONFIGURED", message: MESSAGES.NOT_CONFIGURED };
  const provider = runtime.kind === "ANTHROPIC" ? "anthropic" : "openai-compatible";
  const model = String(runtime.settings.model ?? "");
  const record = (outcome: "OK" | "ERROR" | "TIMEOUT" | "BLOCKED", i = 0, o = 0, ms: number | null = null, cost = 0) =>
    adminClient().rpc("ai_record_usage", { p_user: req.userId ?? null, p_conversation: req.conversationId ?? null, p_purpose: req.purpose, p_provider: provider, p_model: model || "unknown",
      p_in: i, p_out: o, p_cost: cost, p_latency: ms, p_outcome: outcome }).then(() => undefined, () => undefined);

  if (status.ceilingUsd > 0 && status.todayUsd >= status.ceilingUsd) { await record("BLOCKED"); return { ok: false, reason: "BUDGET", message: MESSAGES.BUDGET }; }
  if (req.userId && status.userLimitHour > 0 && status.userCallsHour >= status.userLimitHour) { await record("BLOCKED"); return { ok: false, reason: "RATE_LIMIT", message: MESSAGES.RATE_LIMIT }; }

  try {
    const reply = await callProvider({ kind: runtime.kind, settings: runtime.settings, apiKey: runtime.apiKey },
      { system: req.system, messages: req.messages, maxTokens: req.maxTokens ?? 1024 }, { timeoutMs: status.timeoutSeconds * 1000, maxRetries: status.maxRetries });
    const cost = costUsd(reply.inputTokens, reply.outputTokens, Number(status.inputPrice), Number(status.outputPrice));
    await record("OK", reply.inputTokens, reply.outputTokens, reply.ms, cost);
    return { ok: true, ...reply, costUsd: cost };
  } catch (e) {
    const f = e instanceof ProviderFailure ? e : new ProviderFailure("PROVIDER_ERROR", MESSAGES.PROVIDER_ERROR);
    await record(f.reason === "TIMEOUT" ? "TIMEOUT" : "ERROR");
    return { ok: false, reason: f.reason === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : f.reason, message: f.reason === "NOT_CONFIGURED" ? MESSAGES.NOT_CONFIGURED : `${MESSAGES[f.reason]} ${f.message}`.trim() };
  }
}
