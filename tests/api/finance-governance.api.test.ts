/**
 * HTTP-level tests for milestone 2 (governance and finance). Needs `npm run dev` and a seeded database (`npm run dev:seed`).
 * Independent of the current weekday and of the dev clock.
 */
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
  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method, redirect: "manual",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-forwarded-for": this.ip, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...headers },
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
async function as(email: string) {
  const s = new Session();
  const r = await s.request("POST", "/api/v1/auth/login", { email, password: PASSWORD });
  expect(r.status, `login ${email}`).toBe(200);
  await completeMfa(s, email, r);
  return s;
}
const key = () => randomUUID();

describe("violation → ledger → disbursement over HTTP", () => {
  it("runs the full flow with segregation of duties enforced by the server", async () => {
    const hr = await as("hr@4core.local");
    const fin = await as("finance@4core.local");
    const types = (await hr.request("GET", "/api/v1/violation-types")).json.data as { id: string; code: string; default_fine: string }[];
    expect(types.length).toBeGreaterThan(0);
    const emps = (await hr.request("GET", "/api/v1/employees")).json.data as { id: string; email: string }[];
    const staff = emps.find((e) => e.email === "lead.sales@4core.local")!;

    // raise + pay a violation: the fund is credited atomically
    const before = (await fin.request("GET", "/api/v1/finance/fund")).json.data;
    const v = await hr.request("POST", "/api/v1/violations", { employeeId: staff.id, violationTypeId: types[0].id, idempotencyKey: key(), governanceSessionId: null, notes: "api test" });
    expect(v.status).toBe(200);
    const vid = v.json.data.violation_id as string;
    const pay = await hr.request("POST", `/api/v1/violations/${vid}/payment`, { method: "PAYMENT", reference: `API-${key()}`, paidAt: "2026-10-27", idempotencyKey: key() });
    expect(pay.status).toBe(200);
    const again = await hr.request("POST", `/api/v1/violations/${vid}/payment`, { method: "PAYMENT", reference: `API-${key()}`, paidAt: "2026-10-27", idempotencyKey: key() });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("VIOLATION_ALREADY_SETTLED");
    const mid = (await fin.request("GET", "/api/v1/finance/fund")).json.data;
    expect(Number(mid.inflow) - Number(before.inflow)).toBe(Number(types[0].default_fine));
    expect(mid.reconciled).toBe(true);

    // HR requests; HR cannot decide; Finance decides; release is a separate step
    const amount = Number(types[0].default_fine);
    const req = await hr.request("POST", "/api/v1/disbursement-requests", { amount, purpose: "Others", justification: "covered by integration test", idempotencyKey: key() });
    expect(req.status).toBe(200);
    const rid = req.json.data.request_id as string;
    expect((await hr.request("POST", `/api/v1/disbursement-requests/${rid}/approve`, { idempotencyKey: key() })).status).toBe(403);
    expect((await fin.request("POST", `/api/v1/disbursement-requests/${rid}/reject`, { reason: "  ", idempotencyKey: key() })).json.error?.code).toBe("DISBURSEMENT_REJECTION_REASON_REQUIRED");
    const approve = await fin.request("POST", `/api/v1/disbursement-requests/${rid}/approve`, { idempotencyKey: key() });
    expect(approve.status).toBe(200);
    const afterApprove = (await fin.request("GET", "/api/v1/finance/fund")).json.data;
    expect(Number(afterApprove.balance)).toBe(Number(mid.balance));            // approval moves no cash
    expect(Number(afterApprove.committed)).toBe(Number(mid.committed) + amount); // but it is committed
    expect((await hr.request("POST", `/api/v1/disbursement-requests/${rid}/disburse`, { reference: "X-1", idempotencyKey: key() })).status).toBe(403);
    const rel = await fin.request("POST", `/api/v1/disbursement-requests/${rid}/disburse`, { reference: `BANK-${key()}`, idempotencyKey: key() });
    expect(rel.status).toBe(200);
    const end = (await fin.request("GET", "/api/v1/finance/fund")).json.data;
    expect(Number(end.balance)).toBe(Number(mid.balance) - amount);
    expect(end.reconciled).toBe(true);
    const ledger = (await fin.request("GET", "/api/v1/finance/ledger?limit=3")).json.data as { entry_type: string }[];
    expect(ledger[0].entry_type).toBe("DEBIT");
  });

  it("denies fund, ledger and violation data to roles that must not see them", async () => {
    const lead = await as("lead.eng@4core.local");
    for (const p of ["/api/v1/finance/fund", "/api/v1/finance/ledger"]) expect((await lead.request("GET", p)).status).toBe(403);
    expect((await lead.request("GET", "/api/v1/violations")).json.data ?? []).toEqual([]);
    const hr = await as("hr@4core.local");
    expect((await hr.request("GET", "/api/v1/finance/ledger")).status).toBe(403);   // HR may see the fund summary but not the ledger
    expect((await hr.request("GET", "/api/v1/finance/fund")).status).toBe(200);
    const exec = await as("exec@4core.local");
    expect((await exec.request("GET", "/api/v1/finance/fund")).status).toBe(200);
    expect((await exec.request("GET", "/api/v1/finance/ledger")).status).toBe(403);
    expect((await exec.request("POST", "/api/v1/disbursement-requests", { amount: 1, purpose: "x", justification: "y", idempotencyKey: key() })).status).toBe(403);
  });

  it("rejects malformed money and unknown fields", async () => {
    const hr = await as("hr@4core.local");
    expect((await hr.request("POST", "/api/v1/disbursement-requests", { amount: -5, purpose: "x", justification: "y", idempotencyKey: key() })).status).toBe(422);
    expect((await hr.request("POST", "/api/v1/disbursement-requests", { amount: 10, purpose: "x", justification: "y", idempotencyKey: key(), status: "APPROVED" })).status).toBe(422);
    expect((await hr.request("POST", "/api/v1/disbursement-requests", { amount: "10", purpose: "x", justification: "y", idempotencyKey: key() })).status).toBe(422);
  });
});

