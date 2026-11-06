/**
 * A table-driven authorisation test (docs/30 Q-3): for every person and every guarded endpoint listed, the answer must follow the permissions the roles hold.
 * Needs a built app and a seeded database (`npm run dev:seed`). Authorisation and validation only: the workflows themselves are proven at
 * database level. The permissions come from tests/db/fixtures/role-matrix.json, the approved matrix of the shipped roles.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
const fake = "11111111-1111-4111-8111-111111111111";

const matrix = JSON.parse(readFileSync(path.join(__dirname, "..", "db", "fixtures", "role-matrix.json"), "utf8")) as Record<string, string[]>;
/** The seeded people and the roles they hold (a person's permissions are the union of their roles'). */
const PEOPLE: Record<string, string[]> = {
  "admin@4core.local": ["ADMIN"], "superadmin@4core.local": ["SUPER_ADMIN"], "hr@4core.local": ["HR", "BU_LEAD"], "finance@4core.local": ["FINANCE", "BU_LEAD"],
  "lead.eng@4core.local": ["BU_LEAD"], "presenter@4core.local": ["PRESENTER"], "director@4core.local": ["DIRECTOR"], "exec@4core.local": ["EXECUTIVE"],
};
const permsOf = (email: string) => new Set(PEOPLE[email].flatMap((r) => matrix[r]));

interface Guarded { method: "GET" | "POST"; path: string; body?: unknown; any: string[]; label: string }
const k = () => ({ idempotencyKey: randomUUID() });
const GUARDED: Guarded[] = [
  { method: "GET", path: "/api/v1/audit", any: ["audit.read"], label: "audit log" },
  { method: "GET", path: "/api/v1/audit/export", any: ["audit.read"], label: "audit export" },
  { method: "GET", path: "/api/v1/finance/ledger", any: ["finance.ledger.view"], label: "ledger" },
  { method: "GET", path: "/api/v1/finance/fund", any: ["finance.fund.view"], label: "fund summary" },
  { method: "GET", path: "/api/v1/roles", any: ["users.manage", "roles.request", "roles.manage", "config.approve"], label: "roles list" },
  { method: "GET", path: "/api/v1/permissions", any: ["users.manage", "roles.request", "roles.manage", "config.approve"], label: "permissions list" },
  { method: "POST", path: `/api/v1/session-corrections/${fake}/decision`, body: { decision: "APPROVE", ...k() }, any: ["attendance.session.outcome.approve"], label: "decide a session correction" },
  { method: "POST", path: `/api/v1/session-corrections/${fake}/execute`, body: k(), any: ["attendance.session.outcome.correct"], label: "execute a session correction" },
  { method: "POST", path: `/api/v1/governance-sessions/${fake}/emergency-outcome-correction`, body: { reason: "a long enough reason", ...k(), confirm: true }, any: ["attendance.session.outcome.emergency"], label: "emergency session correction" },
  { method: "POST", path: `/api/v1/ledger-reversals/${fake}/decision`, body: { decision: "APPROVE", ...k() }, any: ["ledger.reversal.approve"], label: "decide a ledger reversal" },
  { method: "POST", path: `/api/v1/ledger-reversals/${fake}/execute`, body: k(), any: ["ledger.reversal.execute"], label: "post a ledger reversal" },
  { method: "POST", path: `/api/v1/ledger-entries/${fake}/emergency-reversal`, body: { reason: "a long enough reason", ...k(), confirm: true }, any: ["ledger.reversal.emergency"], label: "emergency ledger reversal" },
  { method: "POST", path: `/api/v1/disbursement-requests/${fake}/approve`, body: k(), any: ["disbursement.approve"], label: "approve a disbursement" },
  { method: "POST", path: `/api/v1/strategy/change-requests/${fake}/decision`, body: { decision: "APPROVE", ...k() }, any: ["strategy.change.approve"], label: "decide a strategy change" },
  { method: "POST", path: `/api/v1/config-changes/${fake}/decision`, body: { decision: "APPROVE", ...k() }, any: ["config.approve", "config.protected.approve"], label: "decide a configuration change" },
  { method: "POST", path: "/api/v1/config-changes/emergency", body: { topic: "PENALTY_RATE", target: null, proposed: { rate: 0.5 }, reason: "a long enough reason", ...k(), confirm: true }, any: ["config.emergency"], label: "emergency configuration change" },
  { method: "POST", path: `/api/v1/users/${fake}/mfa-reset`, body: { reason: "api test" }, any: ["users.manage"], label: "reset someone's authenticator" },
  { method: "GET", path: "/api/v1/integrations", any: ["integrations.view"], label: "integrations list" },
  { method: "POST", path: "/api/v1/integrations/request", body: { action: "DELETE", id: fake, reason: "api test" }, any: ["integrations.configure"], label: "ask to change an integration" },
  { method: "POST", path: "/api/v1/integrations/test", body: { id: fake }, any: ["integrations.test"], label: "test an integration" },
];

describe("who may call what, from the approved permission matrix", () => {
  for (const email of Object.keys(PEOPLE)) {
    it(`${email} (${PEOPLE[email].join(" + ")})`, async () => {
      const held = permsOf(email);
      const s = await as(email);
      const wrong: string[] = [];
      for (const g of GUARDED) {
        const r = await s.request(g.method, g.path, g.body);
        const allowed = g.any.some((p) => held.has(p));
        if (allowed && (r.status === 403 || r.status === 401)) wrong.push(`${g.label}: should be allowed, got ${r.status}`);
        if (!allowed && r.status !== 403) wrong.push(`${g.label}: should be refused (403), got ${r.status}`);
      }
      expect(wrong).toEqual([]);
    });
  }
});
