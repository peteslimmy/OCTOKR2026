/**
 * HTTP-level tests for the historical report import (ADR-077): only the Super Admin tier may use it, the sheet is read as data, problems come back with their row,
 * and a rehearsal shows the recomputed result without saving anything. The commit itself is proven at database level (tests/db/history_import.test.ts); here it is only
 * checked for who may call it and for its confirmation, because committing would leave 2025 quarters in the shared development database.
 * Needs a built app and a seeded database (`npm run dev:seed`, then `npm run admin:add` or a seeded Super Admin).
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { completeMfa } from "./mfa-login";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const PASSWORD = "DevPassword!2026";

class Session {
  private jar = new Map<string, string>();
  private ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  async request(method: string, path: string, body?: unknown) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${BASE}${path}`, {
      method, redirect: "manual",
      headers: { ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}), "x-forwarded-for": this.ip, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.jar.delete(name); else this.jar.set(name, value);
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: payload shapes are asserted at each call site
    let json: { data?: any; error?: { code: string; message: string; details?: any } } = {};
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json };
  }
  upload(path: string, name: string, text: string) {
    const form = new FormData();
    form.append("file", new File([text], name));
    return this.request("POST", path, form);
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
const db = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
};

const HEADER = "Year,Week,BU/Depart,SubKR Category,Goal,Task 1,Status 1,Task 2,Status 2,Task 3,Status 3";
const P = "/api/v1/history-imports";

describe("historical import API", () => {
  it("requires sign-in, and the history.import permission held only by the Super Admin tier", async () => {
    const anon = new Session();
    expect((await anon.request("GET", P)).status).toBe(401);
    expect((await anon.upload(P, "a.csv", `${HEADER}\n`)).status).toBe(401);
    for (const who of ["admin@4core.local", "hr@4core.local", "lead.eng@4core.local"]) {
      const s = await as(who);
      expect((await s.request("GET", P)).status, who).toBe(403);
      expect((await s.upload(P, "a.csv", `${HEADER}\n2025,3,HQ,1.1,G,T,Done,,,,\n`)).status, who).toBe(403);
      expect((await s.request("POST", `${P}/${randomUUID()}/rehearse`, { fillGaps: false })).status, who).toBe(403);
      expect((await s.request("POST", `${P}/${randomUUID()}/commit`, { fillGaps: false, confirm: "IMPORT HISTORY" })).status, who).toBe(403);
    }
  });

  it("reads the sheet as data: wrong layout, unknown units and formulas are refused with their row, and nothing is saved", async () => {
    const sa = await as("superadmin@4core.local");
    const before = (await db<{ n: number }>("select count(*)::int n from historical_import_batches"))[0].n;
    expect((await sa.upload(P, "a.csv", "Year,Week,Goal\n2025,3,G\n")).json.error?.message).toMatch(/BU\/Depart/);
    expect((await sa.upload(P, "a.txt", "x")).status).toBe(422);
    const bad = await sa.upload(P, "a.csv", `${HEADER}\n2025,3,Nowhere,1.1,G,T,Done,,,,\n2025,3,Nowhere,1.1,=1+1,T,Done,,,,\n`);
    expect(bad.status).toBe(200);
    expect(bad.json.data).toMatchObject({ staged: false, fileProblemCount: 3, unknownUnits: ["Nowhere"] });
    expect((await db<{ n: number }>("select count(*)::int n from historical_import_batches"))[0].n).toBe(before);
  });

  it("stages a good sheet, reports database problems with the row, rehearses without saving, and the commit needs the confirmation", async () => {
    const sa = await as("superadmin@4core.local");
    const unit = (await db<{ code: string }>("select code from business_units where code <> 'HQ' order by code limit 1"))[0].code;
    const marker = randomUUID().slice(0, 8);
    const good = await sa.upload(P, "h.csv", `${HEADER}\n2025,3,${unit},1.1,Goal ${marker},Brief,Done,Build,Done,Ship,Not Done\n,,,,Stretch ${marker},Try,Done,,,,\n2025,4,${unit},2.3,Close ${marker},Call,Done,,,,\n`);
    expect(good.status).toBe(200);
    expect(good.json.data).toMatchObject({ staged: true, rows: 3, issueCount: 0 });
    const id = good.json.data.batchId as string;

    const reports = (await db<{ n: number }>("select count(*)::int n from weekly_reports"))[0].n;
    const rh = await sa.request("POST", `${P}/${id}/rehearse`, { fillGaps: false });
    expect(rh.status).toBe(200);
    expect(rh.json.data).toMatchObject({ rehearsal: true, reports: 2, goals: 3, tasks: 5, tasks_done: 4 });
    expect((await db<{ n: number }>("select count(*)::int n from weekly_reports"))[0].n).toBe(reports);
    expect((await db<{ n: number }>("select count(*)::int n from reporting_weeks where week_year = 2025 and week_number = 3"))[0].n).toBe(0);

    const wrong = await sa.request("POST", `${P}/${id}/commit`, { fillGaps: false, confirm: "yes" });
    expect([422, 401]).toContain(wrong.status);                                             // 401 when the authenticator check is asked first
    expect((await db<{ n: number }>("select count(*)::int n from weekly_reports"))[0].n).toBe(reports);

    const future = await sa.upload(P, "f.csv", `${HEADER}\n2099,3,${unit},1.1,Goal ${marker}x,T,Done,,,,\n`);
    expect(future.json.data).toMatchObject({ staged: true, issueCount: 1 });
    expect(future.json.data.issues[0].message).toMatch(/not ended/);                          // a quarter that has not ended cannot be loaded
  });
});
