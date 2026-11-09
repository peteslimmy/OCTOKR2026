/**
 * A Super Admin account is invisible to everyone who is not a Super Admin (ADR-118). Generated sweep: the account's id, employee id, email address and name are searched for in
 * EVERY readable API route and EVERY page, as every non-Super-Admin role; a request that names the account is refused as "not found"; and the audit log holds nothing of it.
 * Routes and pages are discovered from src/app, so a new screen is covered automatically. Needs the built app and the seeded test stack:
 *   node scripts/test-stack.mjs run --seed -- node scripts/run-api-tests.mjs super-admin-shield
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { loginAs } from "./session";

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const FAKE = "11111111-1111-4111-8111-111111111111";
const SUPER = "superadmin@4core.local";
const OTHERS = ["admin@4core.local", "hr@4core.local", "finance@4core.local", "lead.eng@4core.local", "presenter@4core.local", "director@4core.local", "exec@4core.local"];

interface Needles { id: string; employeeId: string; email: string; name: string }
let needles: Needles;

function discoverApi(): { route: string; url: string; methods: string[]; dynamic: boolean }[] {
  const out: { route: string; url: string; methods: string[]; dynamic: boolean }[] = [];
  const root = path.join(process.cwd(), "src", "app", "api");
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== "route.ts") continue;
      const src = readFileSync(p, "utf8");
      const rel = "/api/" + path.relative(root, path.dirname(p)).split(path.sep).join("/");
      const methods = [...src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      out.push({ route: rel, url: rel.replace(/\[entity\]/g, "employees").replace(/\[[^\]]+\]/g, FAKE), methods, dynamic: /\[/.test(rel) });
    }
  })(root);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}
function discoverPages(): { route: string; url: string; dynamic: boolean }[] {
  const out: { route: string; url: string; dynamic: boolean }[] = [];
  const root = path.join(process.cwd(), "src", "app");
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "api") walk(p); continue; }
      if (e.name !== "page.tsx") continue;
      const rel = path.relative(root, path.dirname(p)).split(path.sep).filter((seg) => !/^\(.*\)$/.test(seg));
      const route = "/" + rel.join("/");
      out.push({ route, url: route.replace(/\[[^\]]+\]/g, FAKE), dynamic: /\[/.test(route) });
    }
  })(root);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}
const API = discoverApi();
const PAGES = discoverPages().filter((p) => !p.dynamic && !["/", "/login", "/forgot-password", "/reset-password"].includes(p.route));
const READS = API.filter((r) => r.methods.includes("GET") && !r.dynamic && !/^\/api\/(health|metrics|internal)/.test(r.route) && !/\/auth\//.test(r.route) && !/\/export|\/download/.test(r.route));

/** The first place any of the account's identifiers shows up in a response, or null. */
function leak(text: string): string | null {
  const t = text.toLowerCase();
  for (const [k, v] of Object.entries(needles) as [string, string][]) if (v && t.includes(v.toLowerCase())) return k;
  return null;
}

beforeAll(async () => {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const r = await db.query(`select u.id, u.employee_id, u.email::text as email, e.first_name, e.last_name from users u join employees e on e.id = u.employee_id where u.email = $1`, [SUPER]);
  await db.end();
  const x = r.rows[0];
  needles = { id: x.id, employeeId: x.employee_id, email: x.email, name: `${x.first_name} ${x.last_name}` };
  await loginAs(SUPER);                      // the Super Admin signs in: that sign-in is itself an audited act that nobody else may see
});

