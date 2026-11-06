/**
 * Generated authorisation sweep over EVERY API route (audit finding: the hand-written matrix covered 21 of 188 route-and-method pairs).
 * The routes are discovered from src/app/api at run time, so a new route is covered automatically and cannot be forgotten.
 *
 *   A. an anonymous caller is refused (401) everywhere except the few deliberately public routes;
 *   B. for every seeded role, no route crashes (5xx) on a blind request, and no mutating route accepts a blind request with a 2xx.
 *
 * "Blind" = fake ids and an empty body, so nothing real can be changed. Needs the built app and the seeded test stack:
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs route-authz
 * Set AUDIT_MATRIX_OUT=<file> to write the full role-by-route status table as JSON.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_ACCOUNTS, Session, loginAs } from "./session";

const FAKE = "11111111-1111-4111-8111-111111111111";
interface Endpoint { method: string; url: string; route: string }

function discover(): Endpoint[] {
  const out: Endpoint[] = [];
  const root = path.join(process.cwd(), "src", "app", "api");
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== "route.ts") continue;
      const src = readFileSync(p, "utf8");
      const rel = "/api/" + path.relative(root, path.dirname(p)).split(path.sep).join("/");
      const url = rel.replace(/\/$/, "").replace(/\[entity\]/g, "employees").replace(/\[[^\]]+\]/g, FAKE);
      for (const m of src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)) out.push({ method: m[1], url, route: `${rel} ` + m[1] });
    }
  })(root);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}
const ENDPOINTS = discover();

/** Deliberately reachable without a session: the sign-in and forgot-password entry points and the unauthenticated liveness probe. */
const PUBLIC = new Set(["/api/v1/auth/login POST", "/api/v1/auth/password/forgot POST", "/api/health GET"]);
/** Answered by their own secret/token instead of a session (anonymous = 401 because the secret is missing). */
const SECRET_PROTECTED = new Set(["/api/internal/health GET", "/api/internal/jobs/run POST", "/api/metrics GET"]);
/** Would change the signed-in test account itself (sign out, enrol, disable or re-issue its second factor), breaking later requests. Not swept in B. */
const SELF_AFFECTING = [/^\/api\/v1\/auth\/logout /, /^\/api\/v1\/auth\/mfa\//, /^\/api\/v1\/auth\/password\//];
/**
 * Accepted (2xx) when sent blind, each for a reason that was checked in the code:
 *  - notifications/read-all and notifications/[id]/read: the update is limited to the caller's own rows by row-level security, so an unknown id changes nothing;
 *  - weekly-reports/[id]/edit-session DELETE: releases only the caller's own edit lease; releasing one that does not exist is a no-op;
 *  - site/images/[slot] DELETE: permission-checked in the database (only the admin roles get 2xx; the other roles are refused), and deleting an empty slot is a no-op.
 */
const BLIND_2XX_OK = new Set([
  "/api/v1/notifications/read-all POST",
  "/api/v1/notifications/[id]/read POST",
  "/api/v1/weekly-reports/[id]/edit-session DELETE",
  "/api/v1/site/images/[slot] DELETE",
  "/api/v1/audit/verify POST",   // read-only integrity check of the audit chain; it changes nothing
]);

const mutating = (m: string) => m !== "GET";
const blindBody = (m: string) => (mutating(m) ? {} : undefined);

describe(`generated authorisation sweep over ${ENDPOINTS.length} route-and-method pairs`, () => {
  it("discovers a sensible number of routes", () => {
    expect(ENDPOINTS.length).toBeGreaterThan(150);
  });

  it("A. refuses an anonymous caller on every route that is not deliberately public", async () => {
    const anon = new Session();
    const wrong: string[] = [];
    for (const e of ENDPOINTS) {
      if (PUBLIC.has(e.route)) continue;
      const r = await anon.request(e.method, e.url, blindBody(e.method));
      if (r.status !== 401) wrong.push(`${e.route} -> ${r.status}`);
    }
    expect(wrong, "routes that did not answer 401 to an anonymous request").toEqual([]);
  }, 300_000);

  it("A2. the public routes answer an empty request with a validation error, never a crash or a session", async () => {
    const anon = new Session();
    for (const route of ["/api/v1/auth/login", "/api/v1/auth/password/forgot"]) {
      const r = await anon.request("POST", route, {});
      expect(r.status, route).toBe(422);
    }
    expect((await anon.request("GET", "/api/health")).status).toBe(200);
  });

  it("B. for every role, no route crashes and no mutating route accepts a blind request", async () => {
    const crashes: string[] = [];
    const accepted: string[] = [];
    const table: Record<string, Record<string, number>> = {};
    // one task per role, run in parallel: each has its own session and the requests are blind (they change nothing)
    await Promise.all(Object.keys(ROLE_ACCOUNTS).map(async (email) => {
      const s = await loginAs(email);
      for (const e of ENDPOINTS) {
        if (PUBLIC.has(e.route) || SECRET_PROTECTED.has(e.route) || SELF_AFFECTING.some((re) => re.test(e.route))) continue;
        const r = await s.request(e.method, e.url, blindBody(e.method));
        (table[e.route] ??= {})[email] = r.status;
        if (r.status >= 500) crashes.push(`${email} ${e.route} -> ${r.status} ${r.json.error?.code ?? ""}`);
        if (mutating(e.method) && r.status >= 200 && r.status < 300 && !BLIND_2XX_OK.has(e.route)) accepted.push(`${email} ${e.route} -> ${r.status}`);
      }
    }));
    if (process.env.AUDIT_MATRIX_OUT) writeFileSync(process.env.AUDIT_MATRIX_OUT, JSON.stringify({ generatedBy: "tests/api/route-authz.api.test.ts", roles: ROLE_ACCOUNTS, statuses: table }, null, 1));
    expect(crashes, "requests that crashed the server (5xx)").toEqual([]);
    expect(accepted, "mutating requests with fake ids and an empty body that were accepted (2xx)").toEqual([]);
  }, 900_000);
});
