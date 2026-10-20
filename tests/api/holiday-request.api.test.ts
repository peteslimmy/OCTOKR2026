/**
 * HTTP-level tests for the two-person holiday amendment requests (ADR-058). Needs `npm run dev` and a seeded database (`npm run dev:seed`).
 * Authorisation and validation only: the workflow itself is proven at database level (tests/db/holiday_two_person.test.ts).
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
const req = () => ({ direction: "DECLARE", reason: "api test", idempotencyKey: key(), confirm: true });
const dec = () => ({ decision: "APPROVE", idempotencyKey: key() });

describe("holiday amendment requests", () => {
  it("require sign-in and quarter.score.amend on every endpoint", async () => {
    expect((await new Session().request("GET", "/api/v1/holiday-amendment-requests")).status).toBe(401);
    expect((await new Session().request("POST", `/api/v1/reporting-weeks/${fake}/holiday-amendment-request`, req())).status).toBe(401);
    expect((await new Session().request("POST", `/api/v1/holiday-amendment-requests/${fake}/decision`, dec())).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "presenter@4core.local", "hr@4core.local"]) {
      const s = await as(who);
      expect((await s.request("POST", `/api/v1/reporting-weeks/${fake}/holiday-amendment-request`, req())).status, who).toBe(403);
      expect((await s.request("POST", `/api/v1/holiday-amendment-requests/${fake}/decision`, dec())).status, who).toBe(403);
      const list = await s.request("GET", "/api/v1/holiday-amendment-requests");
      expect(list.status === 403 || (list.status === 200 && list.json.data.length === 0), who).toBe(true);   // RLS shows them nothing
    }
  });

  it("validate strictly and say plainly when something does not exist", async () => {
    const admin = await as("admin@4core.local");
    const url = `/api/v1/reporting-weeks/${fake}/holiday-amendment-request`;
    for (const bad of [{ ...req(), direction: "TOGGLE" }, { ...req(), reason: " " }, { ...req(), idempotencyKey: "short" }, { ...req(), confirm: false }, { ...req(), extra: 1 }]) {
      expect((await admin.request("POST", url, bad)).status).toBe(422);
    }
    expect((await admin.request("POST", url, req())).status).toBe(404);
    expect((await admin.request("POST", `/api/v1/holiday-amendment-requests/${fake}/decision`, dec())).status).toBe(404);
    for (const bad of [{ ...dec(), decision: "MAYBE" }, { ...dec(), idempotencyKey: "x" }, { ...dec(), extra: true }]) {
      expect((await admin.request("POST", `/api/v1/holiday-amendment-requests/${fake}/decision`, bad)).status).toBe(422);
    }
    expect((await admin.request("GET", "/api/v1/holiday-amendment-requests")).status).toBe(200);
  });
});
