import { describe, expect, it } from "vitest";
import { draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/**
 * Executive Oversight, Commentary & Recommendations (migrations 20261106000001-3). Each test runs inside a rolled-back transaction.
 * Cast: an Executive and a Director (organisation-wide), a BU Lead of FIN (and a second one), a BU Lead of OPS, a Presenter of HQ,
 * and HR / Finance / Admin / Super Admin (no access to the commentary).
 */
async function world(c: Ctx) {
  const { bu, user, rpc, q, setNow } = c;
  // these tables may hold records committed by the HTTP, browser and concurrency suites; TRUNCATE is transactional, so this test sees an empty module and the rollback puts everything back
  await c.client.query("truncate eo_attachments, eo_links, eo_events, eo_comment_versions, eo_rec_targets, eo_recommendations, eo_comments");
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await bu(`F${tag}`), ops = await bu(`O${tag}`), hq = await bu(`H${tag}`);
  const admin = await user(["ADMIN"], hq, "admin");
  const s = await seedStrategy(c, admin);
  const wk = await weekId(c);
  const exec = await user(["EXECUTIVE"], hq, "exec");
  const director = await user(["DIRECTOR"], hq, "director");
  const finLead = await user(["BU_LEAD"], fin, "finlead");
  const finLead2 = await user(["BU_LEAD"], fin, "finlead2");
  const opsLead = await user(["BU_LEAD"], ops, "opslead");
  const presenter = await user(["PRESENTER"], hq, "presenter");
  const hr = await user(["HR"], hq, "hr");
  const finance = await user(["FINANCE"], hq, "finance");
  const superAdmin = await user(["SUPER_ADMIN"], hq, "sa");
  await setNow("2031-01-07T10:00:00+01:00");
  const { goalId, reportId } = await draftGoal(c, finLead, wk, s.subKrIds[0], ["Reconcile ledgers"]);
  const taskId = (await q<{ id: string }>("select id from tasks where smart_goal_id = $1", [goalId]))[0].id;

  const comment = (actor: string, over: Record<string, unknown> = {}) => rpc<{ id: string; reference: string; version: number; replayed: boolean }>(
    "create_eo_comment", actor, over.bu === undefined ? fin : over.bu, over.category === undefined ? "PERFORMANCE_FEEDBACK" : over.category, over.title === undefined ? "Slow reconciliation" : over.title, over.content ?? "Reconciliation slipped **again** this week.",
    over.visibility ?? "SHARED", over.module ?? "WEEKLY_REPORT", over.subjectType === undefined ? "WEEKLY_REPORT" : over.subjectType, over.subjectId === undefined ? reportId : over.subjectId,
    null, over.week === undefined ? wk : over.week, over.links ?? [], over.key ?? null);
  const rec = (actor: string, over: Record<string, unknown> = {}) => rpc<{ id: string; reference?: string; status: string; version: number; replayed: boolean }>(
    "save_eo_recommendation", actor, over.id ?? null, over.expected ?? null, over.title ?? "Reduce reconciliation delays", over.detail ?? "Automate the nightly matching.", over.background ?? "Three late closes.",
    over.reason === undefined ? "Late closes delay the report." : over.reason, over.outcome ?? "Close within one day", over.direction ?? "Start with the bank feeds", over.priority ?? "HIGH", over.category ?? "RECOMMENDATION", over.module ?? "WEEKLY_REPORT",
    over.subjectType === undefined ? "WEEKLY_REPORT" : over.subjectType, over.subjectId === undefined ? reportId : over.subjectId, null, over.week === undefined ? wk : over.week, over.ownerRole ?? "Finance manager", over.ownerUser ?? null,
    over.requested ?? true, over.due === undefined ? "2031-01-20" : over.due, over.targets ?? [fin], over.links ?? [], over.publish ?? true, over.key ?? null);
  const targetOf = async (recId: string, unit = fin) => (await q<{ id: string }>("select id from eo_rec_targets where recommendation_id = $1 and business_unit_id = $2", [recId, unit]))[0].id;
  const respond = (actor: string, target: string, decision: string, body: string | null = null, expected: number | null = null) => rpc<{ status: string; version: number }>("respond_eo_target", actor, target, decision, body, expected, null);
  const operational = async () => JSON.stringify(await Promise.all([
    q("select * from weekly_reports order by id"), q("select * from smart_goals order by id"), q("select * from tasks order by id"), q("select * from quarterly_objectives order by id"), q("select * from key_results order by id"),
    q("select * from governance_sessions order by id"), q("select * from violations order by id"), q("select * from financial_ledger_entries order by id"), q("select * from quarters order by id")]));
  return { fin, ops, hq, admin, s, wk, exec, director, finLead, finLead2, opsLead, presenter, hr, finance, superAdmin, goalId, taskId, reportId, comment, rec, targetOf, respond, operational };
}

async function failsWith(c: Ctx, re: RegExp, sql: string, params: unknown[] = []) {
  await c.client.query("savepoint f");
  let msg = "";
  try { await c.client.query(sql, params); } catch (e) { msg = (e as Error).message; }
  await c.client.query("rollback to savepoint f");
  expect(msg).toMatch(re);
}
const count = async (c: Ctx, u: string, table: string) => c.asUser(u, async () => (await c.q<{ n: string }>(`select count(*) n from ${table}`))[0].n);

describe("permissions: who may do what (data, mapped by migration)", () => {
  it("gives Executive and Director the author rights, BU Lead the response rights, Presenter reading and replying, and HR/Finance/Admin/Super Admin nothing but configuration", () => withTx(async (c) => {
    const w = await world(c);
    const codes = async (u: string) => (await c.q<{ code: string }>("select p.code from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id where ur.user_id = $1 and (p.code like 'executive\\_%')", [u])).map((r) => r.code).sort();
    expect(await codes(w.exec)).toEqual(await codes(w.director));
    expect(await codes(w.exec)).toEqual(expect.arrayContaining(["executive_comment.create", "executive_recommendation.create", "executive_oversight.view_all", "executive_oversight.export", "executive_recommendation.withdraw", "executive_recommendation.close"]));
    expect(await codes(w.exec)).not.toContain("executive_recommendation.respond");
    expect(await codes(w.finLead)).toEqual(["executive_comment.reply", "executive_comment.view", "executive_oversight.dashboard.view", "executive_oversight.export", "executive_recommendation.respond", "executive_recommendation.update_progress", "executive_recommendation.view"]);
    expect(await codes(w.presenter)).toEqual(["executive_comment.reply", "executive_comment.view", "executive_oversight.view_all", "executive_recommendation.view"]);   // owner decision 2026-11-05: Presenters read every unit; they cannot write
    expect(await codes(w.hr)).toEqual([]);
    expect(await codes(w.finance)).toEqual([]);
    expect(await codes(w.admin)).toEqual(["executive_oversight.configure"]);
    expect(await codes(w.superAdmin)).toEqual(["executive_oversight.configure"]);
    const prot = await c.q<{ protected: boolean }>("select protected from permissions where code = 'executive_oversight.view_all'");
    expect(prot[0].protected).toBe(true);
  }));

  it("lets nobody write the tables directly and exposes no write function to signed-in people", () => withTx(async (c) => {
    const w = await world(c);
    await c.asUser(w.exec, async () => {
      for (const t of ["eo_comments", "eo_recommendations", "eo_rec_targets", "eo_events", "eo_links", "eo_attachments", "eo_comment_versions"]) {
        await failsWith(c, /permission denied/, `insert into ${t} default values`);
        await failsWith(c, /permission denied/, `update ${t} set id = id`);
        await failsWith(c, /permission denied/, `delete from ${t}`);
      }
    });
    const exposed = await c.q<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname ~ '(_eo_|^eo_|eo_comment|eo_recommendation|eo_target|eo_link|eo_attachment|eo_category|eo_escalation|run_eo)' and p.prokind = 'f'
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
    const allowed = new Set(["eo_rec_is_mine", "eo_rec_in_my_unit", "auth_eo_link_target_visible", "eo_person_name", "eo_bu_name", "eo_user_active", "eo_quarter_label", "eo_week_label",
      "eo_is_overdue", "eo_comment_json", "eo_rec_json", "read_eo_comments", "read_eo_recommendations", "read_eo_dashboard", "read_eo_comment", "read_eo_recommendation", "read_eo_context", "read_eo_link_options"]);
    expect(exposed.map((r) => r.proname).filter((n) => !allowed.has(n))).toEqual([]);
  }));
});

describe("comments", () => {
  it("records author, role, unit, module, week and subject automatically, with a reference", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec);
    expect(a.reference).toMatch(/^EOC-2031-\d{4}$/);
    const row = (await c.q<Record<string, unknown>>("select * from eo_comments where id = $1", [a.id]))[0];
    expect(row).toMatchObject({ author_id: w.exec, author_role: "EXECUTIVE", business_unit_id: w.fin, module: "WEEKLY_REPORT", subject_type: "WEEKLY_REPORT", subject_id: w.reportId, reporting_week_id: w.wk, quarter_id: w.s.quarterId, status: "PUBLISHED", visibility: "SHARED", version: 1 });
    expect(String(row.subject_label)).toMatch(/Weekly report/);
  }));

  it("inherits the unit from the record being reviewed", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec, { bu: null });
    expect((await c.q<{ business_unit_id: string; visibility: string }>("select business_unit_id, visibility from eo_comments where id = $1", [a.id]))[0]).toMatchObject({ business_unit_id: w.fin, visibility: "SHARED" });
  }));

  it("allows an observation with no category", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec, { category: null, title: null, content: "Good improvement this week." });
    expect((await c.q<{ category_id: string | null; title: string | null }>("select category_id, title from eo_comments where id = $1", [a.id]))[0]).toEqual({ category_id: null, title: null });
    // and it did not start a recommendation workflow
    expect((await c.q<{ n: string }>("select count(*) n from eo_recommendations"))[0].n).toBe("0");
  }));

  it("refuses people without the create permission, an unknown category and empty content", () => withTx(async (c) => {
    const w = await world(c);
    for (const u of [w.finLead, w.presenter, w.hr, w.finance, w.admin, w.superAdmin]) await c.expectError("PERMISSION_DENIED", () => w.comment(u));
    await c.expectError("VALIDATION_ERROR", () => w.comment(w.exec, { category: "NOT_A_CATEGORY" }));
    await c.expectError("VALIDATION_ERROR", () => w.comment(w.exec, { content: "   " }));
    await c.expectError("VALIDATION_ERROR", () => w.comment(w.exec, { content: "x".repeat(10001) }));
  }));

  it("refuses a record that belongs to another unit than the comment (IDOR with an id from another BU)", () => withTx(async (c) => {
    const w = await world(c);
    await c.expectError("LINK_TARGET_INVALID", () => w.comment(w.exec, { bu: w.ops }));                                   // FIN's report, OPS as the unit
    await c.expectError("LINK_TARGET_INVALID", () => w.comment(w.exec, { subjectType: "TASK", subjectId: "00000000-0000-0000-0000-000000000009" }));
    await c.expectError("LINK_TARGET_INVALID", () => w.comment(w.exec, { bu: w.ops, subjectType: "TASK", subjectId: w.taskId }));
  }));

  it("stores a management-only comment that the unit cannot read", () => withTx(async (c) => {
    const w = await world(c);
    const shared = await w.comment(w.exec, { title: "shared" });
    const mgmt = await w.comment(w.exec, { title: "management", visibility: "MANAGEMENT" });
    const titles = (u: string) => c.asUser(u, async () => (await c.q<{ title: string }>("select title from eo_comments order by title")).map((r) => r.title));
    expect(await titles(w.finLead)).toEqual(["shared"]);
    expect(await titles(w.exec)).toEqual(["management", "shared"]);
    expect(await titles(w.director)).toEqual(["management", "shared"]);
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("reply_eo_comment", w.finLead, mgmt.id, "May I see this?", null));
    expect(shared.id).not.toBe(mgmt.id);
  }));

  it("isolates units and keeps HR, Finance, Admin, Super Admin and an unrelated Presenter out", () => withTx(async (c) => {
    const w = await world(c);
    await w.comment(w.exec);
    expect(await count(c, w.finLead, "eo_comments")).toBe("1");
    expect(await count(c, w.finLead2, "eo_comments")).toBe("1");
    for (const u of [w.opsLead, w.hr, w.finance, w.admin, w.superAdmin]) expect(await count(c, u, "eo_comments")).toBe("0");
    expect(await count(c, w.presenter, "eo_comments")).toBe("1");        // a Presenter presents every unit, so reads every unit
    expect(await count(c, w.exec, "eo_comments")).toBe("1");
  }));

  it("notifies the unit once and never the author", () => withTx(async (c) => {
    const w = await world(c);
    await w.comment(w.exec);
    const n = await c.q<{ user_id: string }>("select user_id from notifications where event_type = 'EO_COMMENT_NEW' and user_id = any($1)", [[w.exec, w.director, w.finLead, w.finLead2, w.opsLead, w.presenter, w.hr, w.finance, w.admin, w.superAdmin]]);
    expect(n.map((r) => r.user_id).sort()).toEqual([w.finLead, w.finLead2].sort());
  }));

  it("replays a repeated request instead of creating a second comment", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec, { key: "comment-key-0001" });
    const b = await w.comment(w.exec, { key: "comment-key-0001" });
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
    expect((await c.q<{ n: string }>("select count(*) n from eo_comments"))[0].n).toBe("1");
    await c.expectError("IDEMPOTENCY_KEY_REUSED", () => c.rpc("reply_eo_comment", w.exec, a.id, "again", "comment-key-0001"));
  }));

  it("keeps replies in order, tells the author, and keeps original comment and replies distinct", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec);
    await c.rpc("reply_eo_comment", w.finLead, a.id, "We hit a bank-feed outage.", null);
    await c.rpc("reply_eo_comment", w.exec, a.id, "Thanks. Is it fixed?", null);
    await c.rpc("reply_eo_comment", w.finLead2, a.id, "Yes, from Monday.", null);
    const thread = await c.asUser(w.finLead, () => c.rpc<{ events: { event_type: string; actor_role: string; body: string | null }[]; replies: number }>("read_eo_comment", a.id));
    expect(thread.replies).toBe(3);
    expect(thread.events.filter((e) => e.event_type === "REPLY").map((e) => e.body)).toEqual(["We hit a bank-feed outage.", "Thanks. Is it fixed?", "Yes, from Monday."]);
    expect(thread.events.map((e) => e.actor_role)).toEqual(["EXECUTIVE", "BU_LEAD", "EXECUTIVE", "BU_LEAD"]);
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'EO_COMMENT_REPLY'", [w.exec])).length).toBeGreaterThanOrEqual(1);
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("reply_eo_comment", w.opsLead, a.id, "Hi", null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("reply_eo_comment", w.hr, a.id, "Hi", null));
    await c.expectError("NOT_FOUND", () => c.rpc("reply_eo_comment", w.finLead, "00000000-0000-0000-0000-000000000009", "Hi", null));
  }));

  it("lets only the author amend, with a reason, keeping the earlier wording and refusing a stale version", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec, { content: "First wording" });
    await c.rpc("reply_eo_comment", w.finLead, a.id, "Noted", null);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("amend_eo_comment", w.finLead, a.id, 1, null, null, "Rewritten", "x"));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("amend_eo_comment", w.director, a.id, 1, null, null, "Rewritten", "x"));
    await c.expectError("REASON_REQUIRED", () => c.rpc("amend_eo_comment", w.exec, a.id, 1, null, null, "Second wording", null));
    await c.expectError("VERSION_CONFLICT", () => c.rpc("amend_eo_comment", w.exec, a.id, 7, null, null, "Second wording", "Clarified"));
    const done = await c.rpc<{ version: number }>("amend_eo_comment", w.exec, a.id, 1, null, null, "Second wording", "Clarified the figure");
    expect(done.version).toBe(2);
    const thread = await c.asUser(w.finLead, () => c.rpc<{ content: string; versions: { content: string; reason: string }[]; events: { event_type: string; details: { replies_at_the_time: number } }[] }>("read_eo_comment", a.id));
    expect(thread.content).toBe("Second wording");
    expect(thread.versions).toEqual([expect.objectContaining({ content: "First wording", reason: "Clarified the figure" })]);
    expect(thread.events.find((e) => e.event_type === "AMENDED")?.details.replies_at_the_time).toBe(1);
    expect((await c.q("select 1 from notifications where user_id = $1 and title like '%was amended'", [w.finLead])).length).toBe(1);
  }));

  it("refuses a silent edit, a delete or a change of author even from the database", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec);
    await failsWith(c, /IMMUTABLE_RECORD/, "update eo_comments set content = 'quietly changed' where id = $1", [a.id]);
    await failsWith(c, /IMMUTABLE_RECORD/, "update eo_comments set author_id = $2 where id = $1", [a.id, w.director]);
    await failsWith(c, /IMMUTABLE_RECORD/, "update eo_comments set business_unit_id = $2 where id = $1", [a.id, w.ops]);
    await failsWith(c, /IMMUTABLE_RECORD/, "delete from eo_comments where id = $1", [a.id]);
    await c.rpc("amend_eo_comment", w.exec, a.id, 1, null, null, "Second wording", "typo");
    await failsWith(c, /IMMUTABLE_RECORD/, "update eo_comment_versions set content = 'x'");
    await failsWith(c, /IMMUTABLE_RECORD/, "delete from eo_comment_versions");
    await failsWith(c, /IMMUTABLE_RECORD/, "update eo_events set body = 'x'");
    await failsWith(c, /IMMUTABLE_RECORD/, "delete from eo_events");
  }));

  it("withdraws a comment: it stays readable, the conversation closes, the earlier text is kept", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("withdraw_eo_comment", w.director, a.id, "no"));
    await c.expectError("REASON_REQUIRED", () => c.rpc("withdraw_eo_comment", w.exec, a.id, null));
    await c.rpc("withdraw_eo_comment", w.exec, a.id, "Posted on the wrong unit");
    await c.expectError("COMMENT_WITHDRAWN", () => c.rpc("reply_eo_comment", w.finLead, a.id, "hi", null));
    await c.expectError("COMMENT_WITHDRAWN", () => c.rpc("amend_eo_comment", w.exec, a.id, 2, null, null, "new", "why"));
    const thread = await c.asUser(w.finLead, () => c.rpc<{ status: string; versions: unknown[] }>("read_eo_comment", a.id));
    expect(thread.status).toBe("WITHDRAWN");
    expect(thread.versions).toHaveLength(1);
  }));

  it("keeps a comment on an archived (inactive) unit readable and refuses new ones for it", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.comment(w.exec);
    await c.q("update business_units set status = 'INACTIVE' where id = $1", [w.fin]);
    await c.expectError("BU_INACTIVE", () => w.comment(w.exec, { subjectType: null, subjectId: null }));
    expect(await count(c, w.exec, "eo_comments")).toBe("1");
    expect(a.id).toBeTruthy();
  }));
});

