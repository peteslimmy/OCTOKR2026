/**
 * HTTP-level tests for the strategy import (ADR-079) and the sign-in import (ADR-080): who may use them, that the sheet is read as data, that problems come back with
 * their row, and that a sign-in import really creates the account with its roles and a one-time link. The strategy commit is proven at database level
 * (tests/db/strategy_import.test.ts) because committing would leave extra quarters in the shared development database.
 * Needs a built app and a seeded database (`npm run dev:seed`).
 */
import { randomUUID } from "node:crypto";
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


const SHEET = "Year,Quarter,Objective,KR,KR title,Sub-KR,Sub-KR title\n";
const SI = "/api/v1/sign-in-imports";

describe("strategy import API", () => {
  it("is for the Super Admin tier only", async () => {
    const anon = new Session();
    expect((await anon.upload("/api/v1/strategy-imports", "s.csv", SHEET)).status).toBe(401);
    for (const who of ["admin@4core.local", "hr@4core.local"]) {
      const s = await as(who);
      expect((await s.upload("/api/v1/strategy-imports", "s.csv", `${SHEET}2019,1,O,1,K,1,S\n`)).status, who).toBe(403);
      expect((await s.request("POST", "/api/v1/strategy-imports/commit", { rows: [], fileName: "x", fileSha256: "a".repeat(64), confirm: "IMPORT STRATEGY" })).status, who).toBeGreaterThanOrEqual(400);
    }
  });

  it("reads the sheet as data and reports each problem with its row, saving nothing", async () => {
    const sa = await as("superadmin@4core.local");
    expect((await sa.upload("/api/v1/strategy-imports", "s.csv", "Year,Quarter\n2019,1\n")).json.error?.message).toMatch(/needs these columns/);
    const before = (await db<{ n: number }>("select count(*)::int n from quarters"))[0].n;
    const bad = await sa.upload("/api/v1/strategy-imports", "s.csv", `${SHEET}2019,1,Obj,1,K1,1,S1\n2019,1,Obj,2,K2,1,S2\n=1+1,1,Obj,3,K3,1,S3\n`);
    expect(bad.status).toBe(200);
    expect(bad.json.data.issueCount).toBeGreaterThan(0);
    const good = await sa.upload("/api/v1/strategy-imports", "s.csv", [SHEET, ...[1, 2, 3].map((k) => `2019,1,Obj,${k},K${k},1,S${k}\n`)].join(""));
    expect(good.json.data).toMatchObject({ issueCount: 0, quarters: ["2019 Q1"] });
    expect(good.json.data.rows).toHaveLength(3);
    const wrong = await sa.request("POST", "/api/v1/strategy-imports/commit", { rows: good.json.data.rows, fileName: "s.csv", fileSha256: good.json.data.sha256, confirm: "yes" });
    expect([401, 422]).toContain(wrong.status);
    expect((await db<{ n: number }>("select count(*)::int n from quarters"))[0].n).toBe(before);
  });
});

describe("sign-in import API", () => {
  it("needs sign-in and users.manage", async () => {
    expect((await new Session().upload(SI, "s.csv", "Email,Roles\n")).status).toBe(401);
    expect((await (await as("lead.eng@4core.local")).upload(SI, "s.csv", "Email,Roles\na@b.co,HR\n")).status).toBe(403);
  });

  it("checks people against the database, then creates the account with its roles and a one-time link", async () => {
    const admin = await as("admin@4core.local");
    const tag = randomUUID().slice(0, 8);
    const email = `signin-${tag}@example.test`;
    const unit = (await db<{ id: string }>("select id from business_units where code <> 'HQ' order by code limit 1"))[0].id;
    await db("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) select organisation_id, $1, 'Sign', 'In', $2 from business_units where id = $2", [email, unit]);

    const checked = await admin.upload(SI, "s.csv", `Email,Roles\n${email},BU Lead\nnobody-${tag}@example.test,BU_LEAD\n`);
    expect(checked.status).toBe(200);
    expect(checked.json.data.people.map((p: { email: string }) => p.email)).toEqual([email]);
    expect(checked.json.data.problemCount).toBe(1);
    const privileged = await admin.upload(SI, "s.csv", `Email,Roles\n${email},SUPER_ADMIN\n`);
    expect(privileged.json.data.people).toEqual([]);
    expect(privileged.json.data.problems[0].message).toMatch(/manage roles/);

    const done = await admin.request("POST", `${SI}/commit`, { people: [{ row: 2, email, roles: ["BU_LEAD"] }] });
    expect(done.status).toBe(200);
    expect(done.json.data).toMatchObject({ created: 1 });
    expect(done.json.data.results[0].setupLink).toMatch(/^https?:\/\//);
    expect((await db<{ code: string }>("select r.code from user_roles ur join roles r on r.id = ur.role_id join users u on u.id = ur.user_id where u.email = $1", [email])).map((r) => r.code)).toEqual(["BU_LEAD"]);
    const again = await admin.request("POST", `${SI}/commit`, { people: [{ row: 2, email, roles: ["BU_LEAD"] }] });
    expect(again.json.data.created).toBe(0);                                                      // already has a sign-in: reported, not duplicated
  });
});
