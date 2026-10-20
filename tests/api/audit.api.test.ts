/**
 * HTTP-level tests for the audit log: filters, paging and export (ADR-072).
 * Needs a built app and a seeded database (`npm run dev:seed`). Authorisation and validation only: the workflows themselves are proven at
 * database level (tests/db/retention.test.ts).
 */
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
  /** The raw response, for files. */
  async raw(path: string) {
    return fetch(`${BASE}${path}`, { redirect: "manual", headers: { "x-forwarded-for": this.ip, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  }
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

describe("audit log endpoints", () => {
  it("need the audit permission", async () => {
    expect((await new Session().request("GET", "/api/v1/audit")).status).toBe(401);
    expect((await new Session().request("GET", "/api/v1/audit/export")).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "hr@4core.local", "presenter@4core.local"]) {
      const s = await as(who);
      expect((await s.request("GET", "/api/v1/audit")).status, who).toBe(403);
      expect((await s.request("GET", "/api/v1/audit/export")).status, who).toBe(403);
    }
  });

  it("pages newest first without repeating or skipping, and filters", async () => {
    const admin = await as("admin@4core.local");
    const first = (await admin.request("GET", "/api/v1/audit?limit=5")).json.data;
    expect(first.rows).toHaveLength(5);
    expect(first.nextCursor).toBe(String(first.rows[4].seq));
    const seqs = first.rows.map((r: { seq: number }) => r.seq);
    expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
    const second = (await admin.request("GET", `/api/v1/audit?limit=5&cursor=${first.nextCursor}`)).json.data;
    expect(second.rows.every((r: { seq: number }) => r.seq < first.rows[4].seq)).toBe(true);
    expect(second.rows.map((r: { id: string }) => r.id).filter((id: string) => first.rows.some((f: { id: string }) => f.id === id))).toEqual([]);
    expect((await admin.request("GET", "/api/v1/audit?limit=5&cursor=not-a-number")).json.data.rows).toHaveLength(5);          // a bad cursor is ignored, not trusted
    expect((await admin.request("GET", "/api/v1/audit?limit=100000")).json.data.rows.length).toBeLessThanOrEqual(500);          // capped

    const byAction = (await admin.request("GET", "/api/v1/audit?action=user_&limit=50")).json.data.rows as { action: string }[];
    expect(byAction.length).toBeGreaterThan(0);
    expect(byAction.every((r) => r.action.toUpperCase().startsWith("USER_"))).toBe(true);
    const none = (await admin.request("GET", "/api/v1/audit?action=NO_SUCH_ACTION_XYZ")).json.data;
    expect(none).toEqual({ rows: [], nextCursor: null });
    const future = (await admin.request("GET", "/api/v1/audit?from=2999-01-01")).json.data.rows;
    expect(future).toEqual([]);
    const injected = await admin.request("GET", "/api/v1/audit?q=" + encodeURIComponent("x),action.neq.zzz,(y"));                 // characters that mean something to the filter language are dropped
    expect(injected.status).toBe(200);
  });

  it("exports a CSV with the same filters and records that it did", async () => {
    const admin = await as("admin@4core.local");
    const res = await admin.raw("/api/v1/audit/export?action=USER_");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/audit-log_\d{12}\.csv/);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toBe("seq,occurred_at,actor_role,actor_user_id,action,entity_type,entity_id,outcome,reason,correlation_id,old_values,new_values");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((l) => /^\d+,/.test(l) || l.startsWith('"'))).toBe(true);
    const log = (await admin.request("GET", "/api/v1/audit?action=AUDIT_EXPORTED&limit=1")).json.data.rows[0];
    expect(log.new_values.filter.action).toBe("USER_");
    expect(log.new_values.rows).toBe(lines.length - 1);
  });
});