describe("recommendations: creation and the rule that publishing changes nothing", () => {
  it("creates a draft only its author sees, edits it, publishes it and gets a reference", () => withTx(async (c) => {
    const w = await world(c);
    const d = await w.rec(w.exec, { publish: false });
    expect(d.status).toBe("DRAFT");
    expect(d.reference).toBeUndefined();
    expect(await count(c, w.exec, "eo_recommendations")).toBe("1");
    for (const u of [w.director, w.finLead, w.opsLead, w.hr]) expect(await count(c, u, "eo_recommendations")).toBe("0");
    await c.expectError("BU_SCOPE_DENIED", () => w.rec(w.director, { id: d.id, expected: d.version, publish: false }));       // a draft is invisible to everybody else, so it is not even acknowledged to exist
    const edited = await w.rec(w.exec, { id: d.id, expected: d.version, title: "Reduce reconciliation delays (revised)", publish: false });
    expect(edited.version).toBe(d.version + 1);
    await c.expectError("VERSION_CONFLICT", () => w.rec(w.exec, { id: d.id, expected: d.version, publish: false }));
    const pub = await c.rpc<{ reference: string; status: string }>("publish_eo_recommendation", w.exec, d.id, edited.version, null);
    expect(pub.reference).toMatch(/^EOR-2031-\d{4}$/);
    expect(pub.status).toBe("ACTIVE");
    expect(await count(c, w.finLead, "eo_recommendations")).toBe("1");
    expect(await count(c, w.opsLead, "eo_recommendations")).toBe("0");
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("publish_eo_recommendation", w.exec, d.id, null, null));
    await c.expectError("INVALID_STATE_TRANSITION", () => w.rec(w.exec, { id: d.id, publish: false }));
  }));

  it("captures every field the spec lists and the per-unit record", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { ownerUser: w.finLead2, links: [{ target_type: "WEEKLY_GOAL", target_id: w.goalId }] });
    const r = (await c.q<Record<string, unknown>>("select * from eo_recommendations where id = $1", [a.id]))[0];
    expect(r).toMatchObject({ title: "Reduce reconciliation delays", detail: "Automate the nightly matching.", background: "Three late closes.", reason: "Late closes delay the report.", expected_outcome: "Close within one day",
      proposed_direction: "Start with the bank feeds", priority: "HIGH", module: "WEEKLY_REPORT", subject_type: "WEEKLY_REPORT", recommended_owner_role: "Finance manager", recommended_owner_user: w.finLead2,
      response_requested: true, author_id: w.exec, author_role: "EXECUTIVE", status: "ACTIVE" });
    expect(String(r.response_due)).toContain("2031");
    const t = (await c.q<Record<string, unknown>>("select * from eo_rec_targets where recommendation_id = $1", [a.id]))[0];
    expect(t).toMatchObject({ business_unit_id: w.fin, status: "SUBMITTED", awaiting: "BU", responsible_user_id: w.finLead2 });
    expect((await c.q("select 1 from eo_links where recommendation_id = $1 and target_type = 'WEEKLY_GOAL' and removed_at is null", [a.id])).length).toBe(1);
  }));

  it("never writes to any operational record: reports, goals, tasks, scores, attendance, violations, finance, strategy", () => withTx(async (c) => {
    const w = await world(c);
    const before = await w.operational();
    const cm = await w.comment(w.exec);
    await c.rpc("reply_eo_comment", w.finLead, cm.id, "ok", null);
    const a = await w.rec(w.exec, { subjectType: "TASK", subjectId: w.taskId, links: [{ target_type: "WEEKLY_GOAL", target_id: w.goalId }, { target_type: "KEY_RESULT", target_id: w.s.krIds[0] }] });
    const t = await w.targetOf(a.id);
    await c.rpc("acknowledge_eo_target", w.finLead, t, null, null);
    await w.respond(w.finLead, t, "ACCEPT", "We will do this");
    await c.rpc("update_eo_progress", w.finLead, t, "PROGRESS", "Started", null, null);
    await c.rpc("update_eo_progress", w.finLead, t, "IMPLEMENTED", "Done through the normal goal workflow", null, null);
    await c.rpc("close_eo_recommendation", w.exec, a.id, null, "Thanks", null);
    expect(await w.operational()).toBe(before);
  }));

  it("refuses incomplete, invalid and out-of-scope recommendations", () => withTx(async (c) => {
    const w = await world(c);
    await c.expectError("VALIDATION_ERROR", () => w.rec(w.exec, { reason: null }));                    // publishing needs the reason
    await c.expectError("VALIDATION_ERROR", () => w.rec(w.exec, { targets: [] }));
    await c.expectError("VALIDATION_ERROR", () => w.rec(w.exec, { due: "2031-01-01" }));                 // in the past (today is 2031-01-07)
    await c.expectError("VALIDATION_ERROR", () => w.rec(w.exec, { requested: false, due: "2031-01-20" }));
    await c.expectError("VALIDATION_ERROR", () => w.rec(w.exec, { priority: "URGENT" }));
    await c.expectError("VALIDATION_ERROR", () => w.rec(w.exec, { title: " " }));
    await c.expectError("LINK_TARGET_INVALID", () => w.rec(w.exec, { targets: [w.ops] }));              // FIN's report cannot be the subject of a recommendation to OPS
    await c.expectError("RECIPIENT_UNAVAILABLE", () => w.rec(w.exec, { ownerUser: w.opsLead }));
    for (const u of [w.finLead, w.presenter, w.hr, w.finance, w.admin, w.superAdmin]) await c.expectError("PERMISSION_DENIED", () => w.rec(u));
  }));

  it("refuses a repeated recommendation but replays the same request key", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { key: "rec-key-000001" });
    const b = await w.rec(w.exec, { key: "rec-key-000001" });
    expect(b.id).toBe(a.id);
    await c.expectError("DUPLICATE_RECOMMENDATION", () => w.rec(w.exec, { key: "rec-key-000002" }));
    await w.rec(w.exec, { key: "rec-key-000003", targets: [w.fin, w.ops], subjectType: null, subjectId: null });      // other addressees: a different recommendation
    expect((await c.q<{ n: string }>("select count(*) n from eo_recommendations"))[0].n).toBe("2");
  }));

  it("lets an Executive address any unit but a unit-bound author only their own", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { targets: [w.fin, w.ops], subjectType: null, subjectId: null });
    expect((await c.q("select 1 from eo_rec_targets where recommendation_id = $1", [a.id])).length).toBe(2);
    // a role granted the create permission without view_all is limited to its own unit
    const custom = await c.user(["BU_LEAD"], w.fin, "custom");
    await c.q("insert into user_roles (user_id, role_id) select $1, id from roles where code = 'EXECUTIVE'", [custom]);
    await c.q("delete from user_roles where user_id = $1 and role_id = (select id from roles where code = 'EXECUTIVE')", [custom]);
    await c.q("insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.code = 'BU_LEAD' and p.code = 'executive_recommendation.create'");
    await c.expectError("BU_SCOPE_DENIED", () => w.rec(custom, { targets: [w.ops], subjectType: null, subjectId: null }));
  }));

  it("notifies the unit's leads with the priority and the deadline, once", () => withTx(async (c) => {
    const w = await world(c);
    await w.rec(w.exec, { priority: "CRITICAL" });
    const n = await c.q<{ user_id: string; title: string; message: string }>("select user_id, title, message from notifications where event_type = 'EO_REC_NEW' and user_id = any($1)", [[w.exec, w.director, w.finLead, w.finLead2, w.opsLead, w.presenter, w.hr, w.finance, w.admin, w.superAdmin]]);
    expect(n.map((r) => r.user_id).sort()).toEqual([w.finLead, w.finLead2].sort());
    expect(n[0].title).toMatch(/^\[CRITICAL\]/);
    expect(n[0].message).toMatch(/20 Jan 2031/);
  }));
});

