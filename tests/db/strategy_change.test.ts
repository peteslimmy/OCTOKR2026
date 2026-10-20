import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("ST");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const admin2 = await c.user(["ADMIN"], bu, "admin2");
  const exec = await c.user(["EXECUTIVE"], bu, "exec");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const hr = await c.user(["HR"], bu, "hr");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const strat = await seedStrategy(c, admin);                       // Q1 2031: one objective, 3 KRs with one Sub-KR each, ACTIVE
  return { bu, admin, admin2, exec, sa, hr, lead, strat };
}
let seq = 0;
const key = () => `sc-key-${Date.now()}-${++seq}`;
interface Req { request_id: string; status: string; replayed: boolean }
type Item = "OBJECTIVE" | "KR" | "SUBKR";
const ask = (c: Ctx, actor: string, change: string, type: Item, item: string | null, parent: string | null, title: string | null, desc: string | null, reason = "Scope changed", k = key()) =>
  c.rpc<Req>("request_strategy_change", actor, change, type, item, parent, title, desc, reason, k);
const decide = (c: Ctx, actor: string, id: string, d: string, comment: string | null = null, k = key()) => c.rpc<Record<string, unknown>>("decide_strategy_change", actor, id, d, comment, k);
const approve = async (c: Ctx, requester: string, approver: string, change: string, type: Item, item: string | null, parent: string | null, title: string | null, desc: string | null = null) =>
  decide(c, approver, (await ask(c, requester, change, type, item, parent, title, desc)).request_id, "APPROVE");
const versions = (c: Ctx, item: string) => c.q<{ version: number; title: string; status: string; change_request_id: string | null }>("select version, title, status, change_request_id from strategy_item_versions where item_id = $1 order by version", [item]);

