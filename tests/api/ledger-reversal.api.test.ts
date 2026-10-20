/**
 * HTTP-level tests for the ledger reversal (ADR-059). Needs `npm run dev` and a seeded database (`npm run dev:seed`).
 * Authorisation and validation only: the workflow itself is proven at database level (tests/db/ledger_reversal.test.ts).
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
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

describe("ledger reversal endpoints", () => {
  const calls = (): [string, string, unknown][] => [
    ["POST", `/api/v1/ledger-entries/${fake}/reversal-requests`, { reason: "api test", idempotencyKey: key() }],
    ["POST", `/api/v1/ledger-entries/${fake}/emergency-reversal`, { reason: "api test emergency reason", idempotencyKey: key(), confirm: true }],
    ["POST", `/api/v1/ledger-reversals/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() }],
    ["POST", `/api/v1/ledger-reversals/${fake}/execute`, { idempotencyKey: key() }],
  ];

  it("require sign-in, and the right permission for each step", async () => {
    for (const [m, p, b] of calls()) expect((await new Session().request(m, p, b)).status, p).toBe(401);
    expect((await new Session().request("GET", "/api/v1/ledger-reversals")).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "hr@4core.local", "presenter@4core.local"]) {
      const s = await as(who);
      for (const [m, p, b] of calls()) expect((await s.request(m, p, b)).status, `${who} ${p}`).toBe(403);
      expect((await s.request("GET", "/api/v1/ledger-reversals")).status, who).toBe(403);
    }
    const admin = await as("admin@4core.local");                                   // may ask, may not approve, post or override
    expect((await admin.request("POST", `/api/v1/ledger-reversals/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(403);
    expect((await admin.request("POST", `/api/v1/ledger-reversals/${fake}/execute`, { idempotencyKey: key() })).status).toBe(403);
    expect((await admin.request("POST", `/api/v1/ledger-entries/${fake}/emergency-reversal`, { reason: "api test emergency reason", idempotencyKey: key(), confirm: true })).status).toBe(403);
    expect((await admin.request("POST", `/api/v1/ledger-entries/${fake}/reversal-requests`, { reason: "api test", idempotencyKey: key() })).status).toBe(404);
  });

  it("validate strictly and answer 404 for things that do not exist", async () => {
    const sa = await as("superadmin@4core.local");
    const post = (p: string, b: unknown) => sa.request("POST", p, b);
    expect((await post(`/api/v1/ledger-entries/${fake}/reversal-requests`, { reason: " ", idempotencyKey: key() })).status).toBe(422);
    expect((await post(`/api/v1/ledger-entries/${fake}/reversal-requests`, { reason: "x", idempotencyKey: "short" })).status).toBe(422);
    expect((await post(`/api/v1/ledger-entries/${fake}/reversal-requests`, { reason: "x", idempotencyKey: key(), amount: 1 })).status).toBe(422);   // no mass assignment
    expect((await post(`/api/v1/ledger-entries/${fake}/emergency-reversal`, { reason: "too short", idempotencyKey: key(), confirm: true })).status).toBe(422);
    expect((await post(`/api/v1/ledger-entries/${fake}/emergency-reversal`, { reason: "a long enough reason here", idempotencyKey: key() })).status).toBe(422);   // confirmation is required
    expect((await post(`/api/v1/ledger-entries/${fake}/emergency-reversal`, { reason: "a long enough reason here", idempotencyKey: key(), confirm: true })).status).toBe(404);
    expect((await post(`/api/v1/ledger-reversals/${fake}/decision`, { decision: "MAYBE", idempotencyKey: key() })).status).toBe(422);
    expect((await post(`/api/v1/ledger-reversals/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(404);
    expect((await post(`/api/v1/ledger-reversals/${fake}/execute`, { idempotencyKey: key() })).status).toBe(404);
    expect((await sa.request("GET", "/api/v1/ledger-reversals")).status).toBe(200);
  });
});