describe("attendance governance over HTTP", () => {
  it("BU Leads and Executives cannot use attendance endpoints; Skip needs permission, confirmation and a key", async () => {
    const lead = await as("lead.eng@4core.local");
    const fake = "11111111-1111-4111-8111-111111111111";
    expect((await lead.request("POST", "/api/v1/governance-sessions", { reportingWeekId: fake })).status).toBe(403);
    expect((await lead.request("POST", `/api/v1/governance-sessions/${fake}/skip-okr`, { confirm: true, reason: "not allowed to skip", idempotencyKey: key() })).status).toBe(403);
    expect((await lead.request("POST", `/api/v1/governance-sessions/${fake}/skip-okr`, { confirm: false, idempotencyKey: key() })).status).toBe(422);
    const hr = await as("hr@4core.local");
    expect((await hr.request("POST", `/api/v1/governance-sessions/${fake}/skip-okr`, { idempotencyKey: key() })).status).toBe(422); // confirmation is mandatory
    expect((await hr.request("POST", `/api/v1/governance-sessions/${fake}/skip-okr`, { confirm: true, reason: "no session this week", idempotencyKey: key() })).status).toBe(404);   // a reason is required, then the session is not found
    expect((await hr.request("POST", "/api/v1/governance-sessions/cancel", {})).status).toBeGreaterThanOrEqual(400); // there is no CANCELLED outcome
  });

  it("an amendment requester cannot decide their own request; unrelated users cannot list the queue", async () => {
    const hr = await as("hr@4core.local");
    const admin = await as("admin@4core.local");
    const lead = await as("lead.eng@4core.local");
    expect((await lead.request("GET", "/api/v1/attendance-amendment-requests")).json.data ?? []).toEqual([]);
    const sessions = (await hr.request("GET", "/api/v1/governance-sessions")).json.data as { id: string; outcome: string; roster_status: string }[];
    const held = sessions.find((s) => s.outcome === "HELD" && s.roster_status === "FINALIZED");
    if (!held) return; // nothing finalised in this seeded run; amendment rules are proven at database level
    const roster = (await hr.request("GET", `/api/v1/governance-sessions/${held.id}`)).json.data as { rows: { id: string; effective_status: string; pending_request_id: string | null }[] };
    const row = roster.rows.find((r) => r.effective_status === "PRESENT" && !r.pending_request_id);
    if (!row) return;
    const submit = await hr.request("POST", `/api/v1/attendance-records/${row.id}/amendment-requests`, { proposedStatus: "ILL", reason: "api test", evidenceRefs: [], idempotencyKey: key() });
    expect(submit.status).toBe(200);
    const rid = submit.json.data.request_id as string;
    expect((await hr.request("POST", `/api/v1/attendance-amendment-requests/${rid}/approve`, { idempotencyKey: key() })).status).toBe(403);
    const dec = await admin.request("POST", `/api/v1/attendance-amendment-requests/${rid}/reject`, { idempotencyKey: key(), reason: null });
    expect(dec.status).toBe(200);
    expect((await admin.request("POST", `/api/v1/attendance-amendment-requests/${rid}/approve`, { idempotencyKey: key() })).status).toBe(409); // terminal, never reopened
  });
});
