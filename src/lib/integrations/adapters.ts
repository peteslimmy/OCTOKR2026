import "server-only";
import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { assertPublicHost, assertPublicUrl, UnsafeAddressError } from "./ssrf";
import type { TestResult } from "./types";

/**
 * The adapters: what each kind of integration actually does when it is used or tested (ADR-076). Everything here takes plain values (already decrypted by
 * the caller) and never logs or returns them. Errors are turned into sentences a person can act on, with any secret removed.
 */
export function plainError(e: unknown, secrets: string[] = []): string {
  let m = e instanceof Error ? e.message : String(e);
  // the network code can sit on the error, on its cause (or the causes of an aggregate), or only in the text (nodemailer wraps connection errors)
  const cause = (e as { cause?: { code?: string; errors?: { code?: string }[] } })?.cause;
  const net = cause?.code ?? cause?.errors?.find((x) => x?.code)?.code ?? /(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH)/.exec(m)?.[1];
  const code = net ?? (e as { code?: string })?.code;
  if (e instanceof UnsafeAddressError) m = e.message;
  else if (code === "ECONNREFUSED") m = "The server refused the connection. Check the address and port.";
  else if (code === "ENOTFOUND" || code === "EAI_AGAIN") m = "The server name could not be found.";
  else if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") m = "The server did not answer in time.";
  else if (code === "EAUTH") m = "The server rejected the user name or password.";
  else if (code === "EHOSTUNREACH" || code === "ENETUNREACH") m = "The server cannot be reached from here.";
  else if (code === "ESOCKET" || code === "ECONNECTION" || code === "ECONNRESET") m = `The connection failed: ${m}`;
  else if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || /certificate/i.test(m)) m = "The server's security certificate was not accepted.";
  for (const s of secrets) if (s && s.length >= 4) m = m.split(s).join("•••");
  return m.replace(/\s+/g, " ").slice(0, 300);
}

// ------------------------------------------------------------------ SMTP
export interface SmtpSettings { host: string; port: number; security: "STARTTLS" | "TLS" | "NONE"; username?: string; fromName?: string; fromAddress: string; baseUrl: string }

export function smtpTransportFor(s: SmtpSettings, password?: string) {
  return nodemailer.createTransport({
    host: s.host, port: Number(s.port), secure: s.security === "TLS", requireTLS: s.security === "STARTTLS", ignoreTLS: s.security === "NONE",
    auth: s.username ? { user: s.username, pass: password ?? "" } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
}
export const smtpFrom = (s: SmtpSettings) => (s.fromName ? `"${s.fromName.replace(/["\\\r\n]/g, "")}" <${s.fromAddress}>` : s.fromAddress);

export async function testSmtp(s: SmtpSettings, password: string | undefined, sendTo: string | null): Promise<TestResult> {
  const t0 = Date.now();
  try {
    await assertPublicHost(s.host);
    const t = smtpTransportFor(s, password);
    await t.verify();
    if (sendTo) {
      await t.sendMail({ from: smtpFrom(s), to: sendTo, subject: "4CORE-OKR integration test", text: "This message was sent from Administration → Integrations to confirm that 4CORE-OKR can send email through this server. Nothing else is needed." });
      return { ok: true, ms: Date.now() - t0, message: `Connected, signed in, and sent a test message to ${sendTo}. Check that inbox (and the spam folder).` };
    }
    return { ok: true, ms: Date.now() - t0, message: "Connected and signed in. No test message was sent." };
  } catch (e) { return { ok: false, ms: Date.now() - t0, message: plainError(e, [password ?? ""]) }; }
}

// ------------------------------------------------------------------ AI providers
const TEST_PROMPT = "Reply with the single word OK.";   // a fixed harmless sentence: no application data ever goes in a test

async function postJson(url: URL, headers: Record<string, string>, body: unknown, timeoutMs = 20_000) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  if (res.status >= 300 && res.status < 400) throw new Error("The server redirected the request; redirects are not followed. Use the final address.");
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const providerError = (status: number, json: unknown, text: string) => {
  const j = json as { error?: { message?: string } | string } | null;
  const detail = typeof j?.error === "string" ? j.error : j?.error?.message ?? text.slice(0, 120);
  if (status === 401 || status === 403) return `The provider rejected the API key (${status}).`;
  if (status === 404) return "The provider does not know that address or model (404). Check the API address and the model name.";
  if (status === 429) return "The provider is limiting requests (429). Try again later.";
  return `The provider answered ${status}: ${detail}`;
};

export async function testAnthropic(s: { model: string; baseUrl?: string }, apiKey: string): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const base = await assertPublicUrl(s.baseUrl || "https://api.anthropic.com");
    const url = new URL("/v1/messages", base);
    const r = await postJson(url, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, { model: s.model, max_tokens: 16, messages: [{ role: "user", content: TEST_PROMPT }] });
    const text = (r.json as { content?: { text?: string }[] } | null)?.content?.[0]?.text;
    if (r.status === 200 && typeof text === "string") return { ok: true, ms: Date.now() - t0, message: `The provider answered (model ${s.model}) in ${Date.now() - t0} ms.` };
    return { ok: false, ms: Date.now() - t0, message: providerError(r.status, r.json, r.text) };
  } catch (e) { return { ok: false, ms: Date.now() - t0, message: plainError(e, [apiKey]) }; }
}

