/**
 * HTTP-level tests for the Integrations module (ADR-076): who may do what, that secrets never leave in the clear, and that SMTP, AI and webhooks really work against local stand-ins.
 * Needs a built app and a seeded database (`npm run dev:seed`). Authorisation and validation only: the workflows themselves are proven at
 * database level (tests/db/integrations.test.ts). The server must run with INTEGRATIONS_ALLOW_PRIVATE_HOSTS=true (the serial runner sets it) so the local stand-ins on 127.0.0.1 are reachable.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { Client } from "pg";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { completeMfa } from "./mfa-login";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PASSWORD = "DevPassword!2026";

class Session {
  private jar = new Map<string, string>();
  /** A distinct client address per session, so the per-IP sign-in limiter does not couple unrelated tests (production sits behind a proxy that sets this header). */
  private ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  async request(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method, redirect: "manual",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-forwarded-for": this.ip, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.jar.delete(name); else this.jar.set(name, value);
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: payload shapes are asserted at each call site
    let json: { data?: any; error?: { code: string; message: string } } = {};
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json };
  }
}
const sessions = new Map<string, Session>();   // one login per account: the server rate-limits sign-ins
async function as(email: string) {
  const cached = sessions.get(email);
  if (cached) return cached;
  const s = new Session();
  const r = await s.request("POST", "/api/v1/auth/login", { email, password: PASSWORD });
  expect(r.status, `login ${email}`).toBe(200);
  await completeMfa(s, email, r);
  sessions.set(email, s);
  return s;
}
const key = () => randomUUID();
const fake = "11111111-1111-4111-8111-111111111111";


const SECRET = process.env.JOBS_SECRET!;
const SIGNING = "api-test-signing-secret-1234";
const SMTP_PASSWORD = "api-test-smtp-password-5678";
const APIKEY = "sk-api-test-key-9012";

interface Seen { url?: string; headers: Record<string, string | string[] | undefined>; body: string }
let sink: Server; let sinkBase = ""; const hits: Seen[] = [];
let smtp: SMTPServer; let smtpPort = 0; const mails: string[] = [];
let db: Client;

beforeAll(async () => {
  sink = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      hits.push({ url: req.url, headers: req.headers, body: b });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/messages") res.end(JSON.stringify({ content: [{ type: "text", text: "OK" }] }));
      else res.end("{}");
    });
  });
  await new Promise<void>((r) => sink.listen(0, "127.0.0.1", r));
  sinkBase = `http://127.0.0.1:${(sink.address() as AddressInfo).port}`;
  smtp = new SMTPServer({ authOptional: false, disabledCommands: ["STARTTLS"], allowInsecureAuth: true,
    onAuth(auth, _s, cb) { if (auth.username === "mailer" && auth.password === SMTP_PASSWORD) cb(null, { user: "mailer" }); else cb(new Error("Invalid login")); },
    onData(stream, _s, cb) { let m = ""; stream.on("data", (c) => (m += c)); stream.on("end", () => { mails.push(m); cb(); }); } });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  smtpPort = (smtp.server.address() as AddressInfo).port;
  db = new Client({ connectionString: process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await db.connect();
});
afterAll(async () => { sink.close(); await new Promise((r) => smtp.close(() => r(null))); await db.end(); });