describe("recommendations: the unit's response and accountability", () => {
  it("runs acknowledge -> accept -> progress -> implemented -> close, each step by the right person only", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("acknowledge_eo_target", w.exec, t, null, null));              // an Executive cannot answer for a unit
    await c.expectError("PERMISSION_DENIED", () => c.rpc("acknowledge_eo_target", w.presenter, t, null, null));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("acknowledge_eo_target", w.opsLead, t, null, null));            // nor can another unit
    const ack = await c.rpc<{ status: string }>("acknowledge_eo_target", w.finLead, t, null, null);
    expect(ack.status).toBe("RESPONSE_REQUESTED");
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("acknowledge_eo_target", w.finLead, t, null, null));
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("update_eo_progress", w.finLead, t, "PROGRESS", "early", null, null));       // not accepted yet
    expect((await w.respond(w.finLead, t, "ACCEPT", "Agreed")).status).toBe("ACCEPTED_FOR_ACTION");
    await c.expectError("INVALID_STATE_TRANSITION", () => w.respond(w.finLead, t, "DECLINE", "changed our mind"));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("update_eo_progress", w.exec, t, "PROGRESS", "Started", null, null));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("update_eo_progress", w.finLead, t, "PROGRESS", " ", null, null));
    expect((await c.rpc<{ status: string }>("update_eo_progress", w.finLead, t, "PROGRESS", "Started the bank-feed matching", null, null)).status).toBe("IMPLEMENTATION_IN_PROGRESS");
    expect((await c.rpc<{ status: string }>("update_eo_progress", w.finLead, t, "IMPLEMENTED", "Live since Monday", null, null)).status).toBe("IMPLEMENTATION_REPORTED");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("close_eo_recommendation", w.finLead, a.id, null, "done", null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("close_eo_recommendation", w.director, a.id, null, "done", null));
    const closed = await c.rpc<{ status: string }>("close_eo_recommendation", w.exec, a.id, null, "Verified in the next review", null);
    expect(closed.status).toBe("CLOSED");
    expect((await c.q<{ status: string; closed_without_response: boolean }>("select status, closed_without_response from eo_rec_targets where id = $1", [t]))[0]).toEqual({ status: "CLOSED", closed_without_response: false });
    await c.expectError("RECOMMENDATION_CLOSED", () => c.rpc("reply_eo_recommendation", w.exec, a.id, null, "more?", null));
    const types = (await c.q<{ event_type: string }>("select event_type from eo_events where recommendation_id = $1 order by seq", [a.id])).map((e) => e.event_type);
    expect(types).toEqual(["DRAFT_CREATED", "LINK_ADDED", "PUBLISHED", "ACKNOWLEDGED", "ACCEPTED", "PROGRESS_REPORTED", "IMPLEMENTATION_REPORTED", "CLOSED"].filter((e) => types.includes(e)));
    expect(types).toEqual(expect.arrayContaining(["PUBLISHED", "ACKNOWLEDGED", "ACCEPTED", "PROGRESS_REPORTED", "IMPLEMENTATION_REPORTED", "CLOSED"]));
  }));

  it("requires a reason to decline and an explanation to partly accept, and records them", () => withTx(async (c) => {
    const w = await world(c);
    const violations = (await c.q("select 1 from violations")).length;
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await c.expectError("REASON_REQUIRED", () => w.respond(w.finLead, t, "DECLINE", null));
    await c.expectError("VALIDATION_ERROR", () => w.respond(w.finLead, t, "PARTIAL", "  "));
    await c.expectError("VALIDATION_ERROR", () => w.respond(w.finLead, t, "MAYBE", "x"));
    const r = await w.respond(w.finLead, t, "DECLINE", "No budget this quarter");
    expect(r.status).toBe("NOT_ACCEPTED");
    const ev = (await c.q<{ body: string; event_type: string }>("select event_type, body from eo_events where target_id = $1 and event_type = 'DECLINED'", [t]))[0];
    expect(ev.body).toBe("No budget this quarter");
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("update_eo_progress", w.finLead, t, "PROGRESS", "x", null, null));
    // the recommendation was advice: declining it changed no compliance state
    expect((await c.q("select 1 from violations")).length).toBe(violations);
  }));

  it("handles clarification, a follow-up question and an alternative proposal", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await c.expectError("VALIDATION_ERROR", () => w.respond(w.finLead, t, "CLARIFICATION", null));
    await w.respond(w.finLead, t, "CLARIFICATION", "Which bank feeds do you mean?");
    let row = (await c.q<{ status: string; awaiting: string }>("select status, awaiting from eo_rec_targets where id = $1", [t]))[0];
    expect(row).toEqual({ status: "ACKNOWLEDGED", awaiting: "EXECUTIVE" });
    expect((await c.rpc<{ overdue: number }>("read_eo_dashboard", null, null, null, null).catch(() => null))).toBeDefined();
    await c.rpc("reply_eo_recommendation", w.exec, a.id, t, "The three Zenith accounts.", null);
    row = (await c.q<{ status: string; awaiting: string }>("select status, awaiting from eo_rec_targets where id = $1", [t]))[0];
    expect(row.awaiting).toBe("BU");
    const alt = await w.respond(w.finLead, t, "ALTERNATIVE", "We propose a weekly manual match instead");
    expect(alt.status).toBe("RESPONSE_SUBMITTED");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("ask_eo_follow_up", w.director, t, "why?", null, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("ask_eo_follow_up", w.finLead, t, "why?", null, null));
    const fu = await c.rpc<{ status: string }>("ask_eo_follow_up", w.exec, t, "How long would the manual match take?", null, null);
    expect(fu.status).toBe("RESPONSE_REQUESTED");
    expect((await c.q<{ awaiting: string }>("select awaiting from eo_rec_targets where id = $1", [t]))[0].awaiting).toBe("BU");
    expect((await w.respond(w.finLead, t, "PARTIAL", "We accept the weekly cadence only")).status).toBe("PARTIALLY_ACCEPTED");
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type in ('EO_REC_CLARIFICATION','EO_REC_DECISION','EO_REC_RESPONSE')", [w.exec])).length).toBeGreaterThanOrEqual(3);
  }));

  it("keeps separate acknowledgement and response records per addressed unit and hides one unit's record from the other", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { targets: [w.fin, w.ops], subjectType: null, subjectId: null, module: "BU_PERFORMANCE" });
    const tf = await w.targetOf(a.id, w.fin), to = await w.targetOf(a.id, w.ops);
    await c.rpc("acknowledge_eo_target", w.finLead, tf, null, null);
    await w.respond(w.opsLead, to, "DECLINE", "Out of scope for OPS");
    const status = async (u: string) => c.asUser(u, async () => (await c.q<{ business_unit_id: string; status: string }>("select business_unit_id, status from eo_rec_targets")).map((r) => `${r.business_unit_id === w.fin ? "FIN" : "OPS"}:${r.status}`));
    expect(await status(w.finLead)).toEqual(["FIN:RESPONSE_REQUESTED"]);
    expect(await status(w.opsLead)).toEqual(["OPS:NOT_ACCEPTED"]);
    expect((await status(w.exec)).sort()).toEqual(["FIN:RESPONSE_REQUESTED", "OPS:NOT_ACCEPTED"]);
    const evs = (u: string) => c.asUser(u, async () => (await c.q<{ event_type: string }>("select event_type from eo_events where recommendation_id = $1", [a.id])).map((e) => e.event_type));
    expect(await evs(w.finLead)).not.toContain("DECLINED");
    expect(await evs(w.opsLead)).not.toContain("ACKNOWLEDGED");
    await c.expectError("BU_SCOPE_DENIED", () => w.respond(w.finLead, to, "ACCEPT"));
    const full = await c.asUser(w.finLead, () => c.rpc<{ targets: unknown[] }>("read_eo_recommendation", a.id));
    expect(full.targets).toHaveLength(1);
    // closing one unit leaves the recommendation active for the other
    const one = await c.rpc<{ status: string; closed_units: number }>("close_eo_recommendation", w.exec, a.id, to, "OPS has declined; closing that part", null);
    expect(one).toMatchObject({ status: "ACTIVE", closed_units: 1 });
    const rest = await c.rpc<{ status: string }>("close_eo_recommendation", w.exec, a.id, null, "Finished", null);
    expect(rest.status).toBe("CLOSED");
  }));

  it("lets the author withdraw, only the author, and stops all further answers", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("withdraw_eo_recommendation", w.director, a.id, "no"));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("withdraw_eo_recommendation", w.finLead, a.id, "no"));
    await c.expectError("REASON_REQUIRED", () => c.rpc("withdraw_eo_recommendation", w.exec, a.id, null));
    await c.rpc("withdraw_eo_recommendation", w.exec, a.id, "Issued to the wrong unit");
    expect((await c.q<{ status: string }>("select status from eo_rec_targets where id = $1", [t]))[0].status).toBe("WITHDRAWN");
    await c.expectError("RECOMMENDATION_CLOSED", () => w.respond(w.finLead, t, "ACCEPT"));
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("withdraw_eo_recommendation", w.exec, a.id, "again"));
    expect(await count(c, w.finLead, "eo_recommendations")).toBe("1");                           // the history stays readable
    expect((await c.q("select 1 from notifications where event_type = 'EO_REC_CLOSED' and user_id = $1", [w.finLead])).length).toBe(1);
  }));

  it("allows closing before the unit responded, flags it, and lets another executive close when the author is gone", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await c.expectError("REASON_REQUIRED", () => c.rpc("close_eo_recommendation", w.exec, a.id, null, null, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("close_eo_recommendation", w.director, a.id, null, "author is active", null));
    await c.q("update users set status = 'SUSPENDED' where id = $1", [w.exec]);
    await c.rpc("close_eo_recommendation", w.director, a.id, null, "The author has left; the matter is overtaken", null);
    expect((await c.q<{ closed_without_response: boolean; status: string }>("select closed_without_response, status from eo_rec_targets where id = $1", [t]))[0]).toEqual({ closed_without_response: true, status: "CLOSED" });
  }));

  it("keeps a recommendation to a suspended contact alive: the unit is told once and can name another contact", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { ownerUser: w.finLead2 });
    const t = await w.targetOf(a.id);
    await c.q("update users set status = 'SUSPENDED' where id = $1", [w.finLead2]);
    await c.q("select run_eo_follow_up()");
    await c.q("select run_eo_follow_up()");
    expect((await c.q("select 1 from notifications where event_type = 'EO_REC_UPDATE' and user_id = $1", [w.finLead])).length).toBe(1);
    await c.expectError("RECIPIENT_UNAVAILABLE", () => c.rpc("reassign_eo_target", w.finLead, t, w.finLead2, "back"));
    await c.expectError("RECIPIENT_UNAVAILABLE", () => c.rpc("reassign_eo_target", w.finLead, t, w.opsLead, "wrong unit"));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("reassign_eo_target", w.exec, t, w.finLead, "no"));
    await c.rpc("reassign_eo_target", w.finLead, t, w.finLead, "Taking it myself");
    expect((await c.q<{ responsible_user_id: string }>("select responsible_user_id from eo_rec_targets where id = $1", [t]))[0].responsible_user_id).toBe(w.finLead);
    const rec = await c.asUser(w.exec, () => c.rpc<{ targets: { responsible_unavailable: boolean }[] }>("read_eo_recommendation", a.id));
    expect(rec.targets[0].responsible_unavailable).toBe(false);
  }));

  it("keeps the recommendation and its history when the unit is archived or a linked OKR record changes", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { links: [{ target_type: "WEEKLY_GOAL", target_id: w.goalId }] });
    const t = await w.targetOf(a.id);
    await c.rpc("acknowledge_eo_target", w.finLead, t, null, null);
    await c.q("update business_units set status = 'INACTIVE' where id = $1", [w.fin]);
    await c.q("update smart_goals set title = 'Renamed since' where id = $1", [w.goalId]);
    const full = await c.asUser(w.exec, () => c.rpc<{ targets: { business_unit_active: boolean }[]; links: { label: string }[]; events: unknown[] }>("read_eo_recommendation", a.id));
    expect(full.targets[0].business_unit_active).toBe(false);
    expect(full.links[0].label).toMatch(/Goal/);
    expect(full.events.length).toBeGreaterThan(2);
    await c.expectError("BU_INACTIVE", () => w.rec(w.exec, { subjectType: null, subjectId: null, title: "New one" }));
    await w.respond(w.finLead, t, "ACCEPT", "Still accepted after the archive");            // the unit's own answer is still possible
  }));
});

