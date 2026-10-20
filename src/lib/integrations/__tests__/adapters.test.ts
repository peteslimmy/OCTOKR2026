import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plainError, signWebhook, testAnthropic, testOpenAiCompatible, testSmtp, testWebhook, webhookBody, sendWebhook } from "../adapters";
import { deliverWebhooks, type WebhookRow } from "../webhook-delivery";
import { checkSettings, withDefaults, type IntegrationKind } from "../types";

// the sinks listen on 127.0.0.1, which the address check refuses in real use: this switches it off for these tests only
process.env.INTEGRATIONS_ALLOW_PRIVATE_HOSTS = "true";

interface Seen { method?: string; url?: string; headers: IncomingMessage["headers"]; body: string }
let http: Server; let base = ""; const seen: Seen[] = []; let reply: (req: IncomingMessage, body: string, res: ServerResponse) => void = (_r, _b, res) => { res.statusCode = 200; res.end("{}"); };
let smtp: SMTPServer; let smtpPort = 0; const mails: string[] = [];

beforeAll(async () => {
  http = createServer((req, res) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body: b }); reply(req, b, res); }); });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  smtp = new SMTPServer({ authOptional: false, disabledCommands: ["STARTTLS"], allowInsecureAuth: true,
    onAuth(auth, _s, cb) { if (auth.username === "mailer" && auth.password === "right-password") cb(null, { user: "mailer" }); else cb(new Error("Invalid login")); },
    onData(stream, _s, cb) { let m = ""; stream.on("data", (c) => m += c); stream.on("end", () => { mails.push(m); cb(); }); } });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  smtpPort = (smtp.server.address() as AddressInfo).port;
});
afterAll(async () => { http.close(); await new Promise((r) => smtp.close(() => r(null))); });

