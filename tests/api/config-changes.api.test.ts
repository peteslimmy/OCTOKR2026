/**
 * HTTP-level tests for configuration change approval (ADR-068).
 * Needs a built app and a seeded database (`npm run dev:seed`). Authorisation and validation only: the workflows themselves are proven at
 * database level (tests/db/config_change.test.ts).
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

describe("configuration change endpoints", () => {
  const code = `API${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const ask = (reason = "api test") => ({ topic: "VIOLATION_TYPE", target: code, proposed: { action: "CREATE", code, name: "API test type", criticality: "LOW", defaultFine: 700 }, reason, idempotencyKey: key() });

  it("require sign-in and the right permission", async () => {
    expect((await new Session().request("POST", "/api/v1/config-changes", ask())).status).toBe(401);
    expect((await new Session().request("GET", "/api/v1/config-changes")).status).toBe(401);
    expect((await new Session().request("POST", `/api/v1/config-changes/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(401);
    const lead = await as("lead.eng@4core.local");
    expect((await lead.request("POST", "/api/v1/config-changes", ask())).status).toBe(403);
    expect((await lead.request("POST", `/api/v1/config-changes/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(403);
    expect((await lead.request("POST", "/api/v1/config-changes/emergency", { ...ask("a long enough reason"), confirm: true })).status).toBe(403);
    const hr = await as("hr@4core.local");                                       // may ask for violation types, may not decide or override
    expect((await hr.request("POST", `/api/v1/config-changes/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(403);
    expect((await hr.request("POST", "/api/v1/config-changes/emergency", { ...ask("a long enough reason"), confirm: true })).status).toBe(403);
    expect((await hr.request("POST", "/api/v1/config-changes", { topic: "PENALTY_RATE", proposed: { rate: 0.1 }, reason: "x", idempotencyKey: key() })).status).toBe(403);
  });

  it("validate strictly", async () => {
    const hr = await as("hr@4core.local");
    expect((await hr.request("POST", "/api/v1/config-changes", { ...ask(), reason: " " })).status).toBe(422);
    expect((await hr.request("POST", "/api/v1/config-changes", { ...ask(), idempotencyKey: "short" })).status).toBe(422);
    expect((await hr.request("POST", "/api/v1/config-changes", { ...ask(), status: "APPLIED" })).status).toBe(422);          // no mass assignment
    expect((await hr.request("POST", "/api/v1/config-changes", { ...ask(), proposed: { action: "CREATE", code, name: "x", criticality: "LOW", defaultFine: -1 } })).status).toBe(422);
    expect((await hr.request("POST", "/api/v1/config-changes", { ...ask(), topic: "NOPE" })).status).toBe(422);
    const sa = await as("superadmin@4core.local");
    expect((await sa.request("POST", `/api/v1/config-changes/${fake}/decision`, { decision: "MAYBE", idempotencyKey: key() })).status).toBe(422);
    expect((await sa.request("POST", `/api/v1/config-changes/${fake}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(404);
    expect((await sa.request("POST", "/api/v1/config-changes/emergency", { ...ask("short"), confirm: true })).status).toBe(422);
    expect((await sa.request("POST", "/api/v1/config-changes/emergency", ask("a long enough reason"))).status).toBe(422);        // confirmation is required
  });

  it("ask, wait, approve by someone else; the requester cannot; replays are safe; violation types route through it", async () => {
    const hr = await as("hr@4core.local"); const admin = await as("admin@4core.local"); const sa = await as("superadmin@4core.local");
    const body = ask();
    const a = await hr.request("POST", "/api/v1/config-changes", body);
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.json.data).toMatchObject({ status: "PENDING", replayed: false });
    expect((await hr.request("POST", "/api/v1/config-changes", body)).json.data).toMatchObject({ replayed: true, request_id: a.json.data.request_id });
    expect((await admin.request("POST", "/api/v1/config-changes", ask())).status).toBe(409);                                  // one waiting request for that target
    const types = (await hr.request("GET", "/api/v1/violation-types")).json.data as { code: string }[];
    expect(types.some((t) => t.code === code)).toBe(false);                                                                   // asking changed nothing
    expect((await hr.request("POST", `/api/v1/config-changes/${a.json.data.request_id}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(403);
    expect((await admin.request("GET", "/api/v1/config-changes")).json.data.some((r: { id: string }) => r.id === a.json.data.request_id)).toBe(true);
    expect((await sa.request("POST", `/api/v1/config-changes/${a.json.data.request_id}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(200);
    expect(((await hr.request("GET", "/api/v1/violation-types")).json.data as { code: string }[]).some((t) => t.code === code)).toBe(true);
    expect((await sa.request("POST", `/api/v1/config-changes/${a.json.data.request_id}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(409);   // already decided

    // the old one-step route now asks instead of changing
    const direct = await hr.request("POST", "/api/v1/violation-types", { code: `${code}2`, name: "Second", criticality: "LOW", defaultFine: 100, reason: "api test" });
    expect(direct.status, JSON.stringify(direct.json)).toBe(200);
    expect(direct.json.data.status).toBe("PENDING");
    expect((await hr.request("POST", `/api/v1/config-changes/${direct.json.data.request_id}/withdraw`)).status).toBe(200);
    expect((await admin.request("POST", `/api/v1/config-changes/${direct.json.data.request_id}/withdraw`)).status).toBe(403);   // only the requester can withdraw
  });
});

describe("role endpoints", () => {
  const roleCode = `API_${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const body = (proposed: Record<string, unknown>, target: string | null = roleCode) => ({ topic: "ROLE_CHANGE", target, proposed, reason: "api test", idempotencyKey: key() });
  const create = (extra: Record<string, unknown> = {}) => ({ action: "CREATE", code: roleCode, name: "API role", description: null, permissions: ["reports.view"], requiresMfa: false, ...extra });

  it("list roles and permissions only for people who handle them", async () => {
    expect((await new Session().request("GET", "/api/v1/roles")).status).toBe(401);
    expect((await new Session().request("GET", "/api/v1/permissions")).status).toBe(401);
    const lead = await as("lead.eng@4core.local");
    expect((await lead.request("GET", "/api/v1/roles")).status).toBe(403);
    expect((await lead.request("GET", "/api/v1/permissions")).status).toBe(403);
    const admin = await as("admin@4core.local");
    const roles = (await admin.request("GET", "/api/v1/roles")).json.data as { code: string; permissions: string[]; members: number }[];
    expect(roles.map((r) => r.code)).toEqual(expect.arrayContaining(["ADMIN", "SUPER_ADMIN", "BU_LEAD", "HR", "FINANCE", "PRESENTER", "DIRECTOR", "EXECUTIVE"]));
    expect(roles.find((r) => r.code === "FINANCE")!.permissions).toContain("disbursement.approve");
    const perms = (await admin.request("GET", "/api/v1/permissions")).json.data as { code: string; protected: boolean }[];
    expect(perms.find((p) => p.code === "roles.manage")!.protected).toBe(true);
  });

  it("a role change is a request that follows the rules", async () => {
    const hr = await as("hr@4core.local"); const admin = await as("admin@4core.local"); const sa = await as("superadmin@4core.local");
    expect((await hr.request("POST", "/api/v1/config-changes", body(create()))).status).toBe(403);                                  // HR may not ask for roles
    expect((await admin.request("POST", "/api/v1/config-changes", body(create({ code: "bad code" }), "bad code"))).status).toBe(422);
    expect((await admin.request("POST", "/api/v1/config-changes", body(create({ permissions: ["no.such"] })))).status).toBe(422);
    expect((await admin.request("POST", "/api/v1/config-changes", body(create({ permissions: ["ledger.reversal.emergency"] })))).status).toBe(403);   // not held by an Admin
    const ok = await admin.request("POST", "/api/v1/config-changes", body(create()));
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.data).toMatchObject({ status: "PENDING", protected: false });
    expect(((await admin.request("GET", "/api/v1/roles")).json.data as { code: string }[]).some((r) => r.code === roleCode)).toBe(false);
    expect((await admin.request("POST", `/api/v1/config-changes/${ok.json.data.request_id}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(403);   // not your own
    expect((await sa.request("POST", `/api/v1/config-changes/${ok.json.data.request_id}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(200);
    const made = ((await admin.request("GET", "/api/v1/roles")).json.data as { id: string; code: string; permissions: string[] }[]).find((r) => r.code === roleCode)!;
    expect(made.permissions).toEqual(["reports.view"]);
    // a role code is fixed shape on the user routes; the database decides whether it exists
    expect((await admin.request("PUT", `/api/v1/users/${fake}/roles`, { roles: ["lower case"] })).status).toBe(422);
    // clean up: delete it again (nobody holds it)
    const del = await admin.request("POST", "/api/v1/config-changes", body({ action: "DELETE" }, made.id));
    expect(del.status).toBe(200);
    expect((await sa.request("POST", `/api/v1/config-changes/${del.json.data.request_id}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(200);
  });
});

describe("lock schedule endpoints", () => {
  const same = { contentLockDay: 2, contentLockTime: "18:00", contentLockWeekOffset: 0, finalLockDay: 2, finalLockTime: "11:00", finalLockWeekOffset: 1 };
  const ask = (proposed: Record<string, unknown>) => ({ topic: "LOCK_SCHEDULE", target: null, proposed, reason: "api test", idempotencyKey: key() });

  it("anyone signed in can read it; asking for a change needs the calendar permission and valid values", async () => {
    expect((await new Session().request("GET", "/api/v1/lock-schedule")).status).toBe(401);
    const lead = await as("lead.eng@4core.local");
    const view = (await lead.request("GET", "/api/v1/lock-schedule")).json.data;
    expect(view.active).toMatchObject({ content_lock_dow: 2, final_lock_dow: 2, final_lock_week_offset: 1 });
    expect(view.history.length).toBeGreaterThanOrEqual(1);
    expect((await lead.request("POST", "/api/v1/config-changes", ask({ ...same, contentLockTime: "17:00" }))).status).toBe(403);
    const hr = await as("hr@4core.local");
    expect((await hr.request("POST", "/api/v1/config-changes", ask({ ...same, contentLockTime: "17:00" }))).status).toBe(403);
    const admin = await as("admin@4core.local");
    expect((await admin.request("POST", "/api/v1/config-changes", ask(same))).status).toBe(422);                                  // already in force
    expect((await admin.request("POST", "/api/v1/config-changes", ask({ ...same, finalLockWeekOffset: 0, finalLockTime: "09:00" }))).status).toBe(422);
    expect((await admin.request("POST", "/api/v1/config-changes", ask({ ...same, contentLockDay: 8 }))).status).toBe(422);
    expect((await admin.request("GET", "/api/v1/lock-schedule")).json.data.active.version).toBe(view.active.version);               // nothing changed
  });
});