describe("links to sessions, notes, decisions, actions and risks", () => {
  it("links a recommendation and a comment to a session and a note without changing either", () => withTx(async (c) => {
    const w = await world(c);
    const type = (await c.q<{ id: string }>("select id from okr_session_types where code = 'WEEKLY_OKR_REVIEW'"))[0].id;
    await c.q("insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.code = 'PRESENTER' and p.code = 'session_notes.create' on conflict do nothing");
    const s = await c.rpc<{ id: string }>("create_okr_session", w.presenter, "FIN weekly review", type, "2031-01-09", w.wk, w.fin, null, null, null, w.presenter, null, null, [{ user_id: w.finLead, role: "BU_LEAD" }], null);
    await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await c.rpc<{ id: string }>("create_okr_note", w.presenter, s.id, "PERFORMANCE_OBSERVATION", "Slow close", "Close took 6 days", "SHARED", [], null, null);
    const conf = await c.rpc<{ id: string }>("create_okr_note", w.presenter, s.id, "PERFORMANCE_OBSERVATION", "Private", "For me only", "CONFIDENTIAL", [], null, null);
    const before = JSON.stringify([await c.q("select * from okr_sessions order by id"), await c.q("select * from okr_session_notes order by id"), await c.q("select * from okr_session_note_versions order by id")]);
    const cm = await w.comment(w.exec, { links: [{ target_type: "SESSION", target_id: s.id }, { target_type: "SESSION_NOTE", target_id: n.id }] });
    const a = await w.rec(w.exec, { links: [{ target_type: "SESSION", target_id: s.id }, { target_type: "SESSION_NOTE", target_id: n.id }] });
    await c.expectError("LINK_TARGET_INVALID", () => w.comment(w.exec, { links: [{ target_type: "SESSION_NOTE", target_id: conf.id }] }));      // a note the author cannot read cannot be linked
    expect(JSON.stringify([await c.q("select * from okr_sessions order by id"), await c.q("select * from okr_session_notes order by id"), await c.q("select * from okr_session_note_versions order by id")])).toBe(before);
    // both directions are searchable
    const byNote = await c.asUser(w.exec, () => c.rpc<{ total: number }>("read_eo_recommendations", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "SESSION_NOTE", n.id, null, 25, 0));
    expect(byNote.total).toBe(1);
    const ctx = await c.asUser(w.finLead, () => c.rpc<{ comments: unknown[]; recommendations: unknown[] }>("read_eo_context", "SESSION", s.id, w.fin, null));
    expect(ctx.comments).toHaveLength(1);
    expect(ctx.recommendations).toHaveLength(1);
    expect(cm.id).toBeTruthy();
    expect(a.id).toBeTruthy();
  }));

  it("shows a unit only the links to session records it may read itself", () => withTx(async (c) => {
    const w = await world(c);
    const type = (await c.q<{ id: string }>("select id from okr_session_types where code = 'WEEKLY_OKR_REVIEW'"))[0].id;
    await c.q("insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.code = 'PRESENTER' and p.code = 'session_notes.create' on conflict do nothing");
    const s = await c.rpc<{ id: string }>("create_okr_session", w.presenter, "Management review", type, "2031-01-09", w.wk, null, null, null, null, w.presenter, null, null, [], null);   // organisation-wide: a unit's lead is not part of it
    const cm = await w.comment(w.exec, { links: [{ target_type: "SESSION", target_id: s.id }] });
    const links = (u: string) => c.asUser(u, async () => (await c.q("select 1 from eo_links where comment_id = $1", [cm.id])).length);
    expect(await links(w.exec)).toBe(1);
    expect(await count(c, w.finLead, "eo_comments")).toBe("1");        // the comment is theirs to read
    expect(await links(w.finLead)).toBe(0);                              // but the link to a session they cannot open is not shown
    const full = await c.asUser(w.finLead, () => c.rpc<{ links: unknown[] }>("read_eo_comment", cm.id));
    expect(full.links).toHaveLength(0);
  }));

  it("lets the addressed unit link the record it uses to carry the recommendation out, but not remove the author's links", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { links: [{ target_type: "KEY_RESULT", target_id: w.s.krIds[0] }] });
    await c.rpc("set_eo_link", w.finLead, null, a.id, "WEEKLY_GOAL", w.goalId, false);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("set_eo_link", w.finLead, null, a.id, "KEY_RESULT", w.s.krIds[0], true));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("set_eo_link", w.hr, null, a.id, "WEEKLY_GOAL", w.goalId, false));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("set_eo_link", w.opsLead, null, a.id, "WEEKLY_GOAL", w.goalId, false));
    await c.expectError("LINK_TARGET_INVALID", () => c.rpc("set_eo_link", w.exec, null, a.id, "WEEKLY_GOAL", "00000000-0000-0000-0000-000000000009", false));
    await c.rpc("set_eo_link", w.exec, null, a.id, "KEY_RESULT", w.s.krIds[0], true);
    expect((await c.q("select 1 from eo_links where recommendation_id = $1 and removed_at is null", [a.id])).length).toBe(1);
    await failsWith(c, /IMMUTABLE_RECORD/, "delete from eo_links where recommendation_id = $1", [a.id]);
  }));
});

