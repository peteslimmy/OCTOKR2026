/**
 * HTTP-level tests for retiring a Business Unit goal through the chosen executive's approval (ADR-134).
 * Needs the app on the test stack (`npm run test:api`) and a seeded database (`npm run dev:seed`).
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { loginAs } from "./session";

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
};
const uid = (email: string) => q<{ id: string }>("select id from users where email = $1", [email]).then((r) => r[0].id);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: payload shapes are asserted at each call site
type J = any;

async function setup() {
  const lead = await loginAs("lead.eng@4core.local");
  const lead2 = await loginAs("lead.sales@4core.local").catch(() => null);
  const exec = await loginAs("exec@4core.local");
  const director = await loginAs("director@4core.local");
  const hr = await loginAs("hr@4core.local");
  const sa = await loginAs("superadmin@4core.local");
  const bu = (await q<{ id: string }>("select e.business_unit_id id from users u join employees e on e.id = u.employee_id where u.email = 'lead.eng@4core.local'"))[0].id;
  const quarter = (await q<{ id: string }>("select id from quarters where status = 'ACTIVE' order by year desc, quarter_number desc limit 1"))[0].id;
  const goal = async () => {
    const r = await lead.request("POST", "/api/v1/bu-goals", { businessUnitId: bu, quarterId: quarter, title: `Retirement test ${randomUUID().slice(0, 8)}` });
    expect(r.status).toBe(200);
    return r.json.data as string;
  };
  return { lead, lead2, exec, director, hr, sa, bu, quarter, goal };
}
const key = () => randomUUID();

describe("retiring a Business Unit goal through an executive", () => {
  it("lists the executives by name, only for people who keep goals", async () => {
    const w = await setup();
    const ok = await w.lead.request("GET", "/api/v1/bu-goals/retirement-executives");
    expect(ok.status).toBe(200);
    const names = (ok.json.data as J[]).map((x) => `${x.name}|${x.role}`);
    expect((ok.json.data as J[]).some((x) => x.id === undefined)).toBe(false);
    expect(names.some((n) => n.endsWith("|EXECUTIVE"))).toBe(true);
    expect(names.every((n) => n.endsWith("|EXECUTIVE"))).toBe(true);                      // only the Executive role may approve (owner, 2026-11-25)
    expect((ok.json.data as J[]).map((x) => x.id)).not.toContain(await uid("superadmin@4core.local"));
    // the HR test account also holds the BU Lead role, which may list them; the Presenter holds neither role
    expect((await (await loginAs("presenter@4core.local")).request("GET", "/api/v1/bu-goals/retirement-executives")).status).toBe(403);
  });

  it("the lead asks, the goal stays active, only the chosen executive can decide, and the outcome reaches the lead", async () => {
    const w = await setup();
    const g = await w.goal();
    const execId = await uid("exec@4core.local");
    // validation: a justification and a known executive are required; the direct route no longer retires
    expect((await w.lead.request("POST", "/api/v1/bu-goals/retirements", { goalId: g, executiveId: execId, justification: " ", idempotencyKey: key() })).status).toBe(422);
    expect((await w.lead.request("POST", "/api/v1/bu-goals", { id: g, title: "x", status: "RETIRED" })).json.error?.code).toBe("BU_GOAL_RETIRE_REQUIRES_APPROVAL");
    const req = await w.lead.request("POST", "/api/v1/bu-goals/retirements", { goalId: g, executiveId: execId, justification: "The unit moved on", idempotencyKey: key() });
    expect(req.status).toBe(200);
    const id = (req.json.data as J).id as string;
    // a repeat returns the open request
    const again = await w.lead.request("POST", "/api/v1/bu-goals/retirements", { goalId: g, executiveId: execId, justification: "Again", idempotencyKey: key() });
    expect(again.json.data).toMatchObject({ id, existing: true });
    expect((await q("select status from bu_goals where id = $1", [g]))[0]).toMatchObject({ status: "ACTIVE" });
    // not the chosen one
    expect((await w.director.request("POST", `/api/v1/bu-goals/retirements/${id}/decide`, { approve: true, idempotencyKey: key() })).status).toBe(403);
    expect((await w.hr.request("POST", `/api/v1/bu-goals/retirements/${id}/decide`, { approve: true, idempotencyKey: key() })).status).toBe(403);
    expect((await w.lead.request("POST", `/api/v1/bu-goals/retirements/${id}/decide`, { approve: true, idempotencyKey: key() })).status).toBe(403);
    // a rejection needs a comment
    expect((await w.exec.request("POST", `/api/v1/bu-goals/retirements/${id}/decide`, { approve: false, idempotencyKey: key() })).status).toBe(422);
    const listed = await w.exec.request("GET", "/api/v1/bu-goals/retirements?toDecide=1");
    expect((listed.json.data as J[]).some((x) => x.id === id && x.can_decide)).toBe(true);
    const rej = await w.exec.request("POST", `/api/v1/bu-goals/retirements/${id}/decide`, { approve: false, comment: "Keep it until the quarter ends", idempotencyKey: key() });
    expect(rej.status).toBe(200);
    expect((await q("select status from bu_goals where id = $1", [g]))[0]).toMatchObject({ status: "ACTIVE" });
    const mine = await w.lead.request("GET", `/api/v1/bu-goals/retirements?quarterId=${w.quarter}&businessUnitId=${w.bu}`);
    expect((mine.json.data as J[]).find((x) => x.id === id)).toMatchObject({ status: "REJECTED", decision_comment: "Keep it until the quarter ends" });
    // ask again, the executive approves, the goal is retired and cannot be decided twice the other way
    const second = await w.lead.request("POST", "/api/v1/bu-goals/retirements", { goalId: g, executiveId: execId, justification: "Second ask", idempotencyKey: key() });
    const id2 = (second.json.data as J).id as string;
    expect((await w.exec.request("POST", `/api/v1/bu-goals/retirements/${id2}/decide`, { approve: true, idempotencyKey: key() })).status).toBe(200);
    expect((await q("select status from bu_goals where id = $1", [g]))[0]).toMatchObject({ status: "RETIRED" });
    expect((await w.exec.request("POST", `/api/v1/bu-goals/retirements/${id2}/decide`, { approve: false, comment: "no", idempotencyKey: key() })).status).toBe(409);
    expect((await w.lead.request("POST", `/api/v1/bu-goals/retirements/${id2}/cancel`)).status).toBe(409);
  });

  it("the lead cancels a pending request; another unit's lead cannot ask or cancel; the Super Admin may decide (ADR-112)", async () => {
    const w = await setup();
    const g = await w.goal();
    const execId = await uid("exec@4core.local");
    if (w.lead2) {
      expect((await w.lead2.request("POST", "/api/v1/bu-goals/retirements", { goalId: g, executiveId: execId, justification: "Not mine", idempotencyKey: key() })).status).toBe(403);
    }
    const id = ((await w.lead.request("POST", "/api/v1/bu-goals/retirements", { goalId: g, executiveId: execId, justification: "Will cancel", idempotencyKey: key() })).json.data as J).id as string;
    if (w.lead2) expect((await w.lead2.request("POST", `/api/v1/bu-goals/retirements/${id}/cancel`)).status).toBe(403);
    expect((await w.lead.request("POST", `/api/v1/bu-goals/retirements/${id}/cancel`)).status).toBe(200);
    expect((await q("select status from bu_goals where id = $1", [g]))[0]).toMatchObject({ status: "ACTIVE" });
    const id2 = ((await w.lead.request("POST", "/api/v1/bu-goals/retirements", { goalId: g, executiveId: execId, justification: "Super Admin decides", idempotencyKey: key() })).json.data as J).id as string;
    expect((await w.sa.request("POST", `/api/v1/bu-goals/retirements/${id2}/decide`, { approve: true, idempotencyKey: key() })).status).toBe(200);
    expect((await q("select status from bu_goals where id = $1", [g]))[0]).toMatchObject({ status: "RETIRED" });
  });
});