const runJobs = () => fetch(`${BASE}/api/internal/jobs/run`, { method: "POST", headers: { "x-jobs-secret": SECRET } }).then((r) => r.json());
const unique = () => `Api ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const approve = (s: Session, id: string) => s.request("POST", `/api/v1/config-changes/${id}/decision`, { decision: "APPROVE", idempotencyKey: key() });
const signature = (secret: string, h: Seen) => `sha256=${createHmac("sha256", secret).update(`${Number(h.headers["x-okr-timestamp"])}.${h.body}`).digest("hex")}`;

describe("who may see and change integrations", () => {
  it("needs sign-in and the right permission for every route", async () => {
    for (const [m, p, b] of [["GET", "/api/v1/integrations"], ["POST", "/api/v1/integrations/request", { action: "DELETE", id: fake, reason: "x" }], ["POST", "/api/v1/integrations/test", { id: fake }]] as [string, string, unknown?][]) {
      expect((await new Session().request(m, p, b)).status, p).toBe(401);
    }
    for (const who of ["lead.eng@4core.local", "hr@4core.local", "presenter@4core.local", "finance@4core.local", "exec@4core.local"]) {
      const s = await as(who);
      expect((await s.request("GET", "/api/v1/integrations")).status, who).toBe(403);
      expect((await s.request("POST", "/api/v1/integrations/request", { action: "DELETE", id: fake, reason: "x" })).status, who).toBe(403);
      expect((await s.request("POST", "/api/v1/integrations/test", { id: fake })).status, who).toBe(403);
    }
  });

  it("an Admin sees the catalogue and the state of the server, never a secret", async () => {
    const admin = await as("admin@4core.local");
    const r = await admin.request("GET", "/api/v1/integrations");
    expect(r.status).toBe(200);
    expect(r.json.data.kinds.map((k: { code: string }) => k.code).sort()).toEqual(["ANTHROPIC", "OPENAI_COMPATIBLE", "SMTP", "WEBHOOK"]);
    expect(r.json.data).toMatchObject({ encryptionConfigured: true, privateHostsAllowed: true });
  });
});

describe("a request is checked before anyone is asked to approve it", () => {
  const hook = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) => ({ action: "CREATE", kind: "WEBHOOK", name: unique(), enabled: false, reason: "api test",
    settings: { url: `${sinkBase}/hook`, events: ["ROLE_*"], format: "JSON", ...settings }, secrets: { signingSecret: SIGNING }, ...over });

  it("rejects unknown kinds, missing and malformed values, unknown fields and addresses with credentials", async () => {
    const admin = await as("admin@4core.local");
    const post = (b: unknown) => admin.request("POST", "/api/v1/integrations/request", b);
    expect((await post(hook({ kind: "NOPE" }))).status).toBe(422);
    expect((await post(hook({ name: " " }))).status).toBe(422);
    expect((await post(hook({ reason: " " }))).status).toBe(422);
    expect((await post(hook({}, { url: "not a url" }))).status).toBe(422);
    expect((await post(hook({}, { url: "https://user:pw@hooks.example.com/x" }))).status).toBe(422);
    expect((await post(hook({}, { events: ["role created"] }))).status).toBe(422);
    expect((await post(hook({}, { format: "XML" }))).status).toBe(422);
    expect((await post(hook({}, { surprise: 1 }))).status).toBe(422);
    expect((await post(hook({ secrets: { apiKey: "x" } }))).status).toBe(422);
    expect((await post({ ...hook(), status: "APPROVED" })).status).toBe(422);                              // no mass assignment
    expect((await post({ action: "CREATE", kind: "ANTHROPIC", name: unique(), reason: "x", settings: { model: "claude-sonnet-5-5" }, secrets: {} })).status).toBe(422);   // the key is required
    expect((await post({ action: "UPDATE", id: fake, reason: "x", name: "n", settings: {} })).status).toBe(404);
  });
});

describe("webhooks, end to end", () => {
  let id = ""; const name = unique();

  it("a request holds only ciphertext; a Super Admin approves; the screen then shows 'set', never the value", async () => {
    const admin = await as("admin@4core.local"); const sa = await as("superadmin@4core.local");
    const ask = await admin.request("POST", "/api/v1/integrations/request", { action: "CREATE", kind: "WEBHOOK", name, enabled: true, reason: "api test",
      settings: { url: `${sinkBase}/hook`, events: ["ROLE_*"], format: "JSON" }, secrets: { signingSecret: SIGNING } });
    expect(ask.status, JSON.stringify(ask.json)).toBe(200);
    expect(ask.json.data).toMatchObject({ status: "PENDING", protected: true });
    const stored = (await db.query("select proposed::text as p from config_change_requests where id = $1", [ask.json.data.request_id])).rows[0].p as string;
    expect(stored).not.toContain(SIGNING);
    expect(stored).toContain("v1.");                                                                         // ciphertext is what is kept
    const audit = (await db.query("select string_agg(coalesce(new_values::text, '') || coalesce(old_values::text, ''), ' ') as t from audit_logs where entity_id = $1", [ask.json.data.request_id])).rows[0].t as string | null;
    expect(audit ?? "").not.toContain(SIGNING);
    const before = (await admin.request("GET", "/api/v1/integrations")).json.data.items as { name: string }[];
    expect(before.some((i) => i.name === name)).toBe(false);                                                 // asking changes nothing
    expect((await approve(admin, ask.json.data.request_id)).status).toBe(403);                               // not their own, and an Admin is not enough for a protected change
    expect((await approve(sa, ask.json.data.request_id)).status).toBe(200);
    const list = await admin.request("GET", "/api/v1/integrations");
    const item = list.json.data.items.find((i: { name: string }) => i.name === name);
    expect(item).toMatchObject({ kind: "WEBHOOK", enabled: true, secrets_set: ["signingSecret"] });
    id = item.id;
    expect(JSON.stringify(list.json)).not.toContain(SIGNING);
    expect(JSON.stringify(list.json)).not.toContain("v1.");
  });

  it("a test sends a signed TEST_PING and the result is remembered", async () => {
    const admin = await as("admin@4core.local");
    hits.length = 0;
    const t = await admin.request("POST", "/api/v1/integrations/test", { id });
    expect(t.status, JSON.stringify(t.json)).toBe(200);
    expect(t.json.data.ok).toBe(true);
    expect(JSON.parse(hits[0].body).event).toBe("TEST_PING");
    expect(hits[0].headers["x-okr-signature"]).toBe(signature(SIGNING, hits[0]));                            // the saved secret, decrypted with the key, signed correctly
    const now = (await admin.request("GET", "/api/v1/integrations")).json.data.items.find((i: { id: string }) => i.id === id);
    expect(now).toMatchObject({ last_test_ok: true });
    expect((await db.query("select 1 from audit_logs where action = 'INTEGRATION_TESTED' and entity_id = $1", [id])).rowCount).toBe(1);
  });

  it("an event the webhook asked for is delivered with the signature, and an event it did not ask for is not", async () => {
    await db.query("select write_audit(null, 'ROLE_UPDATED', 'role', $1, '{\"v\":\"old\"}'::jsonb, '{\"v\":\"new\"}'::jsonb, 'a private reason')", [`api-${Date.now()}`]);
    await db.query("select write_audit(null, 'VIOLATION_TYPE_CREATED', 'violation_type', $1)", [`api-${Date.now()}`]);
    hits.length = 0;
    const out = await runJobs();
    expect(out.data.webhooks.sent).toBeGreaterThanOrEqual(1);
    const events = hits.map((h) => JSON.parse(h.body).event);
    expect(events).toContain("ROLE_UPDATED");
    expect(events).not.toContain("VIOLATION_TYPE_CREATED");
    const h = hits.find((x) => JSON.parse(x.body).event === "ROLE_UPDATED")!;
    expect(h.body).not.toMatch(/old|new|private reason/);                                                    // no values and no reason ever leave
    expect(h.headers["x-okr-signature"]).toBe(signature(SIGNING, h));
  });

  it("a test of a dead address fails in plain words; a switched-off webhook receives nothing and keeps its secret", async () => {
    const admin = await as("admin@4core.local"); const sa = await as("superadmin@4core.local");
    const dead = await new Promise<number>((r) => { const t = createServer().listen(0, "127.0.0.1", () => { const p = (t.address() as AddressInfo).port; t.close(() => r(p)); }); });
    const t = await admin.request("POST", "/api/v1/integrations/test", { kind: "WEBHOOK", settings: { url: `http://127.0.0.1:${dead}/x`, events: ["*"], format: "JSON" } });
    expect(t.json.data).toMatchObject({ ok: false }); expect(t.json.data.message).toMatch(/refused the connection/);

    const off = await admin.request("POST", "/api/v1/integrations/request", { action: "UPDATE", id, name, enabled: false, reason: "api test", settings: { url: `${sinkBase}/hook`, events: ["ROLE_*"], format: "JSON" } });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    await approve(sa, off.json.data.request_id);
    expect((await db.query("select enabled, version from integrations where id = $1", [id])).rows[0]).toMatchObject({ enabled: false, version: 2 });
    expect((await db.query("select secrets ? 'signingSecret' as kept from integrations where id = $1", [id])).rows[0].kept).toBe(true);
    await db.query("select write_audit(null, 'ROLE_UPDATED', 'role', $1)", [`api-off-${Date.now()}`]);
    hits.length = 0; await runJobs();
    expect(hits.filter((h) => h.body.includes("ROLE_UPDATED"))).toHaveLength(0);
  });

  it("removing it is a request too, and clears what was waiting", async () => {
    const admin = await as("admin@4core.local"); const sa = await as("superadmin@4core.local");
    const del = await admin.request("POST", "/api/v1/integrations/request", { action: "DELETE", id, reason: "api test cleanup" });
    expect(del.status).toBe(200);
    await approve(sa, del.json.data.request_id);
    expect((await db.query("select 1 from integrations where id = $1", [id])).rowCount).toBe(0);
  });
});