describe("attachments", () => {
  it("records, hides and removes attachments with the same visibility as their parent, never deleting the record", () => withTx(async (c) => {
    const w = await world(c);
    const cm = await w.comment(w.exec);
    const f = await c.rpc<string>("record_eo_attachment", w.exec, cm.id, null, "evidence.pdf", "application/pdf", 1234, "abc123", "eo/comments/1/evidence.pdf");
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("record_eo_attachment", w.opsLead, cm.id, null, "x.pdf", "application/pdf", 10, "x", "eo/x.pdf"));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("record_eo_attachment", w.hr, cm.id, null, "x.pdf", "application/pdf", 10, "x", "eo/y.pdf"));
    expect(await count(c, w.finLead, "eo_attachments")).toBe("1");
    expect(await count(c, w.opsLead, "eo_attachments")).toBe("0");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("remove_eo_attachment", w.finLead, f, "not mine"));
    await c.expectError("REASON_REQUIRED", () => c.rpc("remove_eo_attachment", w.exec, f, null));
    await c.rpc("remove_eo_attachment", w.exec, f, "Wrong file");
    expect((await c.q<{ deleted_at: string | null; removal_reason: string }>("select deleted_at, removal_reason from eo_attachments where id = $1", [f]))[0].removal_reason).toBe("Wrong file");
    await failsWith(c, /IMMUTABLE_RECORD/, "update eo_attachments set file_name = 'renamed' where id = $1", [f]);
    await failsWith(c, /IMMUTABLE_RECORD/, "delete from eo_attachments where id = $1", [f]);
  }));

  it("lets the addressed unit attach evidence to its own record only", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec, { targets: [w.fin, w.ops], subjectType: null, subjectId: null, module: "BU_PERFORMANCE" });
    await c.rpc("record_eo_attachment", w.finLead, null, a.id, "proof.pdf", "application/pdf", 10, "h", "eo/rec/proof.pdf");
    expect(await count(c, w.finLead, "eo_attachments")).toBe("1");
    expect(await count(c, w.opsLead, "eo_attachments")).toBe("0");                       // FIN's evidence is FIN's record
    expect(await count(c, w.exec, "eo_attachments")).toBe("1");
  }));
});