describe("webhooks", () => {
  it("signs `timestamp.body` with HMAC-SHA256 so a receiver can verify it", async () => {
    seen.length = 0; reply = (_r, _b, res) => { res.statusCode = 204; res.end(); };
    const r = await sendWebhook({ url: `${base}/hook`, format: "JSON", signingSecret: "shared-secret", deliveryId: "d-1", event: { event: "ROLE_CREATED", entity_type: "role", entity_id: "r1", outcome: "SUCCESS" } });
    expect(r).toMatchObject({ ok: true, status: 204 });
    const s = seen[0];
    const ts = Number(s.headers["x-okr-timestamp"]);
    expect(s.headers["x-okr-signature"]).toBe(`sha256=${signWebhook("shared-secret", ts, s.body)}`);
    expect(s.headers["x-okr-event"]).toBe("ROLE_CREATED");
    expect(s.headers["x-okr-delivery"]).toBe("d-1");
    expect(JSON.parse(s.body)).toMatchObject({ event: "ROLE_CREATED", entity_id: "r1" });
    expect(signWebhook("other-secret", ts, s.body)).not.toBe(signWebhook("shared-secret", ts, s.body));
  });

  it("sends the text format Slack and Teams accept, and no signature header when there is no secret", async () => {
    seen.length = 0;
    await sendWebhook({ url: `${base}/slack`, format: "TEXT", deliveryId: "d-2", event: { event: "CONFIG_CHANGE_APPLIED", entity_type: "config_change_request", outcome: "SUCCESS" } });
    expect(JSON.parse(seen[0].body)).toEqual({ text: "4CORE-OKR: CONFIG_CHANGE_APPLIED (config_change_request)" });
    expect(seen[0].headers["x-okr-signature"]).toBeUndefined();
    expect(webhookBody("TEXT", { event: "X", outcome: "DENIED" })).toContain("[DENIED]");
  });

  it("treats a non-success answer, a redirect and a dead server as failures, in plain words and without following the redirect", async () => {
    seen.length = 0;
    reply = (_r, _b, res) => { res.statusCode = 500; res.end(); };
    expect(await sendWebhook({ url: `${base}/x`, format: "JSON", deliveryId: "d", event: { event: "X" } })).toMatchObject({ ok: false, message: "The receiver answered 500." });
    reply = (_r, _b, res) => { res.statusCode = 302; res.setHeader("location", "http://169.254.169.254/latest/meta-data"); res.end(); };
    const red = await sendWebhook({ url: `${base}/x`, format: "JSON", deliveryId: "d", event: { event: "X" } });
    expect(red.ok).toBe(false); expect(red.message).toMatch(/redirect/);
    expect(seen.filter((s) => s.url === "/latest/meta-data")).toHaveLength(0);
    const freePort = await new Promise<number>((r) => { const t = createServer().listen(0, "127.0.0.1", () => { const p = (t.address() as AddressInfo).port; t.close(() => r(p)); }); });
    const dead = await sendWebhook({ url: `http://127.0.0.1:${freePort}/x`, format: "JSON", deliveryId: "d", event: { event: "X" }, timeoutMs: 2000 });
    expect(dead.ok).toBe(false); expect(dead.message).toMatch(/refused the connection/);
    reply = (_r, _b, res) => { res.statusCode = 200; res.end(); };
  });

  it("testWebhook sends a harmless TEST_PING", async () => {
    seen.length = 0;
    const r = await testWebhook({ url: `${base}/ping`, format: "JSON" }, "s");
    expect(r.ok).toBe(true);
    expect(JSON.parse(seen[0].body).event).toBe("TEST_PING");
  });

  it("delivery marks success, failure and an undecryptable secret, one row at a time", async () => {
    seen.length = 0;
    const rows: WebhookRow[] = [1, 2, 3].map((n) => ({ id: `row-${n}`, integration_id: "i", event_type: "E", payload: { event: "E", n }, attempts: 1, url: `${base}/d${n}`, format: "JSON", name: "w", signing_secret: n === 3 ? "garbled" : "v1.k.a.b.c" }));
    const marks: [string, boolean, string | undefined][] = [];
    const r = await deliverWebhooks({
      claim: async () => rows,
      mark: async (id, ok, err) => { marks.push([id, ok, err]); },
      decrypt: (t) => { if (t === "garbled") throw new Error("the secret could not be decrypted"); return "plain-secret"; },
      send: async (o) => ({ ok: o.url.endsWith("/d1"), message: "The receiver answered 500." }),
    });
    expect(r).toEqual({ claimed: 3, sent: 1, failed: 2 });
    expect(marks).toEqual([["row-1", true, undefined], ["row-2", false, "The receiver answered 500."], ["row-3", false, "the secret could not be decrypted"]]);
  });
});

describe("email (SMTP)", () => {
  const settings = (over: Record<string, unknown> = {}) => ({ host: "127.0.0.1", port: smtpPort, security: "NONE" as const, username: "mailer", fromAddress: "no-reply@example.com", fromName: "4CORE-OKR", baseUrl: "https://okr.example.com", ...over });

  it("connects, signs in and sends one test message to the person who asked", async () => {
    mails.length = 0;
    const r = await testSmtp(settings(), "right-password", "me@example.com");
    expect(r.ok).toBe(true); expect(r.message).toContain("me@example.com");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain("Subject: 4CORE-OKR integration test");
    expect(mails[0]).toContain("To: me@example.com");
  });

  it("can test the connection without sending anything", async () => {
    mails.length = 0;
    const r = await testSmtp(settings(), "right-password", null);
    expect(r).toMatchObject({ ok: true, message: "Connected and signed in. No test message was sent." });
    expect(mails).toHaveLength(0);
  });

  it("says plainly what is wrong and never repeats the password", async () => {
    const wrong = await testSmtp(settings(), "wrong-password-zzz", null);
    expect(wrong.ok).toBe(false); expect(wrong.message).toMatch(/user name or password/);
    expect(wrong.message).not.toContain("wrong-password-zzz");
    const refused = await testSmtp(settings({ port: 1 }), "x", null);
    expect(refused).toMatchObject({ ok: false }); expect(refused.message).toMatch(/refused the connection/);
    expect(plainError(new Error("failed with token abcd1234 inside"), ["abcd1234"])).toBe("failed with token ••• inside");
  });
});

