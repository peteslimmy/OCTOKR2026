/**
 * HTTP-level tests for the employee bulk import: authentication, permission, upload hardening, validation, atomic commit, idempotent
 * retries and the audit record. Needs `npm run dev` (or start) and a seeded database (`npm run dev:seed`).
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import ExcelJS from "exceljs";
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
    return { status: res.status, json, text };
  }
  upload(path: string, name: string, bytes: Uint8Array | string) {
    const form = new FormData();
    form.append("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name));
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

const run = randomUUID().slice(0, 8);
const mail = (n: string) => `import-${run}-${n}@example.test`;
const P = "/api/v1/imports/employees";
const row = (n: string, o: Record<string, string> = {}) => ({ email: mail(n), firstName: "Imp", lastName: "Orted", businessUnit: "HQ", status: "", ...o });
const sha = (c: string) => c.repeat(64);

describe("employee import API", () => {
  it("requires sign-in and the users.manage permission on every endpoint", async () => {
    const anon = new Session();
    for (const [m, p, b] of [["POST", `${P}/parse`, undefined], ["POST", `${P}/validate`, { rows: [row("a")], policy: "SKIP_EXISTING" }], ["POST", `${P}/commit`, {}], ["GET", "/api/v1/imports/batches", undefined]] as const) {
      expect((await anon.request(m, p, b)).status, `${m} ${p}`).toBe(401);
    }
    const lead = await as("lead.eng@4core.local");
    expect((await lead.upload(`${P}/parse`, "a.csv", "email\r\na@b.co")).status).toBe(403);
    expect((await lead.request("POST", `${P}/validate`, { rows: [row("a")], policy: "SKIP_EXISTING" })).status).toBe(403);
    expect((await lead.request("POST", `${P}/commit`, { rows: [row("a")], policy: "SKIP_EXISTING", idempotencyKey: randomUUID(), fileName: "a.csv", fileSha256: sha("a") })).status).toBe(403);
    expect((await lead.request("GET", "/api/v1/imports/batches")).status).toBe(403);
  });

  it("parses a csv, suggests the columns, and hashes the exact file", async () => {
    const admin = await as("admin@4core.local");
    const csv = `Work Email,Given Name,Surname,BU Code\r\n${mail("p1")},Pia,Pine,HQ\r\n`;
    const r = await admin.upload(`${P}/parse`, "people.csv", csv);
    expect(r.status).toBe(200);
    expect(r.json.data.headers).toEqual(["Work Email", "Given Name", "Surname", "BU Code"]);
    expect(r.json.data.mapping).toEqual({ email: 0, firstName: 1, lastName: 2, businessUnit: 3, status: null });
    expect(r.json.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.data.rows).toEqual([[mail("p1"), "Pia", "Pine", "HQ"]]);
  });

  it("reads a real .xlsx and never evaluates formulas: they come back as text and are rejected by validation", async () => {
    const admin = await as("admin@4core.local");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("People");
    ws.addRow(["email", "first_name", "last_name", "business_unit"]);
    ws.addRow([mail("x1"), "Xena", "Xu", "HQ"]);
    ws.addRow([mail("x2"), { formula: "1+1", result: 2 }, "Xu", "HQ"]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await admin.upload(`${P}/parse`, "people.xlsx", bytes);
    expect(r.status).toBe(200);
    expect(r.json.data.rows[1][1]).toBe("=1+1");
    const v = await admin.request("POST", `${P}/validate`, { rows: r.json.data.rows.map((x: string[]) => ({ email: x[0], firstName: x[1], lastName: x[2], businessUnit: x[3], status: "" })), policy: "SKIP_EXISTING" });
    expect(v.status).toBe(200);
    expect(v.json.data.results[0].action).toBe("CREATE");
    expect(v.json.data.results[1].issues[0]).toMatchObject({ code: "INVALID_TEXT", severity: "ERROR" });
    expect(v.json.data.summary.canCommit).toBe(false);
  });

  it("refuses disguised, wrong-type, empty, over-long and oversized uploads, and a missing file", async () => {
    const admin = await as("admin@4core.local");
    expect((await admin.upload(`${P}/parse`, "evil.exe", "MZ")).status).toBe(422);
    expect((await admin.upload(`${P}/parse`, "macro.xlsm", new Uint8Array([0x50, 0x4b, 3, 4]))).status).toBe(422);
    expect((await admin.upload(`${P}/parse`, "fake.xlsx", "this is plain text")).status).toBe(422);
    expect((await admin.upload(`${P}/parse`, "zip.csv", new Uint8Array([0x50, 0x4b, 3, 4, 0]))).status).toBe(422);
    expect((await admin.upload(`${P}/parse`, "empty.csv", "")).status).toBe(422);
    expect((await admin.upload(`${P}/parse`, "header-only.csv", "email,first,last,bu\r\n")).status).toBe(422);
    const big = await admin.upload(`${P}/parse`, "big.csv", "email\r\n" + "a@b.co\r\n".repeat(400_000));
    expect(big.status).toBe(413);
    expect(big.json.error?.code).toBe("IMPORT_TOO_LARGE");
    const many = await admin.upload(`${P}/parse`, "many.csv", "email,first,last,bu\r\n" + "a@b.co,A,B,HQ\r\n".repeat(2001));
    expect(many.status).toBe(422);
    const none = await admin.request("POST", `${P}/parse`, new FormData());
    expect(none.status).toBe(422);
  });

  it("validates strictly: unknown fields, bad policy, too many rows and non-text values are refused", async () => {
    const admin = await as("admin@4core.local");
    const post = (b: unknown) => admin.request("POST", `${P}/validate`, b);
    expect((await post({ rows: [{ ...row("s"), role: "ADMIN" }], policy: "SKIP_EXISTING" })).status).toBe(422);   // no mass assignment
    expect((await post({ rows: [row("s")], policy: "OVERWRITE_EVERYTHING" })).status).toBe(422);
    expect((await post({ rows: [], policy: "SKIP_EXISTING" })).status).toBe(422);
    expect((await post({ rows: Array.from({ length: 2001 }, (_, i) => row(`m${i}`)), policy: "SKIP_EXISTING" })).status).toBe(422);
    expect((await post({ rows: [{ ...row("s"), email: 5 }], policy: "SKIP_EXISTING" })).status).toBe(422);
    expect((await post({ rows: [row("s")], policy: "SKIP_EXISTING", extra: 1 })).status).toBe(422);
  });

  it("explains every row: new, existing, unknown unit, duplicate in file", async () => {
    const admin = await as("admin@4core.local");
    const rows = [row("n1"), { ...row("n2"), businessUnit: "NOPE" }, row("n1"), { ...row("n3"), email: "admin@4core.local" }];
    const v = await admin.request("POST", `${P}/validate`, { rows, policy: "SKIP_EXISTING" });
    expect(v.status).toBe(200);
    const [a, b, c, d] = v.json.data.results;
    expect([a.action, b.action, c.action, d.action]).toEqual(["CREATE", "BLOCKED", "BLOCKED", "SKIP"]);
    expect(b.issues[0].code).toBe("UNKNOWN_BU");
    expect(c.issues[0].code).toBe("DUPLICATE_IN_FILE");
    expect(d.issues[0]).toMatchObject({ code: "EMAIL_EXISTS", severity: "CONFLICT" });
    expect(v.json.data.summary).toMatchObject({ total: 4, create: 1, skip: 1, blocked: 2, canCommit: false });
  });

  it("refuses to commit invalid rows, changing nothing, and lists the problems", async () => {
    const admin = await as("admin@4core.local");
    const before = (await db<{ n: number }>("select count(*)::int n from employees"))[0].n;
    const r = await admin.request("POST", `${P}/commit`, { rows: [row("ok1"), { ...row("bad"), businessUnit: "NOPE" }], policy: "SKIP_EXISTING", idempotencyKey: randomUUID(), fileName: "bad.csv", fileSha256: sha("1") });
    expect(r.status).toBe(422);
    expect(r.json.error?.code).toBe("IMPORT_INVALID");
    expect(r.json.error?.details[0]).toMatchObject({ row: 2, code: "UNKNOWN_BU" });
    expect((await db<{ n: number }>("select count(*)::int n from employees"))[0].n).toBe(before);
  });

  it("commits once, replays safely, and refuses the same key for a different file", async () => {
    const admin = await as("admin@4core.local");
    const key = randomUUID();
    const body = { rows: [row("c1"), row("c2", { status: "Inactive" })], policy: "SKIP_EXISTING", idempotencyKey: key, fileName: "good.csv", fileSha256: sha("2") };
    const first = await admin.request("POST", `${P}/commit`, body);
    expect(first.status, first.text).toBe(200);
    expect(first.json.data).toMatchObject({ created: 2, updated: 0, skipped: 0, replayed: false });
    const again = await admin.request("POST", `${P}/commit`, body);
    expect(again.json.data).toMatchObject({ replayed: true, batchId: first.json.data.batchId, created: 2 });
    expect((await db<{ n: number }>("select count(*)::int n from employees where email like $1", [`import-${run}-c%`]))[0].n).toBe(2);
    expect((await db<{ employment_status: string }>("select employment_status from employees where email = $1", [mail("c2")]))[0].employment_status).toBe("INACTIVE");
    expect((await admin.request("POST", `${P}/commit`, { ...body, fileSha256: sha("3") })).status).toBe(409);
    // a second run of the same people under a new key adds nobody and says so
    const rerun = await admin.request("POST", `${P}/commit`, { ...body, idempotencyKey: randomUUID(), policy: "UPDATE_EXISTING" });
    expect(rerun.json.data).toMatchObject({ created: 0, updated: 0, unchanged: 2, replayed: false });
    // audit and history
    const audit = await db<{ n: number }>("select count(*)::int n from audit_logs where action = 'EMPLOYEE_IMPORT_COMMITTED' and entity_id = $1", [first.json.data.batchId]);
    expect(audit[0].n).toBe(1);
    const list = await admin.request("GET", "/api/v1/imports/batches");
    expect(list.status).toBe(200);
    expect(list.json.data.some((b: { id: string }) => b.id === first.json.data.batchId)).toBe(true);
  });

  it("never lets an import touch login accounts or roles", async () => {
    const admin = await as("admin@4core.local");
    const users = (await db<{ n: number }>("select count(*)::int n from users"))[0].n;
    const roles = (await db<{ n: number }>("select count(*)::int n from user_roles"))[0].n;
    const r = await admin.request("POST", `${P}/commit`, { rows: [{ ...row("role"), role: "SUPER_ADMIN" }], policy: "SKIP_EXISTING", idempotencyKey: randomUUID(), fileName: "r.csv", fileSha256: sha("4") });
    expect(r.status).toBe(422);
    expect((await db<{ n: number }>("select count(*)::int n from users"))[0].n).toBe(users);
    expect((await db<{ n: number }>("select count(*)::int n from user_roles"))[0].n).toBe(roles);
  });
});

describe("Business Unit import API", () => {
  const B = "/api/v1/imports/business-units";
  const unit = (n: string, o: Record<string, string> = {}) => ({ code: `T${run.toUpperCase()}${n}`.slice(0, 20), name: `Unit ${n} ${run}`, unitType: "", reportsWeekly: "", status: "", ...o });

  it("is limited to people who manage Business Units, and unknown imports do not exist", async () => {
    const hr = await as("hr@4core.local");
    expect((await hr.upload(`${B}/parse`, "u.csv", "code,name\r\nA1,One")).status).toBe(403);
    expect((await hr.request("POST", `${B}/validate`, { rows: [unit("x")], policy: "SKIP_EXISTING" })).status).toBe(403);
    expect((await new Session().request("POST", `${B}/validate`, {})).status).toBe(401);
    const admin = await as("admin@4core.local");
    for (const e of ["roles", "users", "..%2Femployees"]) expect((await admin.request("POST", `/api/v1/imports/${e}/validate`, { rows: [], policy: "SKIP_EXISTING" })).status, e).toBe(404);
  });

  it("parses, matches columns, explains rows and refuses fields that are not Business Unit fields", async () => {
    const admin = await as("admin@4core.local");
    const p = await admin.upload(`${B}/parse`, "units.csv", "Unit Code,Unit Name,Status\r\nOPS1,Ops,Active\r\n");
    expect(p.status).toBe(200);
    expect(p.json.data.mapping).toEqual({ code: 0, name: 1, unitType: null, reportsWeekly: null, status: 2 });
    const v = await admin.request("POST", `${B}/validate`, { rows: [unit("a"), unit("a"), { ...unit("b"), code: "HQ" }, { ...unit("c"), code: "bad code" }], policy: "SKIP_EXISTING" });
    expect(v.status).toBe(200);
    expect(v.json.data.results.map((x: { action: string }) => x.action)).toEqual(["CREATE", "BLOCKED", "SKIP", "BLOCKED"]);
    expect((await admin.request("POST", `${B}/validate`, { rows: [{ email: "a@b.co", firstName: "A", lastName: "B", businessUnit: "HQ", status: "" }], policy: "SKIP_EXISTING" })).status).toBe(422);   // employee fields are not accepted here
  });

  it("commits once, replays, and cannot reuse an employee import key or file", async () => {
    const admin = await as("admin@4core.local");
    const key = randomUUID();
    const body = { rows: [unit("n1"), unit("n2", { reportsWeekly: "No" })], policy: "SKIP_EXISTING", idempotencyKey: key, fileName: "units.csv", fileSha256: sha("7") };
    const first = await admin.request("POST", `${B}/commit`, body);
    expect(first.status, first.text).toBe(200);
    expect(first.json.data).toMatchObject({ created: 2, replayed: false });
    expect((await admin.request("POST", `${B}/commit`, body)).json.data).toMatchObject({ replayed: true, batchId: first.json.data.batchId });
    expect((await db<{ n: number }>("select count(*)::int n from business_units where name like $1", [`% ${run}`]))[0].n).toBe(2);
    expect((await db<{ reports_weekly: boolean }>("select reports_weekly from business_units where name = $1", [`Unit n2 ${run}`]))[0].reports_weekly).toBe(false);
    expect((await admin.request("POST", `${B}/commit`, { ...body, fileSha256: sha("8") })).status).toBe(409);
    const emp = await admin.request("POST", `${P}/commit`, { rows: [row("bk")], policy: "SKIP_EXISTING", idempotencyKey: key, fileName: "x.csv", fileSha256: sha("7") });
    expect(emp.status).toBe(409);                                                                  // a key belongs to one import only
    const bad = await admin.request("POST", `${B}/commit`, { ...body, idempotencyKey: randomUUID(), rows: [unit("n3"), { ...unit("n4"), name: "=cmd()" }] });
    expect(bad.status).toBe(422);
    expect((await db<{ n: number }>("select count(*)::int n from business_units where name like $1", [`Unit n3%`]))[0].n).toBe(0);
    expect((await db<{ n: number }>("select count(*)::int n from audit_logs where action = 'BUSINESS_UNIT_IMPORT_COMMITTED' and entity_id = $1", [first.json.data.batchId]))[0].n).toBe(1);
  });
});
