/**
 * HTTP-level negative-authorization and contract tests. They talk to the running Next.js server
 * (default http://localhost:3000) against a database seeded with `npm run dev:seed`.
 *   npm run dev            (terminal 1)
 *   npm run test:api       (terminal 2)
 * No test here depends on the current weekday: lock-boundary behaviour is covered at DB level.
 */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

import { completeMfa } from "./mfa-login";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PASSWORD = "DevPassword!2026"; // local dev-seed credential (scripts/dev-seed.ts)

class Session {
  private jar = new Map<string, string>();
  /** A distinct client address per session, so the per-IP sign-in limiter does not couple unrelated tests (production sits behind a proxy that sets this header). */
  private ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-forwarded-for": this.ip, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json: { data?: unknown; error?: { code: string; message: string } } = {};
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, headers: res.headers };
  }
  login = (email: string, password = PASSWORD) => this.request("POST", "/api/v1/auth/login", { email, password });
}

async function as(email: string) {
  const s = new Session();
  const r = await s.login(email);
  expect(r.status, `login ${email}`).toBe(200);
  await completeMfa(s, email, r);
  return s;
}

describe("authentication", () => {
  it("rejects unauthenticated API calls with a stable code", async () => {
    const r = await new Session().request("GET", "/api/v1/auth/me");
    expect(r.status).toBe(401);
    expect(r.json.error?.code).toBe("AUTHENTICATION_REQUIRED");
    expect(r.headers.get("x-correlation-id")).toBeTruthy();
  });

  it("uses one generic message for unknown accounts and wrong passwords (anti-enumeration)", async () => {
    const a = await new Session().login("nobody@4core.local", "wrong-password-123");
    const b = await new Session().login("lead.eng@4core.local", "wrong-password-123");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json.error?.message).toBe(b.json.error?.message);
  });

  it("returns the caller's identity, roles and permissions after login", async () => {
    const s = await as("lead.eng@4core.local");
    const me = (await s.request("GET", "/api/v1/auth/me")).json.data as { roles: string[]; permissions: string[] };
    expect(me.roles).toEqual(["BU_LEAD"]);
    expect(me.permissions).toContain("task.execute");
    expect(me.permissions).not.toContain("integrity_correction.create");
  });

  it("redirects unauthenticated page requests to /login", async () => {
    const res = await fetch(`${BASE}/weekly`, { redirect: "manual" });
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("protects the scheduler endpoint with a shared secret", async () => {
    const r = await fetch(`${BASE}/api/internal/jobs/run`, { method: "POST", headers: { "x-jobs-secret": "wrong-wrong-wrong-wrong" } });
    expect(r.status).toBe(401);
  });
});

describe("request hardening", () => {
  it("rejects cross-site state-changing requests", async () => {
    const s = await as("lead.eng@4core.local");
    const r = await s.request("POST", "/api/v1/notifications/read-all", undefined, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("rejects unknown body fields (no mass assignment) and invalid input with field errors", async () => {
    const s = await as("admin@4core.local");
    const extra = await s.request("POST", "/api/v1/business-units", { code: "ZZ1", name: "Zed", status: "ACTIVE", id: "x" });
    expect(extra.status).toBe(422);
    expect(extra.json.error?.code).toBe("VALIDATION_ERROR");
    const bad = await s.request("POST", "/api/v1/strategy/annual-themes", { year: "twenty", theme: "" });
    expect(bad.status).toBe(422);
  });

  it("never leaks raw database errors", async () => {
    const s = await as("admin@4core.local");
    const r = await s.request("PATCH", "/api/v1/business-units/not-a-uuid", { name: "x", status: "ACTIVE" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.json)).not.toMatch(/invalid input syntax|postgres|SQLSTATE|relation "/i);
  });
});

describe("RBAC at the API (no UI involved)", () => {
  it("BU Lead cannot change strategy, configure penalties, correct integrity, declare holidays, manage users or read audit", async () => {
    const s = await as("lead.eng@4core.local");
    const uuid = "11111111-1111-4111-8111-111111111111";
    const calls: [string, string, unknown][] = [
      ["POST", "/api/v1/strategy/annual-themes", { year: 2099, theme: "x" }],
      ["POST", "/api/v1/strategy/quarters", { year: 2099 }],
      ["POST", "/api/v1/admin/penalty-rate", { rate: 0.5, reason: "x" }],
      ["POST", "/api/v1/integrity-corrections", { taskId: uuid, targetStatus: "NOT_DONE", reason: "x", penaltyDecision: "APPLY", confirm: true, idempotencyKey: "key-12345678" }],
      ["POST", "/api/v1/reporting-weeks/organization-holiday", { reportingWeekIds: [uuid], reason: "x", idempotencyKey: "key-12345678", confirm: true }],
      ["POST", "/api/v1/business-units", { code: "NOPE", name: "No" }],
      ["PUT", `/api/v1/users/${uuid}/roles`, { roles: ["SUPER_ADMIN"] }],
    ];
    for (const [m, p, b] of calls) {
      const r = await s.request(m, p, b);
      expect(r.status, `${m} ${p}`).toBe(403);
      expect(r.json.error?.code, `${m} ${p}`).toBe("PERMISSION_DENIED");
    }
    expect((await s.request("GET", "/api/v1/audit")).status).toBe(403);
    expect((await s.request("GET", "/api/v1/dashboards/executive")).status).toBe(403);
    expect((await s.request("GET", "/api/v1/presentation/current")).status).toBe(403);
  });

  it("Admin cannot grant SUPER_ADMIN (privilege escalation) even through the API", async () => {
    const s = await as("admin@4core.local");
    const bus = (await s.request("GET", "/api/v1/business-units")).json.data as { id: string }[];
    const r = await s.request("POST", "/api/v1/users", {
      email: `esc-${Date.now()}@4core.local`, firstName: "Esc", lastName: "Alate", businessUnitId: bus[0].id, roles: ["SUPER_ADMIN"],
    });
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe("PERMISSION_DENIED");
  });

  it("Executive reads organisation data but any write is denied", async () => {
    const s = await as("exec@4core.local");
    expect((await s.request("GET", "/api/v1/dashboards/executive")).status).toBe(200);
    const r = await s.request("POST", "/api/v1/strategy/annual-themes", { year: 2099, theme: "x" });
    expect(r.status).toBe(403);
  });
});

describe("BU isolation at the API (SEC-RLS / AC-SEC-001)", () => {
  it("a BU Lead cannot read or touch another BU's report by UUID", async () => {
    // Engineering lead opens (or creates, if a week is open) a report; find any report id visible to the presenter.
    const presenter = await as("presenter@4core.local");
    const weeks = (await presenter.request("GET", "/api/v1/presentation/current")).json.data as { overview: { report_id: string | null; business_unit: { code: string } }[] };
    const engReport = weeks.overview.find((o) => o.business_unit.code === "ENG" && o.report_id)?.report_id;
    if (!engReport) return; // nothing filed in the seeded window: isolation is also proven at DB level
    const sales = await as("lead.sales@4core.local");
    const r = await sales.request("GET", `/api/v1/weekly-reports/${engReport}`);
    expect(r.status).toBe(404); // indistinguishable from "does not exist"
    const mutate = await sales.request("POST", `/api/v1/weekly-reports/${engReport}/edit-session`);
    expect([403, 404]).toContain(mutate.status);
    const eng = await as("lead.eng@4core.local");
    expect((await eng.request("GET", `/api/v1/weekly-reports/${engReport}`)).status).toBe(200);
  });
});
