/**
 * What each role actually RECEIVES from the read routes (not just the status code): found by the generated authorisation sweep, which showed
 * many list routes answering 200 to every role. Row-level security decides the rows, so the content must be checked.
 *
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs read-scope
 */
import { describe, expect, it } from "vitest";
import { ROLE_ACCOUNTS, loginAs } from "./session";

const emails = Object.keys(ROLE_ACCOUNTS);
const asRoles = (...roles: string[]) => emails.filter((e) => ROLE_ACCOUNTS[e].some((r) => roles.includes(r)));
const get = async (email: string, route: string) => (await loginAs(email)).request("GET", route);
const rows = (r: { json: { data?: unknown } }) => (Array.isArray(r.json.data) ? (r.json.data as unknown[]).length : -1);

describe("read routes return only what each role may see", () => {
  it("the history-import list works for the Super Admin and is refused to everyone else (it refused everyone before the fix)", async () => {
    for (const e of emails) {
      const r = await get(e, "/api/v1/history-imports");
      if (ROLE_ACCOUNTS[e].includes("SUPER_ADMIN")) expect(r.status, e).toBe(200);
      else expect(r.status, e).toBe(403);
    }
  });

  it("the audit log is readable only by the Admin and Super Admin", async () => {
    for (const e of emails) {
      const r = await get(e, "/api/v1/audit");
      expect(r.status, e).toBe(asRoles("ADMIN", "SUPER_ADMIN").includes(e) ? 200 : 403);
    }
  });

  it("violation types are visible to the roles that manage violations and hidden (empty) from the rest", async () => {
    const allowed = new Set(asRoles("HR", "ADMIN", "SUPER_ADMIN"));
    for (const e of emails) {
      const r = await get(e, "/api/v1/violation-types");
      expect(r.status, e).toBe(200);
      if (allowed.has(e)) expect(rows(r), e).toBeGreaterThan(0); else expect(rows(r), e).toBe(0);
    }
  });

  it("a BU Lead or Finance user sees only their own business unit's people; the cross-unit roles see everyone", async () => {
    const counts: Record<string, number> = Object.fromEntries(await Promise.all(emails.map(async (e) => [e, rows(await get(e, "/api/v1/employees"))])));
    const everyone = Math.max(...Object.values(counts));
    expect(everyone).toBeGreaterThan(2);
    for (const e of asRoles("SUPER_ADMIN", "ADMIN", "HR", "PRESENTER", "DIRECTOR", "EXECUTIVE")) expect(counts[e], e).toBe(everyone);
    // the two accounts that hold no cross-unit permission see strictly less
    expect(counts["lead.eng@4core.local"]).toBeLessThan(everyone);
    expect(counts["finance@4core.local"]).toBeLessThan(everyone);
  });
});