export async function testOpenAiCompatible(s: { model: string; baseUrl: string }, apiKey: string | undefined): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const base = await assertPublicUrl(s.baseUrl);
    const url = new URL(`${base.pathname.replace(/\/+$/, "")}/chat/completions`, base);
    const r = await postJson(url, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, { model: s.model, max_tokens: 16, messages: [{ role: "user", content: TEST_PROMPT }] });
    const text = (r.json as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message?.content;
    if (r.status === 200 && typeof text === "string") return { ok: true, ms: Date.now() - t0, message: `The provider answered (model ${s.model}) in ${Date.now() - t0} ms.` };
    return { ok: false, ms: Date.now() - t0, message: providerError(r.status, r.json, r.text) };
  } catch (e) { return { ok: false, ms: Date.now() - t0, message: plainError(e, apiKey ? [apiKey] : []) }; }
}

// ------------------------------------------------------------------ webhooks
export interface WebhookEvent { event: string; entity_type?: string | null; entity_id?: string | null; outcome?: string | null; actor_role?: string | null; occurred_at?: string; correlation_id?: string | null; [k: string]: unknown }

/** The bytes that are signed are `<unix seconds>.<body>`; the receiver recomputes the HMAC-SHA256 with the shared secret and rejects old timestamps. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function webhookBody(format: "JSON" | "TEXT", event: WebhookEvent): string {
  if (format === "TEXT") {
    const what = [event.event, event.entity_type ? `(${event.entity_type})` : "", event.outcome && event.outcome !== "SUCCESS" ? `[${event.outcome}]` : ""].filter(Boolean).join(" ");
    return JSON.stringify({ text: `4CORE-OKR: ${what}` });
  }
  return JSON.stringify(event);
}

export async function sendWebhook(opts: { url: string; format: "JSON" | "TEXT"; signingSecret?: string; event: WebhookEvent; deliveryId: string; timeoutMs?: number }): Promise<{ ok: boolean; status?: number; message: string }> {
  try {
    const url = await assertPublicUrl(opts.url);                                   // checked again at every delivery
    const body = webhookBody(opts.format, opts.event);
    const ts = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "4CORE-OKR-webhook/1", "x-okr-event": opts.event.event, "x-okr-delivery": opts.deliveryId, "x-okr-timestamp": String(ts) };
    if (opts.signingSecret) headers["x-okr-signature"] = `sha256=${signWebhook(opts.signingSecret, ts, body)}`;
    const res = await fetch(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    await res.arrayBuffer().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, message: `The receiver answered ${res.status}.` };
    if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, message: "The receiver redirected the request; redirects are not followed. Use the final address." };
    return { ok: false, status: res.status, message: `The receiver answered ${res.status}.` };
  } catch (e) { return { ok: false, message: plainError(e, opts.signingSecret ? [opts.signingSecret] : []) }; }
}

export async function testWebhook(s: { url: string; format?: "JSON" | "TEXT" }, signingSecret: string | undefined): Promise<TestResult> {
  const t0 = Date.now();
  const r = await sendWebhook({ url: s.url, format: s.format ?? "JSON", signingSecret, deliveryId: "test-ping", event: { event: "TEST_PING", entity_type: "integration", outcome: "SUCCESS", occurred_at: new Date().toISOString() } });
  return { ok: r.ok, ms: Date.now() - t0, message: r.ok ? `The receiver accepted the test event (${r.status}) in ${Date.now() - t0} ms.` : r.message };
}