describe("email through an SMTP integration, end to end", () => {
  it("sends the test message, and then carries real mail instead of the server's own settings", async () => {
    const admin = await as("admin@4core.local"); const sa = await as("superadmin@4core.local");
    const name = unique();
    const body = { action: "CREATE", kind: "SMTP", name, enabled: true, reason: "api test",
      settings: { host: "127.0.0.1", port: smtpPort, security: "NONE", username: "mailer", fromName: "4CORE Test", fromAddress: "okr-test@example.com", baseUrl: "https://okr.example.com" }, secrets: { password: SMTP_PASSWORD } };
    const ask = await admin.request("POST", "/api/v1/integrations/request", body);
    expect(ask.status, JSON.stringify(ask.json)).toBe(200);
    expect(JSON.stringify(ask.json)).not.toContain(SMTP_PASSWORD);
    await approve(sa, ask.json.data.request_id);
    const id = (await db.query("select id from integrations where name = $1", [name])).rows[0].id as string;

    mails.length = 0;
    const t = await admin.request("POST", "/api/v1/integrations/test", { id });
    expect(t.json.data.ok, t.json.data.message).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain("To: admin@4core.local");                                                     // only ever to the person who asked
    expect(mails[0]).toContain("okr-test@example.com");

    const wrong = await admin.request("POST", "/api/v1/integrations/test", { kind: "SMTP", settings: body.settings, secrets: { password: "not-the-password-xyz" }, sendMail: false });
    expect(wrong.json.data.ok).toBe(false); expect(wrong.json.data.message).not.toContain("not-the-password-xyz");

    // a real queued message leaves through this server, with the link taken from the integration's own address
    const exec = (await db.query("select id from users where email = 'exec@4core.local'")).rows[0].id as string;
    const marker = `api-int-${Date.now()}`;
    await db.query("select notify_users(array[$1::uuid], 'PASSWORD_CHANGED', 'user', $3, $2, 'Test message body', $2)", [exec, `Password changed ${marker}`, marker]);
    mails.length = 0;
    // the outbox sends a limited batch per run, oldest first, so mail queued earlier may go first: run until ours has gone
    let transportName = ""; let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      const jobs = await runJobs(); transportName = jobs.data.email.transport;
      found = mails.some((m) => { const flat = m.replace(/=\r?\n/g, ""); return flat.includes(`Password changed ${marker}`) && flat.includes("https://okr.example.com/notifications"); });
    }
    expect(transportName).toMatch(/^smtp:127\.0\.0\.1/);
    expect(found).toBe(true);

    const del = await admin.request("POST", "/api/v1/integrations/request", { action: "DELETE", id, reason: "api test cleanup" });
    await approve(sa, del.json.data.request_id);
    expect((await db.query("select 1 from integrations where id = $1", [id])).rowCount).toBe(0);
  });
});

