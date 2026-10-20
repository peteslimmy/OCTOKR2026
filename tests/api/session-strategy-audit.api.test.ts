/**
 * HTTP-level tests for session-outcome correction (ADR-063), strategy change control (ADR-064) and the audit of refused requests (ADR-067).
 * Needs a built app and a seeded database (`npm run dev:seed`). Authorisation and validation only: the workflows themselves are proven at
 * database level (tests/db/session_correction, strategy_change, access_denied_audit).
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

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

describe("session-outcome correction endpoints", () => {
  const calls = (): [string, string, unknown][] => [
    ["POST", `/api/v1/governance-sessions/${fake}/outcome-corrections`, { reason: "api test", idempotencyKey: key() }],
    ["POST", `/api/v1/governance-sessions/${fake}/emergency-outcome-correction`, { reason: "api test emergency reason", idempotencyKey: key(), confirm: true }],
    ["POST", `/api/v1/session-corrections/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() }],
    ["POST", `/api/v1/session-corrections/${fake}/execute`, { idempotencyKey: key() }],
  ];

  it("require sign-in, and the right permission for each step", async () => {
    for (const [m, p, b] of calls()) expect((await new Session().request(m, p, b)).status, p).toBe(401);
    expect((await new Session().request("GET", "/api/v1/session-corrections")).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "presenter@4core.local"]) {
      const s = await as(who);
      for (const [m, p, b] of calls()) expect((await s.request(m, p, b)).status, `${who} ${p}`).toBe(403);
    }
    const hr = await as("hr@4core.local");                                          // may ask, may not decide, execute or override
    expect((await hr.request("POST", `/api/v1/session-corrections/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(403);
    expect((await hr.request("POST", `/api/v1/session-corrections/${fake}/execute`, { idempotencyKey: key() })).status).toBe(403);
    expect((await hr.request("POST", `/api/v1/governance-sessions/${fake}/emergency-outcome-correction`, { reason: "api test emergency reason", idempotencyKey: key(), confirm: true })).status).toBe(403);
    expect((await hr.request("POST", `/api/v1/governance-sessions/${fake}/outcome-corrections`, { reason: "api test", idempotencyKey: key() })).status).toBe(404);
  });

  it("validate strictly and answer 404 for things that do not exist", async () => {
    const sa = await as("superadmin@4core.local");
    const post = (p: string, b: unknown) => sa.request("POST", p, b);
    expect((await post(`/api/v1/governance-sessions/${fake}/outcome-corrections`, { reason: " ", idempotencyKey: key() })).status).toBe(422);
    expect((await post(`/api/v1/governance-sessions/${fake}/outcome-corrections`, { reason: "x", idempotencyKey: "short" })).status).toBe(422);
    expect((await post(`/api/v1/governance-sessions/${fake}/outcome-corrections`, { reason: "x", idempotencyKey: key(), outcome: "HELD" })).status).toBe(422);   // no mass assignment
    expect((await post(`/api/v1/governance-sessions/${fake}/emergency-outcome-correction`, { reason: "too short", idempotencyKey: key(), confirm: true })).status).toBe(422);
    expect((await post(`/api/v1/governance-sessions/${fake}/emergency-outcome-correction`, { reason: "a long enough reason here", idempotencyKey: key() })).status).toBe(422);   // confirmation is required
    expect((await post(`/api/v1/governance-sessions/${fake}/emergency-outcome-correction`, { reason: "a long enough reason here", idempotencyKey: key(), confirm: true })).status).toBe(404);
    expect((await post(`/api/v1/session-corrections/${fake}/decision`, { decision: "MAYBE", idempotencyKey: key() })).status).toBe(422);
    expect((await post(`/api/v1/session-corrections/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(404);
    expect((await post(`/api/v1/session-corrections/${fake}/execute`, { idempotencyKey: key() })).status).toBe(404);
    expect((await sa.request("GET", "/api/v1/session-corrections")).status).toBe(200);
  });
});

describe("strategy change control endpoints", () => {
  const ask = { changeType: "EDIT", itemType: "KR", itemId: fake, title: "A new title", reason: "api test" };

  it("require sign-in, and the right permission for asking and for deciding", async () => {
    expect((await new Session().request("POST", "/api/v1/strategy/change-requests", { ...ask, idempotencyKey: key() })).status).toBe(401);
    expect((await new Session().request("POST", `/api/v1/strategy/change-requests/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "hr@4core.local", "presenter@4core.local"]) {
      const s = await as(who);
      expect((await s.request("POST", "/api/v1/strategy/change-requests", { ...ask, idempotencyKey: key() })).status, who).toBe(403);
      expect((await s.request("POST", `/api/v1/strategy/change-requests/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status, who).toBe(403);
    }
  });

  it("validate strictly and answer 404 or 422 for things that do not exist", async () => {
    const admin = await as("admin@4core.local");
    const post = (p: string, b: unknown) => admin.request("POST", p, b);
    expect((await post("/api/v1/strategy/change-requests", { ...ask, reason: " ", idempotencyKey: key() })).status).toBe(422);
    expect((await post("/api/v1/strategy/change-requests", { ...ask, changeType: "DELETE", idempotencyKey: key() })).status).toBe(422);        // retirement, never deletion
    expect((await post("/api/v1/strategy/change-requests", { ...ask, idempotencyKey: "short" })).status).toBe(422);
    expect((await post("/api/v1/strategy/change-requests", { ...ask, idempotencyKey: key(), status: "APPROVED" })).status).toBe(422);          // no mass assignment
    expect((await post(`/api/v1/strategy/change-requests/${fake}/decision`, { decision: "MAYBE", idempotencyKey: key() })).status).toBe(422);
    expect((await post(`/api/v1/strategy/change-requests/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(404);
    expect((await admin.request("GET", "/api/v1/strategy/change-requests")).status).toBe(422);                                                    // a quarter must be chosen
    expect((await admin.request("GET", `/api/v1/strategy/history?quarterId=${fake}`)).status).toBeLessThan(500);
  });
});

describe("refused requests are audited", () => {
  it("a Business Unit Lead refused on a restricted route leaves an ACCESS_DENIED row without identifiers or content", async () => {
    const lead = await as("lead.eng@4core.local");
    const secret = randomUUID();                       // the idempotency key: request content must never reach the audit row
    const r = await lead.request("POST", `/api/v1/governance-sessions/${fake}/skip-okr`, { confirm: true, idempotencyKey: secret });
    expect(r.status).toBe(403);
    const db = new Client({ connectionString: process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
    await db.connect();
    try {
      const rows = (await db.query(
        "select a.entity_id, a.outcome, a.new_values::text as nv from audit_logs a join users u on u.id = a.actor_user_id where a.action = 'ACCESS_DENIED' and u.email = $1 and a.entity_id like '%skip-okr%' order by a.seq desc limit 1",
        ["lead.eng@4core.local"])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe("DENIED");
      expect(rows[0].entity_id).toBe("/api/v1/governance-sessions/:id/skip-okr");
      expect(rows[0].nv).not.toContain(secret);
      expect(rows[0].nv).not.toContain(fake);
    } finally { await db.end(); }
  });
});
