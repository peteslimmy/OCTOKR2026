/**
 * Real concurrency tests: separate connections, committed data, no rollback.
 * Run with `npm run test:concurrency` (resets the local database first; re-run dev:seed afterwards).
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const clients: Client[] = [];

async function conn(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  clients.push(c);
  return c;
}
async function rpc(c: Client, fn: string, ...args: unknown[]) {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await c.query(`select ${fn}(${ph}) as r`, args.map((a) => (a !== null && typeof a === "object" && !Array.isArray(a) ? JSON.stringify(a) : a)))).rows[0].r;
}
const errorOf = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

let admin: Client;
let ids: { org: string; bu: string; hr: string; fin1: string; fin2: string; staff: string; vt: string };

async function mkUser(roles: string[], name: string): Promise<string> {
  const id = randomUUID();
  const email = `${name}-${id.slice(0, 6)}@conc.local`;
  await admin.query("insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())", [id, email]);
  const emp = (await admin.query("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, $2, $3, 'C', $4) returning id", [ids.org, email, name, ids.bu])).rows[0].id;
  await admin.query("insert into users (id, employee_id, email) values ($1, $2, $3)", [id, emp, email]);
  for (const r of roles) await admin.query("insert into user_roles (user_id, role_id) select $1, id from roles where code = $2", [id, r]);
  return id;
}

beforeAll(async () => {
  admin = await conn();
  const org = (await admin.query("select id from organisations limit 1")).rows[0]?.id ?? (await admin.query("insert into organisations (name, code) values ('Conc', 'CONC') returning id")).rows[0].id;
  const bu = (await admin.query("insert into business_units (organisation_id, code, name) values ($1, 'CONC', 'Concurrency BU') returning id", [org])).rows[0].id;
  ids = { org, bu, hr: "", fin1: "", fin2: "", staff: "", vt: "" };
  ids.hr = await mkUser(["HR"], "hr");
  ids.fin1 = await mkUser(["FINANCE"], "fin1");
  ids.fin2 = await mkUser(["FINANCE"], "fin2");
  ids.staff = (await admin.query("select id from employees where business_unit_id = $1 limit 1", [bu])).rows[0].id;
  ids.vt = await rpc(admin, "create_violation_type", ids.hr, "CONC", "Concurrency type", "LOW", 1000);
  // fund the violation fund with exactly 100,000.00
  const v = await rpc(admin, "create_violation", ids.hr, ids.staff, null, ids.vt, 100000, "seed fund", null, "conc-fund-v");
  await rpc(admin, "record_violation_payment", ids.hr, v.violation_id, "PAYMENT", "CONC-FUND", "2031-01-01", "conc-fund-p");
});

afterAll(async () => {
  await admin.query("update business_units set status = 'INACTIVE' where id = $1", [ids.bu]);
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
});

const balance = async () => Number((await admin.query("select fund_balance((select id from violation_funds limit 1)) b")).rows[0].b);

describe("concurrent money movement", () => {
  it("two simultaneous approvals that together exceed the fund: exactly one succeeds, the balance never goes negative", async () => {
    const a = (await rpc(admin, "create_disbursement_request", ids.hr, 80000, "A", "a", "conc-ra")).request_id;
    const b = (await rpc(admin, "create_disbursement_request", ids.hr, 80000, "B", "b", "conc-rb")).request_id;
    const [c1, c2] = [await conn(), await conn()];
    const results = await Promise.all([
      errorOf(rpc(c1, "decide_disbursement_request", ids.fin1, a, true, null, "conc-d1")),
      errorOf(rpc(c2, "decide_disbursement_request", ids.fin2, b, true, null, "conc-d2")),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r?.startsWith("INSUFFICIENT_FUNDS"))).toHaveLength(1);
    const approved = (await admin.query("select count(*)::int n from disbursement_requests where status = 'APPROVED'")).rows[0].n;
    expect(approved).toBe(1);
    // release the approved one and confirm the fund is still non-negative
    const winner = (await admin.query("select id from disbursement_requests where status = 'APPROVED'")).rows[0].id;
    await rpc(admin, "record_disbursement", ids.fin2, winner, "CONC-BANK-1", "conc-disb-1");
    expect(await balance()).toBe(20000);
  });

  it("many simultaneous releases of the same approved request post exactly one DEBIT", async () => {
    const r = (await rpc(admin, "create_disbursement_request", ids.hr, 5000, "C", "c", "conc-rc")).request_id;
    await rpc(admin, "decide_disbursement_request", ids.fin1, r, true, null, "conc-d3");
    const cs = await Promise.all([conn(), conn(), conn(), conn()]);
    const out = await Promise.all(cs.map((c, i) => errorOf(rpc(c, "record_disbursement", ids.fin2, r, `CONC-BANK-${i}`, `conc-disb-par-${i}`))));
    expect(out.filter((x) => x === null)).toHaveLength(1);
    expect((await admin.query("select count(*)::int n from disbursements where request_id = $1", [r])).rows[0].n).toBe(1);
    expect(await balance()).toBe(15000);
  });

  it("concurrent payments for one violation (different keys/references) credit the fund once", async () => {
    const v = (await rpc(admin, "create_violation", ids.hr, ids.staff, null, ids.vt, 2500, "x", null, "conc-v2")).violation_id;
    const cs = await Promise.all([conn(), conn(), conn()]);
    const out = await Promise.all(cs.map((c, i) => errorOf(rpc(c, "record_violation_payment", ids.hr, v, "PAYMENT", `CONC-PAY-${i}`, "2031-01-02", `conc-pay-${i}`))));
    expect(out.filter((x) => x === null)).toHaveLength(1);
    expect(await balance()).toBe(17500);
    const s = await rpc(admin, "read_fund_summary").catch(() => null);
    expect(s).toBeNull(); // service role has no auth.uid(): the read model is for signed-in users only
    const recon = (await admin.query("select (select coalesce(sum(amount),0) from violation_payments) p, (select coalesce(sum(amount),0) from disbursements) d")).rows[0];
    expect(Number(recon.p) - Number(recon.d)).toBe(await balance()); // ledger reconciles exactly
  });
});

describe("concurrent attendance operations", () => {
  it("simultaneous Skip OKR requests never produce a mixed or duplicated roster", async () => {
    await admin.query("insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on, status) values ($1, 2040, 1, '2040-01-01', '2040-03-31', 'PLANNED') on conflict do nothing", [ids.org]);
    const wk = await rpc(admin, "ensure_reporting_week", "2040-01-09");
    const session = await rpc(admin, "create_governance_session", ids.hr, wk);
    const cs = await Promise.all([conn(), conn(), conn()]);
    const out = await Promise.all(cs.map((c) => errorOf(rpc(c, "skip_okr_session", ids.hr, session, true, "conc-skip", "Test reason: session not held"))));
    expect(out.every((x) => x === null)).toBe(true); // same key: one executes, the rest replay
    const rows = (await admin.query("select status, count(*)::int n from attendance_records where governance_session_id = $1 group by status", [session])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("VIRTUAL_PRESENT");
    const total = (await admin.query("select count(*)::int n from employees where employment_status = 'ACTIVE'")).rows[0].n;
    expect(rows[0].n).toBe(total);
    expect((await admin.query("select count(*)::int n from audit_logs where action = 'OKR_SESSION_SKIPPED' and entity_id = $1", [session])).rows[0].n).toBe(1);
  });

  it("simultaneous amendment requests for one record leave exactly one PENDING request", async () => {
    await admin.query("insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on, status) values ($1, 2040, 2, '2040-04-01', '2040-06-30', 'PLANNED') on conflict do nothing", [ids.org]);
    const wk = await rpc(admin, "ensure_reporting_week", "2040-04-09");
    const session = await rpc(admin, "create_governance_session", ids.hr, wk);
    await rpc(admin, "create_attendance_roster", ids.hr, session);
    await rpc(admin, "finalize_attendance_roster", ids.hr, session, true);
    const rec = (await admin.query("select id from attendance_records where governance_session_id = $1 limit 1", [session])).rows[0].id;
    const hr2 = await mkUser(["HR"], "hr2");
    const cs = await Promise.all([conn(), conn(), conn()]);
    const actors = [ids.hr, hr2, ids.hr];
    const out = await Promise.all(cs.map((c, i) => errorOf(rpc(c, "submit_attendance_amendment", actors[i], rec, "ILL", "concurrent", null, `conc-am-${i}`))));
    expect(out.filter((x) => x === null)).toHaveLength(1);
    expect(out.filter((x) => x?.startsWith("ATTENDANCE_AMENDMENT_ALREADY_PENDING"))).toHaveLength(2);
    expect((await admin.query("select count(*)::int n from attendance_amendment_requests where attendance_record_id = $1 and status = 'PENDING'", [rec])).rows[0].n).toBe(1);
  });
});
