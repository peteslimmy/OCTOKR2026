import { assertPublicUrl } from "@/lib/integrations/ssrf";
import { plainError } from "@/lib/integrations/adapters";

/**
 * One request to the configured AI provider (4COREPAL). Nothing here reads the database: the caller passes the provider's settings, key and the limits.
 * It speaks the two protocols the integrations screen offers (Anthropic Messages and OpenAI-compatible chat), follows no redirects, stops at the timeout,
 * retries only what is worth retrying (rate limiting, server errors, a network failure) with a growing pause, and turns every failure into a plain sentence
 * with the key removed. The model never gets a tool or a database here: it receives text and returns text.
 */
export interface ProviderTarget { kind: "ANTHROPIC" | "OPENAI_COMPATIBLE"; settings: Record<string, unknown>; apiKey?: string }
export interface ProviderMessage { role: "user" | "assistant"; content: string }
export interface ProviderRequest { system: string; messages: ProviderMessage[]; maxTokens: number }
export interface ProviderLimits { timeoutMs: number; maxRetries: number; sleep?: (ms: number) => Promise<void> }
export interface ProviderReply { text: string; model: string; inputTokens: number; outputTokens: number; ms: number; attempts: number }
export type ProviderFailureReason = "NOT_CONFIGURED" | "TIMEOUT" | "PROVIDER_ERROR";
export class ProviderFailure extends Error {
  constructor(readonly reason: ProviderFailureReason, message: string, readonly attempts = 1) { super(message); }
}

const retryable = (status: number) => status === 429 || status >= 500;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function once(t: ProviderTarget, req: ProviderRequest, timeoutMs: number): Promise<{ status: number; json: unknown; text: string }> {
  const model = String(t.settings.model ?? "");
  const baseUrl = String(t.settings.baseUrl ?? "") || (t.kind === "ANTHROPIC" ? "https://api.anthropic.com" : "");
  const base = await assertPublicUrl(baseUrl);
  let url: URL, headers: Record<string, string>, body: unknown;
  if (t.kind === "ANTHROPIC") {
    url = new URL("/v1/messages", base);
    headers = { "x-api-key": t.apiKey ?? "", "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: req.maxTokens, system: req.system, messages: req.messages };
  } else {
    url = new URL(`${base.pathname.replace(/\/+$/, "")}/chat/completions`, base);
    headers = t.apiKey ? { authorization: `Bearer ${t.apiKey}` } : {};
    body = { model, max_tokens: req.maxTokens, messages: [{ role: "system", content: req.system }, ...req.messages] };
  }
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  if (res.status >= 300 && res.status < 400) throw new ProviderFailure("PROVIDER_ERROR", "The provider redirected the request; redirects are not followed.");
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

function describeFailure(status: number, json: unknown, text: string): string {
  const j = json as { error?: { message?: string } | string } | null;
  const detail = typeof j?.error === "string" ? j.error : j?.error?.message ?? text.slice(0, 120);
  if (status === 401 || status === 403) return `The provider rejected the API key (${status}).`;
  if (status === 404) return "The provider does not know that address or model (404).";
  if (status === 429) return "The provider is limiting requests (429).";
  return `The provider answered ${status}: ${detail}`;
}

export async function callProvider(t: ProviderTarget, req: ProviderRequest, limits: ProviderLimits): Promise<ProviderReply> {
  if (!String(t.settings.model ?? "").trim()) throw new ProviderFailure("NOT_CONFIGURED", "No model is set for the AI provider.");
  const sleep = limits.sleep ?? defaultSleep;
  const t0 = Date.now();
  let last: ProviderFailure = new ProviderFailure("PROVIDER_ERROR", "The provider could not be reached.");
  for (let attempt = 1; attempt <= limits.maxRetries + 1; attempt++) {
    try {
      const r = await once(t, req, limits.timeoutMs);
      if (r.status === 200) {
        const parsed = parseReply(t.kind, r.json);
        if (parsed) return { ...parsed, model: parsed.model || String(t.settings.model), ms: Date.now() - t0, attempts: attempt };
        last = new ProviderFailure("PROVIDER_ERROR", "The provider's answer could not be read.", attempt);
        break;                                                  // a malformed answer will not improve on retry
      }
      last = new ProviderFailure("PROVIDER_ERROR", describeFailure(r.status, r.json, r.text), attempt);
      if (!retryable(r.status)) break;
    } catch (e) {
      if (e instanceof ProviderFailure) { last = new ProviderFailure(e.reason, e.message, attempt); break; }
      const name = (e as Error)?.name;
      const timedOut = name === "TimeoutError" || name === "AbortError";
      last = new ProviderFailure(timedOut ? "TIMEOUT" : "PROVIDER_ERROR", plainError(e, t.apiKey ? [t.apiKey] : []), attempt);
    }
    if (attempt <= limits.maxRetries) await sleep(500 * 2 ** (attempt - 1));
  }
  throw new ProviderFailure(last.reason, last.message, last.attempts);
}

function parseReply(kind: ProviderTarget["kind"], json: unknown): { text: string; model: string; inputTokens: number; outputTokens: number } | null {
  if (kind === "ANTHROPIC") {
    const j = json as { content?: { type?: string; text?: string }[]; model?: string; usage?: { input_tokens?: number; output_tokens?: number } } | null;
    const text = j?.content?.filter((c) => c.type === undefined || c.type === "text").map((c) => c.text ?? "").join("");
    if (typeof text !== "string" || !j?.content?.length) return null;
    return { text, model: j.model ?? "", inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
  }
  const j = json as { choices?: { message?: { content?: string } }[]; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return null;
  return { text, model: j?.model ?? "", inputTokens: j?.usage?.prompt_tokens ?? 0, outputTokens: j?.usage?.completion_tokens ?? 0 };
}

/** Cost in US dollars from the administrator's configured prices (per million tokens). Zero prices record zero cost. */
export const costUsd = (inputTokens: number, outputTokens: number, inputPrice: number, outputPrice: number) =>
  Math.round(((inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000) * 1e6) / 1e6;