describe("a Super Admin account is invisible to everyone else (ADR-118)", () => {
  it("discovers the screens", () => {
    expect(READS.length).toBeGreaterThan(40);
    expect(PAGES.length).toBeGreaterThan(30);
  });

  it.each(OTHERS)("%s: no readable API route contains the account's id, employee id, email or name", async (email) => {
    const s = await loginAs(email);
    const leaks: string[] = [];
    for (const r of READS) {
      const res = await s.request("GET", r.url);
      expect(res.status, `${r.route}`).toBeLessThan(500);
      const found = leak(res.text);
      if (found) leaks.push(`${r.route} (${found})`);
    }
    expect(leaks, "routes that name the Super Admin").toEqual([]);
  });

  it.each(OTHERS)("%s: no page contains the account's id, employee id, email or name", async (email) => {
    const s = await loginAs(email);
    const leaks: string[] = [];
    for (const p of PAGES) {
      const res = await s.request("GET", p.url);
      expect(res.status, `${p.route}`).toBeLessThan(500);
      const found = leak(res.text);
      if (found) leaks.push(`${p.route} (${found})`);
    }
    expect(leaks, "pages that name the Super Admin").toEqual([]);
  });

  it("a Super Admin does see the account (so the checks above are not vacuous)", async () => {
    const s = await loginAs(SUPER);
    const people = await s.request("GET", "/admin/people");
    expect(people.text.toLowerCase()).toContain(needles.email.toLowerCase());
  });

  it("a request that names the account is answered exactly as one that names an account that does not exist, and a valid one is 'not found'", async () => {
    const s = await loginAs("admin@4core.local");
    const differs: string[] = [];
    for (const r of API.filter((x) => /\/(users|employees)\/\[id\]/.test(x.route))) {
      for (const m of r.methods) {
        const at = (id: string) => s.request(m, r.route.replace(/\[[^\]]+\]/g, id), m === "GET" ? undefined : {});
        const none = await at(FAKE);
        for (const [label, id] of [["account id", needles.id], ["employee id", needles.employeeId]] as const) {
          const hidden = await at(id);
          if (hidden.status !== none.status || hidden.json.error?.code !== none.json.error?.code) differs.push(`${m} ${r.route} (${label}) -> ${hidden.status} ${hidden.json.error?.code} instead of ${none.status} ${none.json.error?.code}`);
        }
      }
    }
    expect(differs).toEqual([]);
    // with a request that is valid in itself, the answer is "not found"
    for (const [m, url, body] of [["POST", `/api/v1/users/${needles.id}/suspend`, undefined], ["POST", `/api/v1/users/${needles.id}/reactivate`, undefined], ["POST", `/api/v1/users/${needles.id}/invite`, undefined],
      ["PUT", `/api/v1/users/${needles.id}/roles`, { roles: ["HR"] }], ["POST", `/api/v1/users/${needles.id}/mfa-reset`, { reason: "x" }], ["DELETE", `/api/v1/users/${needles.id}/delete`, { reason: "x" }],
      ["POST", "/api/v1/report-email/schedules", { name: "x", frequency: "WEEKLY", sendWeekday: 1, sendDay: 1, sendTime: "08:00", recipientIds: [needles.id], sections: ["HEADLINES"], isActive: true }]] as [string, string, unknown][]) {
      const res = await s.request(m, url, body);
      expect([res.status, res.json.error?.code], `${m} ${url}`).toEqual([404, "NOT_FOUND"]);
    }
  });

  it("creating an account with the Super Admin's address is refused like any other taken address, without saying whose it is", async () => {
    const s = await loginAs("admin@4core.local");
    const bus = (await s.request("GET", "/api/v1/business-units")).json.data as { id: string }[];
    const make = (email: string) => s.request("POST", "/api/v1/users", { email, firstName: "Dup", lastName: "Licate", businessUnitId: bus[0].id, roles: ["BU_LEAD"] });
    const taken = await make("hr@4core.local");
    const hidden = await make(needles.email);
    expect(hidden.status).toBe(taken.status);
    expect(hidden.json.error?.code).toBe(taken.json.error?.code);
    expect(hidden.json.error?.message).toBe(taken.json.error?.message);
  });

  it("the audit log holds nothing of the account for anyone else, and everything for a Super Admin", async () => {
    const sa = await loginAs(SUPER);
    const mine = await sa.request("GET", "/api/v1/audit?limit=500");
    expect(mine.status).toBe(200);
    const saRows = ((mine.json.data as { rows?: { actor_user_id: string | null }[] })?.rows ?? []).filter((r) => r.actor_user_id === needles.id);
    expect(saRows.length, "the Super Admin sees their own sign-in").toBeGreaterThan(0);
    for (const email of ["admin@4core.local", "hr@4core.local"]) {
      const s = await loginAs(email);
      const res = await s.request("GET", "/api/v1/audit?limit=500");
      if (res.status === 403) continue;                                                      // this role may not read the log at all
      expect(res.status).toBe(200);
      expect(leak(res.text), `${email} reads the audit log`).toBeNull();
      const ev = await s.request("GET", `/api/v1/audit/events/${saRows[0] && (saRows[0] as unknown as { id: string }).id}`);
      expect([403, 404]).toContain(ev.status);
    }
  });
});
