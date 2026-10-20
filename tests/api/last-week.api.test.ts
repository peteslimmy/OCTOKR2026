/**
 * HTTP-level tests for the presenter "Last Week — Outstanding Tasks" hint: authentication, permission, strict parameter validation,
 * crafted-identifier handling and read-only behaviour. Needs `npm run dev` and a seeded database (`npm run dev:seed`).
 */
import { config } from "dotenv";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { completeMfa } from "./mfa-login";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PASSWORD = "DevPassword!2026";

class Session {
  private jar = new Map<string, string>();
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
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  }
}
const sessions = new Map<string, Session>();
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

async function ids() {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const week = (await c.query("select id from reporting_weeks order by week_start_at desc limit 1")).rows[0].id as string;
    const bus = (await c.query("select b.id from business_units b where b.status = 'ACTIVE' order by b.name limit 2")).rows as { id: string }[];
    return { week, bu: bus[0].id, otherBu: bus[1].id };
  } finally { await c.end(); }
}
const url = (w: string, b: string) => `/api/v1/presentation/last-week?weekId=${w}&buId=${b}`;

describe("presentation last-week hint", () => {
  it("requires sign-in", async () => {
    const { week, bu } = await ids();
    expect((await new Session().request("GET", url(week, bu))).status).toBe(401);
  });

  it("is refused for a role without presentation.view", async () => {
    const { week, bu } = await ids();
    const r = await (await as("lead.eng@4core.local")).request("GET", url(week, bu));
    expect(r.status).toBe(403);
  });

  it("returns the hint to a presenter and sets no side effects (GET only, writes are rejected)", async () => {
    const { week, bu } = await ids();
    const s = await as("presenter@4core.local");
    const r = await s.request("GET", url(week, bu));
    expect(r.status).toBe(200);
    expect(["OK", "NO_PREVIOUS_WEEK", "HOLIDAY", "NO_REPORT"]).toContain(r.json.data.availability);
    expect(Array.isArray(r.json.data.tasks)).toBe(true);
    expect(r.json.data.tasks.every((t: { status: string }) => t.status === "NOT_DONE")).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect((await s.request(m, url(week, bu), {})).status, m).toBeGreaterThanOrEqual(400);
  });

  it("validates parameters strictly", async () => {
    const { week, bu } = await ids();
    const s = await as("presenter@4core.local");
    for (const p of ["", `?weekId=${week}`, `?buId=${bu}`, `?weekId=not-a-uuid&buId=${bu}`, `?weekId=${week}&buId=1%27%20or%201%3D1--`]) {
      expect((await s.request("GET", `/api/v1/presentation/last-week${p}`)).status, p).toBe(422);
    }
  });

  it("treats unknown identifiers as not found, without leaking anything", async () => {
    const { week, bu } = await ids();
    const s = await as("presenter@4core.local");
    const fake = "11111111-1111-4111-8111-111111111111";
    const a = await s.request("GET", url(fake, bu));
    const b = await s.request("GET", url(week, fake));
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(a.text).not.toMatch(/stack|select |postgres/i);
  });
});