describe("strategy of an active quarter is a controlled baseline", () => {
  it("records version 1 of everything at activation, and stops direct edits from then on while a draft quarter stays free", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const all = await c.q<{ item_type: string; n: number }>("select item_type, count(*)::int n from strategy_item_versions where quarter_id = $1 and version = 1 group by item_type order by item_type", [w.strat.quarterId]);
      expect(all).toEqual([{ item_type: "KR", n: 3 }, { item_type: "OBJECTIVE", n: 1 }, { item_type: "SUBKR", n: 3 }]);
      await c.expectError("STRATEGY_CHANGE_REQUIRED", () => c.rpc("update_objective", w.admin, w.strat.objectiveId, "Changed directly", null));
      await c.expectError("STRATEGY_CHANGE_REQUIRED", () => c.rpc("update_key_result", w.admin, w.strat.krIds[0], "Changed directly", null));
      await c.expectError("STRATEGY_CHANGE_REQUIRED", () => c.rpc("update_sub_key_result", w.admin, w.strat.subKrIds[0], "Changed directly", null));
      await c.expectError("STRATEGY_CHANGE_REQUIRED", () => c.rpc("create_key_result", w.admin, w.strat.objectiveId, "A fourth", null));
      await c.expectError("STRATEGY_CHANGE_REQUIRED", () => c.rpc("create_sub_key_result", w.admin, w.strat.krIds[0], "Another", null));
      // a quarter that is still in draft is edited as before
      await c.rpc("create_year_quarters", w.admin, 2031);
      const q2 = (await c.q<{ id: string }>("select id from quarters where year = 2031 and quarter_number = 2"))[0].id;
      const obj = await c.rpc<string>("create_objective", w.admin, q2, "Draft objective", null);
      await c.rpc("update_objective", w.admin, obj, "Draft objective, reworded", null);
      await c.expectError("STRATEGY_CHANGE_NOT_NEEDED", () => ask(c, w.admin, "EDIT", "OBJECTIVE", obj, null, "x", null));
    });
  });

  it("edits through request and independent approval, keeps every version, and tells the requester", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const req = await ask(c, w.admin, "EDIT", "KR", w.strat.krIds[0], null, "Pipeline: qualified leads", "Counted at the sales-accepted stage", "Sales defined the stage");
      expect(req.status).toBe("PENDING");
      expect((await c.q<{ title: string }>("select title from key_results where id = $1", [w.strat.krIds[0]]))[0].title).toBe("KR Pipeline");     // nothing changed yet
      await c.expectError("STRATEGY_CHANGE_SELF_APPROVAL", () => decide(c, w.admin, req.request_id, "APPROVE"));
      for (const actor of [w.hr, w.lead]) await c.expectError("PERMISSION_DENIED", () => decide(c, actor, req.request_id, "APPROVE", null, key()));
      const done = await decide(c, w.exec, req.request_id, "APPROVE", "Agreed with Sales", "dec-retry-0001");
      expect(done).toMatchObject({ status: "APPLIED", version: 2 });
      expect((await c.q<{ title: string; description: string }>("select title, description from key_results where id = $1", [w.strat.krIds[0]]))[0]).toEqual({ title: "Pipeline: qualified leads", description: "Counted at the sales-accepted stage" });
      const v = await versions(c, w.strat.krIds[0]);
      expect(v.map((x) => [x.version, x.title, x.change_request_id === null])).toEqual([[1, "KR Pipeline", true], [2, "Pipeline: qualified leads", false]]);   // the baseline is still there
      expect((await c.q<{ action: string }>("select action from audit_logs where entity_type = 'strategy_change_request' and entity_id = $1 order by seq", [req.request_id])).map((a) => a.action)).toEqual(["STRATEGY_CHANGE_REQUESTED", "STRATEGY_CHANGE_APPLIED"]);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'STRATEGY_CHANGE_DECIDED' and user_id = $1", [w.admin]))[0].n).toBe(1);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'STRATEGY_CHANGE_REQUESTED' and user_id = any($1)", [[w.admin2, w.exec, w.sa]]))[0].n).toBe(3);
      expect((await decide(c, w.exec, req.request_id, "APPROVE", "Agreed with Sales", "dec-retry-0001")).replayed).toBe(true);        // a retry returns the first answer
      expect((await versions(c, w.strat.krIds[0])).length).toBe(2);                                                                    // and does not apply it twice
    });
  });

  it("rejection needs a reason and changes nothing; one open request per item; idempotent", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const first = await ask(c, w.admin, "EDIT", "OBJECTIVE", w.strat.objectiveId, null, "Grow recurring revenue by 20%", null, "Sharper", "chg-key-0001");
      expect((await ask(c, w.admin, "EDIT", "OBJECTIVE", w.strat.objectiveId, null, "Grow recurring revenue by 20%", null, "Sharper", "chg-key-0001")).replayed).toBe(true);
      await c.expectError("STRATEGY_CHANGE_PENDING", () => ask(c, w.admin2, "EDIT", "OBJECTIVE", w.strat.objectiveId, null, "Another wording", null));
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => ask(c, w.admin, "EDIT", "KR", w.strat.krIds[0], null, "x", null, "r", "chg-key-0001"));
      await c.expectError("REASON_REQUIRED", () => decide(c, w.sa, first.request_id, "REJECT", " "));
      await decide(c, w.sa, first.request_id, "REJECT", "Too specific for the quarter", "dec-rej-00001");
      expect((await c.q<{ title: string }>("select title from quarterly_objectives where id = $1", [w.strat.objectiveId]))[0].title).toBe("Grow recurring revenue");
      await c.expectError("STRATEGY_CHANGE_NOT_PENDING", () => decide(c, w.exec, first.request_id, "APPROVE"));
      expect((await ask(c, w.admin, "EDIT", "OBJECTIVE", w.strat.objectiveId, null, "Grow recurring revenue by 10%", null, "Again", "chg-key-0002")).status).toBe("PENDING");   // free to ask again
      expect((await versions(c, w.strat.objectiveId))).toHaveLength(1);
    });
  });

  it("adds key results and Sub-KRs with the next codes, up to four key results", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const sub = await approve(c, w.admin, w.exec, "ADD", "SUBKR", null, w.strat.krIds[0], "Second pipeline measure");
      const added = (await c.q<{ code: string; status: string }>("select code, status from sub_key_results where id = $1", [sub.item_id]))[0];
      expect(added).toEqual({ code: "KR1.2", status: "ACTIVE" });
      expect((await versions(c, sub.item_id as string)).map((v) => v.version)).toEqual([1]);
      const kr = await approve(c, w.admin, w.exec, "ADD", "KR", null, w.strat.objectiveId, "Customer satisfaction");
      expect((await c.q<{ code: string }>("select code from key_results where id = $1", [kr.item_id]))[0].code).toBe("KR4");
      await c.expectError("KR_LIMIT_EXCEEDED", () => ask(c, w.admin, "ADD", "KR", null, w.strat.objectiveId, "A fifth", null));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "ADD", "OBJECTIVE", null, w.strat.quarterId, "Second objective", null));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "ADD", "SUBKR", null, null, "Orphan", null));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "EDIT", "KR", w.strat.krIds[0], null, " ", null));
    });
  });

  it("retires instead of deleting, keeps the quarter complete, and stops new goals mapping to a retired Sub-KR while old ones keep theirs", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("STRATEGY_BELOW_MINIMUM", () => ask(c, w.admin, "RETIRE", "SUBKR", w.strat.subKrIds[0], null, null, null));     // the only Sub-KR of its key result
      await c.expectError("STRATEGY_BELOW_MINIMUM", () => ask(c, w.admin, "RETIRE", "KR", w.strat.krIds[0], null, null, null));            // would leave 2 key results
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "RETIRE", "OBJECTIVE", w.strat.objectiveId, null, null, null));
      const second = await approve(c, w.admin, w.exec, "ADD", "SUBKR", null, w.strat.krIds[0], "Second pipeline measure");
      // a goal mapped to the first Sub-KR before it is retired
      await c.setNow(W1.open);
      const lead = w.lead; const wk = await weekId(c);
      const g1 = await draftGoal(c, lead, wk, w.strat.subKrIds[0], ["task one"], "Publish three pricing sheets by Friday");
      const done = await approve(c, w.admin, w.sa, "RETIRE", "SUBKR", w.strat.subKrIds[0], null, null);
      expect(done.status).toBe("APPLIED");
      expect((await c.q<{ status: string; retired_at: Date | null }>("select status, retired_at from sub_key_results where id = $1", [w.strat.subKrIds[0]]))[0].status).toBe("RETIRED");
      expect((await versions(c, w.strat.subKrIds[0])).map((v) => [v.version, v.status])).toEqual([[1, "ACTIVE"], [2, "RETIRED"]]);
      expect((await c.q<{ sub_key_result_id: string }>("select sub_key_result_id from smart_goals where id = $1", [g1.goalId]))[0].sub_key_result_id).toBe(w.strat.subKrIds[0]);   // the old goal keeps its mapping
      await c.rpc("acquire_edit_lease", lead, g1.reportId, 300);
      await c.expectError("GOAL_SUB_KR_INVALID", () => c.rpc("create_goal", lead, g1.reportId, "KR_ALIGNED", w.strat.subKrIds[0], "Close two more proposals by Friday", null, [{ description: "t" }],
        { specific: 80, measurable: 70, achievable: 75, relevant: 80, timeBound: 60, overall: 73, warnings: [], suggestions: [], engineVersion: "smart-rules-1.0.0" }, g1.version));
      await c.expectError("STRATEGY_ITEM_RETIRED", () => ask(c, w.admin, "EDIT", "SUBKR", w.strat.subKrIds[0], null, "Reword", null));
      await c.expectError("STRATEGY_ITEM_RETIRED", () => ask(c, w.admin, "RETIRE", "SUBKR", w.strat.subKrIds[0], null, null, null));
      // the second Sub-KR is now the key result's last active one
      await c.expectError("STRATEGY_BELOW_MINIMUM", () => ask(c, w.admin, "RETIRE", "SUBKR", second.item_id as string, null, null, null));
      // with a fourth key result a key result may be retired; it then takes no Sub-KR additions
      const kr4 = await approve(c, w.admin, w.exec, "ADD", "KR", null, w.strat.objectiveId, "Customer satisfaction");
      await approve(c, w.admin, w.exec, "ADD", "SUBKR", null, kr4.item_id as string, "NPS");
      await approve(c, w.admin2, w.sa, "RETIRE", "KR", w.strat.krIds[2], null, null);
      await c.expectError("STRATEGY_ITEM_RETIRED", () => ask(c, w.admin, "ADD", "SUBKR", null, w.strat.krIds[2], "Too late", null));
      const tree = await c.asUser(w.lead, () => c.rpc<{ pending_changes: number; key_results: { code: string; status: string; sub_key_results: { status: string }[] }[] }>("read_strategy_tree", w.strat.quarterId));
      expect(tree.key_results.find((k) => k.code === "KR3")?.status).toBe("RETIRED");
      expect(tree.key_results[0].sub_key_results.map((s) => s.status)).toEqual(["RETIRED", "ACTIVE"]);
      expect(tree.pending_changes).toBeGreaterThanOrEqual(0);
    });
  });

  it("is limited to the right people, refuses a locked quarter, and keeps its history immutable", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const actor of [w.hr, w.lead, w.exec]) await c.expectError("PERMISSION_DENIED", () => ask(c, actor, "EDIT", "KR", w.strat.krIds[0], null, "x", null));   // approvers do not request
      await c.expectError("NOT_FOUND", () => ask(c, w.admin, "EDIT", "KR", "11111111-1111-4111-8111-111111111111", null, "x", null));
      const req = await ask(c, w.admin, "EDIT", "KR", w.strat.krIds[1], null, "Retention: 12-month", null);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update strategy_change_requests set reason = 'edited' where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from strategy_change_requests where id = $1", [req.request_id]));
      await decide(c, w.exec, req.request_id, "APPROVE");
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update strategy_change_requests set status = 'REJECTED', decision_comment = 'x' where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update strategy_item_versions set title = 'x'"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from strategy_item_versions"));
      expect(await c.asUser(w.admin, () => c.rpc<unknown[]>("read_strategy_changes", w.strat.quarterId))).toHaveLength(1);
      expect(await c.asUser(w.lead, () => c.rpc<unknown[]>("read_strategy_changes", w.strat.quarterId))).toHaveLength(0);                 // requests are for those who handle them
      expect((await c.asUser(w.lead, () => c.rpc<{ version: number }[]>("read_strategy_history", w.strat.quarterId))).length).toBe(8);      // history is readable like the strategy: 7 baselines + 1 change
      await c.setNow("2031-04-02T09:00:00+01:00");
      await c.rpc("roll_quarters");
      await c.expectError("QUARTER_LOCKED", () => ask(c, w.admin, "EDIT", "KR", w.strat.krIds[2], null, "Late", null));
    });
  });
});