describe("an AI provider is stored and tested, and nothing else", () => {
  it("tests with a fixed harmless prompt using the saved, decrypted key; only one is in use at a time", async () => {
    const admin = await as("admin@4core.local"); const sa = await as("superadmin@4core.local");
    const name = unique();
    const ask = await admin.request("POST", "/api/v1/integrations/request", { action: "CREATE", kind: "ANTHROPIC", name, enabled: true, reason: "api test",
      settings: { model: "claude-sonnet-5-5", baseUrl: sinkBase }, secrets: { apiKey: APIKEY } });
    expect(ask.status, JSON.stringify(ask.json)).toBe(200);
    await approve(sa, ask.json.data.request_id);
    const id = (await db.query("select id from integrations where name = $1", [name])).rows[0].id as string;
    hits.length = 0;
    const t = await admin.request("POST", "/api/v1/integrations/test", { id });
    expect(t.json.data.ok, t.json.data.message).toBe(true);
    expect(hits[0].headers["x-api-key"]).toBe(APIKEY);                                                       // the saved key, decrypted
    expect(JSON.parse(hits[0].body).messages).toEqual([{ role: "user", content: "Reply with the single word OK." }]);
    expect(JSON.stringify((await admin.request("GET", "/api/v1/integrations")).json)).not.toContain(APIKEY);

    // a second provider cannot be switched on while one is in use: refused when asked, not left to fail at approval
    const second = await admin.request("POST", "/api/v1/integrations/request", { action: "CREATE", kind: "OPENAI_COMPATIBLE", name: unique(), enabled: true, reason: "api test", settings: { baseUrl: `${sinkBase}/v1`, model: "m" }, secrets: {} });
    expect(second.status).toBe(422); expect(JSON.stringify(second.json)).toMatch(/already enabled/);
    const later = await admin.request("POST", "/api/v1/integrations/request", { action: "CREATE", kind: "OPENAI_COMPATIBLE", name: unique(), enabled: false, reason: "api test", settings: { baseUrl: `${sinkBase}/v1`, model: "m" }, secrets: {} });
    expect(later.status).toBe(200);                                                                          // saved switched off is fine
    await sa.request("POST", `/api/v1/config-changes/${later.json.data.request_id}/decision`, { decision: "REJECT", comment: "only needed to prove the point", idempotencyKey: key() });

    const del = await admin.request("POST", "/api/v1/integrations/request", { action: "DELETE", id, reason: "api test cleanup" });
    await approve(sa, del.json.data.request_id);
    expect((await db.query("select 1 from integrations where id = $1", [id])).rowCount).toBe(0);
  });
});