describe("AI providers", () => {
  it("Anthropic: sends a fixed harmless sentence with the key and version headers, and reports success", async () => {
    seen.length = 0;
    reply = (_r, _b, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ content: [{ type: "text", text: "OK" }] })); };
    const r = await testAnthropic({ model: "claude-sonnet-5-5", baseUrl: base }, "sk-ant-test-key");
    expect(r.ok).toBe(true);
    expect(seen[0].url).toBe("/v1/messages");
    expect(seen[0].headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(seen[0].headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(seen[0].body);
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 16 });
    expect(body.messages).toEqual([{ role: "user", content: "Reply with the single word OK." }]);          // nothing from the application is ever sent in a test
  });

  it("OpenAI-compatible: posts to /chat/completions, with a bearer key when there is one", async () => {
    seen.length = 0;
    reply = (_r, _b, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] })); };
    expect((await testOpenAiCompatible({ model: "m", baseUrl: `${base}/v1` }, "k-123")).ok).toBe(true);
    expect(seen[0].url).toBe("/v1/chat/completions"); expect(seen[0].headers.authorization).toBe("Bearer k-123");
    seen.length = 0;
    expect((await testOpenAiCompatible({ model: "m", baseUrl: `${base}/v1` }, undefined)).ok).toBe(true);
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("turns the provider's refusals into advice, never echoing the key", async () => {
    reply = (_r, _b, res) => { res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: { message: "bad key sk-secret-1234" } })); };
    const r = await testAnthropic({ model: "m", baseUrl: base }, "sk-secret-1234");
    expect(r).toMatchObject({ ok: false, message: "The provider rejected the API key (401)." });
    reply = (_r, _b, res) => { res.statusCode = 404; res.end("{}"); };
    expect((await testOpenAiCompatible({ model: "nope", baseUrl: `${base}/v1` }, "k")).message).toMatch(/does not know that address or model/);
    reply = (_r, _b, res) => { res.statusCode = 200; res.end("<html>not json</html>"); };
    expect((await testAnthropic({ model: "m", baseUrl: base }, "k")).ok).toBe(false);
    reply = (_r, _b, res) => { res.statusCode = 200; res.end("{}"); };
  });
});

describe("settings checks", () => {
  const kind: IntegrationKind = { code: "WEBHOOK", slot: "WEBHOOK", label: "Webhook", description: "",
    setting_fields: [{ key: "url", label: "Address", type: "url", required: true }, { key: "events", label: "Events", type: "tags", required: true, pattern: "^(\\*|[A-Z][A-Z0-9_]*\\*?)$", default: ["*"] }, { key: "format", label: "Format", type: "select", required: true, options: ["JSON", "TEXT"], default: "JSON" }, { key: "retries", label: "Retries", type: "number", min: 0, max: 5 }],
    secret_fields: [{ key: "signingSecret", label: "Signing secret" }] };

  it("fills defaults, then accepts a good set", () => {
    const s = withDefaults(kind, { url: "https://hooks.example.com/a" });
    expect(s).toMatchObject({ events: ["*"], format: "JSON" });
    expect(checkSettings(kind, s)).toEqual([]);
  });
  it("names each problem in the person's words", () => {
    expect(checkSettings(kind, {})).toEqual(["Address is required.", "Events is required.", "Format is required."]);
    expect(checkSettings(kind, { url: "ftp://x", events: ["role created"], format: "XML", retries: 9, extra: 1 }).sort()).toEqual([
      "Address must be a web address starting with https://.", "Events has an item that is not allowed.", "Format must be one of: JSON, TEXT.", "Retries must be a whole number from 0 to 5.", "Unknown setting: extra"].sort());
  });
});