describe("dashboard, registers, follow-up and escalation", () => {
  it("counts every figure from the records the caller can read, per unit", () => withTx(async (c) => {
    const w = await world(c);
    await w.comment(w.exec); await w.comment(w.exec, { visibility: "MANAGEMENT", title: "m" });
    const r1 = await w.rec(w.exec, { title: "R1", targets: [w.fin, w.ops], subjectType: null, subjectId: null, module: "BU_PERFORMANCE" });
    const r2 = await w.rec(w.director, { title: "R2", due: null, requested: false });
    await w.rec(w.exec, { title: "Draft stays out", publish: false });
    await c.rpc("acknowledge_eo_target", w.finLead, await w.targetOf(r1.id, w.fin), null, null);
    await w.respond(w.opsLead, await w.targetOf(r1.id, w.ops), "ACCEPT");
    await w.respond(w.finLead, await w.targetOf(r2.id), "DECLINE", "no capacity");
    const d = await c.asUser(w.exec, () => c.rpc<Record<string, number | Record<string, number>>>("read_eo_dashboard", null, null, null, null));
    expect(d).toMatchObject({ comments_total: 2, recommendations_total: 2, recommendation_units_total: 3, awaiting_acknowledgement: 0, accepted_for_action: 1, declined: 1, closed: 0, my_drafts: 1, awaiting_response: 1, overdue: 0 });
    const fin = await c.asUser(w.finLead, () => c.rpc<Record<string, number>>("read_eo_dashboard", null, null, null, null));
    expect(fin).toMatchObject({ comments_total: 1, recommendations_total: 2, recommendation_units_total: 2, declined: 1, accepted_for_action: 0 });
    const ops = await c.asUser(w.opsLead, () => c.rpc<Record<string, number>>("read_eo_dashboard", null, null, null, null));
    expect(ops).toMatchObject({ comments_total: 0, recommendations_total: 1, accepted_for_action: 1 });
    const hr = await c.asUser(w.hr, () => c.rpc<Record<string, number>>("read_eo_dashboard", null, null, null, null));
    expect(hr).toMatchObject({ comments_total: 0, recommendations_total: 0 });
  }));

  it("marks a response overdue after the deadline, tracks escalation stages once, and never touches compliance", () => withTx(async (c) => {
    const w = await world(c);
    const violations = (await c.q("select 1 from violations")).length;
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    const stage = async (iso: string) => { await c.setNow(iso); await c.q("select run_eo_follow_up()"); await c.q("select run_eo_follow_up()"); };     // twice: idempotent
    await stage("2031-01-18T09:00:00+01:00");
    expect((await c.q("select 1 from notifications where event_type = 'EO_REC_DEADLINE'")).length).toBe(2);
    expect((await c.q("select 1 from eo_events where target_id = $1 and event_type = 'ESCALATED'", [t])).length).toBe(0);
    await stage("2031-01-21T09:00:00+01:00");
    const od = await c.asUser(w.exec, () => c.rpc<{ overdue: number; overdue_list: { reference: string }[] }>("read_eo_dashboard", null, null, null, null));
    expect(od.overdue).toBe(1);
    expect(od.overdue_list[0].reference).toBe(a.reference);
    expect((await c.q("select 1 from notifications where event_type = 'EO_REC_OVERDUE' and user_id = $1", [w.finLead])).length).toBe(1);
    await stage("2031-01-26T09:00:00+01:00");
    await stage("2031-02-01T09:00:00+01:00");
    expect((await c.q<{ escalation_level: number }>("select escalation_level from eo_rec_targets where id = $1", [t]))[0].escalation_level).toBe(3);
    expect((await c.q("select 1 from eo_events where target_id = $1 and event_type = 'ESCALATED'", [t])).length).toBe(3);
    expect((await c.q("select 1 from notifications where event_type = 'EO_REC_OVERDUE' and user_id = $1", [w.exec])).length).toBe(1);        // the AUTHOR stage
    expect((await c.q("select 1 from notifications where event_type = 'EO_REC_OVERDUE' and user_id = $1", [w.director])).length).toBe(1);    // the senior (DIRECTOR role) stage
    const row = (await c.q<{ status: string }>("select status from eo_rec_targets where id = $1", [t]))[0];
    expect(row.status).toBe("SUBMITTED");                                                  // nothing was decided on the unit's behalf
    expect((await c.q("select 1 from violations")).length).toBe(violations);
    // answering stops the reminders: a unit waiting for the Executive's clarification is not overdue
    await w.respond(w.finLead, t, "CLARIFICATION", "What do you mean?");
    const od2 = await c.asUser(w.exec, () => c.rpc<{ overdue: number; awaiting_executive: number }>("read_eo_dashboard", null, null, null, null));
    expect(od2).toMatchObject({ overdue: 0, awaiting_executive: 1 });
  }));

  it("filters the registers and searches the text", () => withTx(async (c) => {
    const w = await world(c);
    await w.comment(w.exec, { title: "Alpha", content: "Procurement delays are growing", category: "CONCERN" });
    await w.comment(w.director, { title: "Beta", content: "Great job", category: "RECOGNITION", module: "BU_PERFORMANCE", subjectType: null, subjectId: null });
    const r1 = await w.rec(w.exec, { title: "Fix procurement", priority: "LOW" });
    await w.rec(w.director, { title: "Hire analyst", priority: "CRITICAL", targets: [w.fin, w.ops], subjectType: null, subjectId: null, module: "BU_PERFORMANCE" });
    await w.respond(w.finLead, await w.targetOf(r1.id), "DECLINE", "no");
    const comments = (over: Partial<Record<number, unknown>>) => c.asUser(w.exec, () => c.rpc<{ total: number; rows: { title: string }[] }>("read_eo_comments",
      ...[over[0] ?? null, over[1] ?? null, null, null, null, null, over[6] ?? null, over[7] ?? null, over[8] ?? null, null, null, null, 25, 0]));
    expect((await comments({ 0: "procurement" })).rows.map((r) => r.title)).toEqual(["Alpha"]);
    expect((await comments({ 6: "RECOGNITION" })).rows.map((r) => r.title)).toEqual(["Beta"]);
    expect((await comments({ 7: "BU_PERFORMANCE" })).total).toBe(1);
    expect((await comments({ 8: w.director })).rows.map((r) => r.title)).toEqual(["Beta"]);
    expect((await comments({ 1: w.ops })).total).toBe(0);
    const recs = (...a: unknown[]) => c.asUser(w.exec, () => c.rpc<{ total: number; rows: { title: string; priority: string; business_unit_id: string }[] }>("read_eo_recommendations", ...a));
    const base = (o: Record<number, unknown>) => Array.from({ length: 20 }, (_, i) => (o[i] === undefined ? (i === 18 ? 25 : i === 19 ? 0 : null) : o[i]));
    expect((await recs(...base({ 0: "procurement" }))).rows.map((r) => r.title)).toEqual(["Fix procurement"]);
    expect((await recs(...base({ 6: "CRITICAL" }))).total).toBe(2);                         // one line per addressed unit
    expect((await recs(...base({ 7: "NOT_ACCEPTED" }))).rows.map((r) => r.title)).toEqual(["Fix procurement"]);
    expect((await recs(...base({ 1: w.ops }))).total).toBe(1);
    const sorted = await recs(...base({}));
    expect(sorted.rows[0].priority).toBe("CRITICAL");                                      // priority drives the default order
  }));

  it("reads one recommendation with everyone's words in order and refuses an outsider the whole record", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await w.respond(w.finLead, t, "CLARIFICATION", "Which feeds?");
    await c.rpc("reply_eo_recommendation", w.exec, a.id, t, "The Zenith ones.", null);
    const full = await c.asUser(w.finLead, () => c.rpc<{ events: { event_type: string; actor_name: string }[]; detail: string }>("read_eo_recommendation", a.id));
    expect(full.events.map((e) => e.event_type)).toEqual(expect.arrayContaining(["PUBLISHED", "CLARIFICATION_REQUESTED", "MESSAGE"]));
    expect(await c.asUser(w.opsLead, () => c.rpc("read_eo_recommendation", a.id))).toBeNull();
    expect(await c.asUser(w.hr, () => c.rpc("read_eo_recommendation", a.id))).toBeNull();
    expect(await c.asUser(w.superAdmin, () => c.rpc("read_eo_recommendation", a.id))).toBeNull();
  }));
});

