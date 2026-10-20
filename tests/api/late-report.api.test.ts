/**
 * HTTP-level tests for the late-report score amendment (milestone 3). Needs `npm run dev` and a seeded database (`npm run dev:seed`).
 * Authorisation and validation only: the amendment workflow itself is proven at database level (tests/db/late_report.test.ts).
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
const body = () => ({ businessUnitId: fake, reportingWeekId: fake, reason: "api test", idempotencyKey: key() });

describe("late-report score amendment (milestone 3)", () => {
  it("is unavailable to anonymous callers and to roles without quarter.score.amend", async () => {
    expect((await new Session().request("GET", "/api/v1/late-report-exceptions")).status).toBe(401);
    expect((await new Session().request("POST", "/api/v1/late-report-exceptions", body())).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "presenter@4core.local", "hr@4core.local", "finance@4core.local"]) {
      const s = await as(who);
      expect((await s.request("POST", "/api/v1/late-report-exceptions", body())).status, who).toBe(403);
      expect((await s.request("POST", `/api/v1/late-report-exceptions/${fake}/apply`, { reason: "x", idempotencyKey: key() })).status, who).toBe(403);
      expect((await s.request("POST", `/api/v1/late-report-exceptions/${fake}/revoke`, { reason: "x" })).status, who).toBe(403);
    }
  });

  it("validates strictly: blank reason, short key, missing reason and unknown fields are rejected; unknown ids are 404", async () => {
    const admin = await as("admin@4core.local");
    expect((await admin.request("POST", "/api/v1/late-report-exceptions", { ...body(), reason: "  " })).status).toBe(422);
    expect((await admin.request("POST", "/api/v1/late-report-exceptions", { ...body(), idempotencyKey: "x" })).status).toBe(422);
    expect((await admin.request("POST", "/api/v1/late-report-exceptions", { ...body(), status: "APPLIED", authorisedBy: fake })).status).toBe(422); // no mass assignment
    expect((await admin.request("POST", `/api/v1/late-report-exceptions/${fake}/apply`, { idempotencyKey: key() })).status).toBe(422);
    expect((await admin.request("POST", "/api/v1/late-report-exceptions", body())).status).toBe(404);
    expect((await admin.request("POST", `/api/v1/late-report-exceptions/${fake}/apply`, { reason: "x", idempotencyKey: key() })).status).toBe(404);
  });

  it("BU Leads see at most their own BU's exceptions", async () => {
    const lead = await as("lead.eng@4core.local");
    const list = (await lead.request("GET", "/api/v1/late-report-exceptions")).json.data as { business_unit: string }[];
    expect(new Set(list.map((x) => x.business_unit)).size).toBeLessThanOrEqual(1);
  });
});

describe("holiday amendment (milestone 3b)", () => {
  const amend = (s: Session, id: string, b: Record<string, unknown>) => s.request("POST", `/api/v1/reporting-weeks/${id}/holiday-amendment`, b);
  const ok = () => ({ direction: "DECLARE", reason: "api test", idempotencyKey: key(), confirm: true });

  it("requires authentication and quarter.score.amend (holiday.manage alone is not enough)", async () => {
    expect((await amend(new Session(), fake, ok())).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "presenter@4core.local", "hr@4core.local", "finance@4core.local"]) {
      expect((await amend(await as(who), fake, ok())).status, who).toBe(403);
    }
    expect((await (await as("hr@4core.local")).request("GET", "/api/v1/holiday-amendments")).json.data ?? []).toEqual([]);
  });

  it("validates strictly: confirmation, direction, reason, unknown fields; unknown week is 404", async () => {
    const admin = await as("admin@4core.local");
    expect((await amend(admin, fake, { ...ok(), confirm: false })).status).toBe(422);
    expect((await amend(admin, fake, { ...ok(), direction: "TOGGLE" })).status).toBe(422);
    expect((await amend(admin, fake, { ...ok(), reason: " " })).status).toBe(422);
    expect((await amend(admin, fake, { ...ok(), reportingState: "NORMAL" })).status).toBe(422);
    expect((await amend(admin, fake, ok())).status).toBe(404);
  });
});