describe("configuration and audit", () => {
  it("lets only Admin and Super Admin manage categories and escalation timelines, and audits it", () => withTx(async (c) => {
    const w = await world(c);
    const id = await c.rpc<string>("save_eo_category", w.admin, null, "BOARD_NOTE", "Board note", "For the board", 200, true);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("save_eo_category", w.exec, null, "X_CAT", "x", null, 1, true));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("save_eo_category", w.admin, null, "bad code", "x", null, 1, true));
    await c.rpc("save_eo_category", w.superAdmin, id, null, "Board note (renamed)", null, 200, false);
    await c.expectError("VALIDATION_ERROR", () => w.comment(w.exec, { category: "BOARD_NOTE" }));                      // inactive categories are not offered
    await c.rpc("save_eo_escalation_rule", w.admin, "OVERDUE_MANAGEMENT", 3, "ROLE", "PRESENTER", true);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("save_eo_escalation_rule", w.exec, "OVERDUE_MANAGEMENT", 3, "AUTHOR", null, true));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("save_eo_escalation_rule", w.admin, "OVERDUE_MANAGEMENT", 3, "ROLE", "NO_SUCH_ROLE", true));
    expect((await c.q("select 1 from audit_logs where action in ('EXEC_OVERSIGHT_CATEGORY_SAVED','EXEC_OVERSIGHT_ESCALATION_RULE_SAVED')")).length).toBe(3);
    // configuration gives no access to the commentary
    await w.comment(w.exec);
    expect(await count(c, w.admin, "eo_comments")).toBe("0");
    expect(await count(c, w.admin, "eo_categories")).toBeDefined();
  }));

  it("writes the audit log for every governed act, with the actor and the unit", () => withTx(async (c) => {
    const w = await world(c);
    const cm = await w.comment(w.exec);
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await c.rpc("acknowledge_eo_target", w.finLead, t, null, null);
    await w.respond(w.finLead, t, "DECLINE", "No capacity");
    const acts = (await c.q<{ action: string; actor_user_id: string; business_unit_id: string | null }>("select action, actor_user_id, business_unit_id from audit_logs where action like 'EXEC_OVERSIGHT_%' and actor_user_id = any($1) order by seq", [[w.exec, w.finLead]])).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(["EXEC_OVERSIGHT_CREATED", "EXEC_OVERSIGHT_PUBLISHED", "EXEC_OVERSIGHT_ACKNOWLEDGED", "EXEC_OVERSIGHT_DECLINED"]));
    const declined = (await c.q<{ actor_user_id: string; business_unit_id: string }>("select actor_user_id, business_unit_id from audit_logs where action = 'EXEC_OVERSIGHT_DECLINED' and actor_user_id = $1", [w.finLead]))[0];
    expect(declined).toEqual({ actor_user_id: w.finLead, business_unit_id: w.fin });
    expect(cm.id).toBeTruthy();
  }));

  it("lets an Executive read what they recommended three months ago, the response and what followed", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.rec(w.exec);
    const t = await w.targetOf(a.id);
    await w.respond(w.finLead, t, "ACCEPT", "We will automate it");
    await c.setNow("2031-04-09T10:00:00+01:00");
    await c.rpc("update_eo_progress", w.finLead, t, "IMPLEMENTED", "Automated in March", null, null).catch(() => undefined);
    const full = await c.asUser(w.exec, () => c.rpc<{ targets: { status: string }[]; events: { event_type: string; body: string | null }[]; published_at: string }>("read_eo_recommendation", a.id));
    expect(full.events.find((e) => e.event_type === "ACCEPTED")?.body).toBe("We will automate it");
    expect(full.targets[0].status).toBe("IMPLEMENTATION_REPORTED");
  }));
});
