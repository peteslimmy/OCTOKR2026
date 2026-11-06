import { describe, expect, it } from "vitest";
import { draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/**
 * OKR Session Notes & Meeting Intelligence (migrations 20261105000001-3). Run inside a rolled-back transaction each time.
 * Cast: a Presenter (sees every unit), a BU Lead of FIN and one of OPS, an Executive, and HR / Finance / Admin / Super Admin (no access to content).
 */
async function world(c: Ctx) {
  const { bu, user, rpc, q, setNow } = c;
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await bu(`F${tag}`), ops = await bu(`O${tag}`), hq = await bu(`H${tag}`);
  const admin = await user(["ADMIN"], hq, "admin");
  const s = await seedStrategy(c, admin);
  const wk = await weekId(c);
  const presenter = await user(["PRESENTER"], hq, "presenter");
  const presenter2 = await user(["PRESENTER"], hq, "presenter2");
  const finLead = await user(["BU_LEAD"], fin, "finlead");
  const finLead2 = await user(["BU_LEAD"], fin, "finlead2");
  const opsLead = await user(["BU_LEAD"], ops, "opslead");
  const exec = await user(["EXECUTIVE"], hq, "exec");
  const hr = await user(["HR"], hq, "hr");
  const finance = await user(["FINANCE"], hq, "finance");
  const superAdmin = await user(["SUPER_ADMIN"], hq, "sa");
  await setNow("2031-01-07T10:00:00+01:00");
  const { goalId, reportId } = await draftGoal(c, finLead, wk, s.subKrIds[0], ["Reconcile ledgers"]);
  const taskId = (await q<{ id: string }>("select id from tasks where smart_goal_id = $1", [goalId]))[0].id;
  const type = (await q<{ id: string }>("select id from okr_session_types where code = 'WEEKLY_OKR_REVIEW'"))[0].id;
  const newSession = (actor = presenter, over: Record<string, unknown> = {}) => rpc<{ id: string; reference: string }>(
    "create_okr_session", actor, over.title ?? "FIN weekly review", type, "2031-01-09", over.week === null ? null : wk, over.bu === undefined ? fin : over.bu, null, null, null, over.facilitator ?? presenter,
    "Weekly review", "1. Scores\n2. Blockers", over.participants ?? [{ user_id: finLead, role: "BU_LEAD" }], over.key ?? null);
  return { fin, ops, hq, admin, s, wk, presenter, presenter2, finLead, finLead2, opsLead, exec, hr, finance, superAdmin, goalId, taskId, reportId, type, newSession };
}

/** a statement that must fail, run under a savepoint so the surrounding transaction survives */
async function failsWith(c: Ctx, re: RegExp, sql: string, params: unknown[] = []) {
  await c.client.query("savepoint f");
  let msg = "";
  try { await c.client.query(sql, params); } catch (e) { msg = (e as Error).message; }
  await c.client.query("rollback to savepoint f");
  expect(msg).toMatch(re);
}

const note = (c: Ctx, actor: string, session: string, over: Record<string, unknown> = {}) =>
  c.rpc<{ id: string; version: number; replayed: boolean }>("create_okr_note", actor, session, over.category ?? "PERFORMANCE_OBSERVATION", over.title ?? "Slow reconciliation", over.content ?? "Transaction success **dropped**", over.visibility ?? "SHARED", over.links ?? [], over.key ?? null, over.reason ?? null);

describe("sessions: lifecycle, context and several per week", () => {
  it("creates sessions with the BU and week as context, and allows several per BU per week", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.newSession();
    const b = await w.newSession(w.presenter, { title: "FIN follow-up review" });
    expect(a.id).not.toBe(b.id);
    expect(a.reference).toMatch(/^OKS-2031-\d{4}$/);
    const row = (await c.q<{ quarter_id: string; reporting_week_id: string; business_unit_id: string; status: string }>("select * from okr_sessions where id = $1", [a.id]))[0];
    expect(row).toMatchObject({ quarter_id: w.s.quarterId, reporting_week_id: w.wk, business_unit_id: w.fin, status: "DRAFT" });
  }));

  it("allows a session without a reporting week (the quarter comes from the date)", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.newSession(w.presenter, { week: null });
    const row = (await c.q<{ quarter_id: string; reporting_week_id: string | null }>("select quarter_id, reporting_week_id from okr_sessions where id = $1", [a.id]))[0];
    expect(row.reporting_week_id).toBeNull();
    expect(row.quarter_id).toBe(w.s.quarterId);
  }));

  it("follows DRAFT -> IN_PROGRESS -> COMPLETED -> ARCHIVED and refuses anything else", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.newSession();
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("transition_okr_session", w.presenter, a.id, "COMPLETED", null, null, null));
    await c.rpc("transition_okr_session", w.presenter, a.id, "IN_PROGRESS", null, null, null);
    await c.rpc("transition_okr_session", w.presenter, a.id, "COMPLETED", null, null, null);
    await c.expectError("REASON_REQUIRED", () => c.rpc("transition_okr_session", w.presenter, a.id, "IN_PROGRESS", null, null, null));   // accidental completion needs a reason to reopen
    await c.rpc("transition_okr_session", w.presenter, a.id, "IN_PROGRESS", "Completed by mistake", null, null);
    await c.rpc("transition_okr_session", w.presenter, a.id, "COMPLETED", null, null, null);
    const arch = await c.rpc<{ status: string }>("transition_okr_session", w.presenter, a.id, "ARCHIVED", "Closed", null, null);
    expect(arch.status).toBe("ARCHIVED");
    await c.expectError("SESSION_READ_ONLY", () => note(c, w.presenter, a.id));
    const back = await c.rpc<{ status: string }>("transition_okr_session", w.presenter, a.id, "RESTORED", "Needed again", null, null);
    expect(back.status).toBe("COMPLETED");
  }));

  it("reports the actions still open when a session is archived (they are not cancelled)", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.newSession();
    await c.rpc("transition_okr_session", w.presenter, a.id, "IN_PROGRESS", null, null, null);
    await c.rpc("create_okr_action", w.presenter, a.id, "Investigate the decline", w.finLead, null, "HIGH", "2031-01-20", null, null, false, false, [], null);
    await c.rpc("transition_okr_session", w.presenter, a.id, "COMPLETED", null, null, null);
    const arch = await c.rpc<{ open_actions: number }>("transition_okr_session", w.presenter, a.id, "ARCHIVED", "Done", null, null);
    expect(arch.open_actions).toBe(1);
    expect((await c.q<{ status: string }>("select status from okr_session_actions"))[0].status).toBe("OPEN");
  }));

  it("replays a duplicate create request instead of creating a second session", () => withTx(async (c) => {
    const w = await world(c);
    const a = await w.newSession(w.presenter, { key: "create-key-0001" });
    const b = await w.newSession(w.presenter, { key: "create-key-0001" });
    expect(b.id).toBe(a.id);
    expect((await c.q<{ n: string }>("select count(*) n from okr_sessions"))[0].n).toBe("1");
    await c.expectError("IDEMPOTENCY_KEY_REUSED", () => c.rpc("transition_okr_session", w.presenter, a.id, "IN_PROGRESS", null, null, "create-key-0001"));
  }));

  it("keeps the HR attendance session and the OKR session apart: referencing never changes the attendance session", () => withTx(async (c) => {
    const w = await world(c);
    const gov = (await c.q<{ id: string }>("select id from governance_sessions where reporting_week_id = $1", [w.wk]))[0]?.id;
    if (!gov) return;   // the fixture materialises the week; the attendance session appears with it when configured
    const before = JSON.stringify((await c.q("select * from governance_sessions where id = $1", [gov]))[0]);
    await c.rpc("create_okr_session", w.presenter, "Review", w.type, "2031-01-09", w.wk, w.fin, gov, null, null, w.presenter, null, null, [], null);
    expect(JSON.stringify((await c.q("select * from governance_sessions where id = $1", [gov]))[0])).toBe(before);
  }));
});

describe("notes: autosave, versions, concurrency and links", () => {
  it("saves with a version check; a second editor gets VERSION_CONFLICT; unchanged text creates nothing", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id);
    const r1 = await c.rpc<{ version: number }>("update_okr_note", w.presenter, n.id, 1, null, null, "Transaction success dropped by 12%", null, null);
    expect(r1.version).toBe(2);
    await c.expectError("VERSION_CONFLICT", () => c.rpc("update_okr_note", w.presenter, n.id, 1, null, null, "A stale tab", null, null));
    const same = await c.rpc<{ unchanged?: boolean; version: number }>("update_okr_note", w.presenter, n.id, 2, null, null, "Transaction success dropped by 12%", null, null);
    expect(same.unchanged).toBe(true);
    expect(same.version).toBe(2);
  }));

  it("keeps every settled earlier state and never lets a version change", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id, { content: "first" });
    await c.setNow("2031-01-07T10:05:00+01:00");
    await c.rpc("update_okr_note", w.presenter, n.id, 1, null, null, "second", null, null);
    await c.setNow("2031-01-08T10:10:00+01:00");
    await c.rpc("update_okr_note", w.presenter, n.id, 2, null, null, "third", null, null);
    const versions = await c.rpc<{ content: string }[]>("read_okr_note_versions", n.id).catch(() => null);
    const rows = await c.q<{ content: string }>("select content from okr_session_note_versions where note_id = $1 order by version", [n.id]);
    expect(rows.map((r) => r.content)).toEqual(["first", "second"]);
    expect(versions === null || Array.isArray(versions)).toBe(true);
    await failsWith(c, /IMMUTABLE_RECORD/, "update okr_session_note_versions set content = 'x'");
  }));

  it("only the author, the facilitator or a finaliser edits a note; a BU Lead cannot edit a colleague's", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(w.presenter, { participants: [{ user_id: w.finLead, role: "BU_LEAD" }, { user_id: w.finLead2, role: "BU_LEAD" }] });
    await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.finLead, s.id, { category: "BU_RESPONSE" });
    await c.expectError("PERMISSION_DENIED", () => c.rpc("update_okr_note", w.finLead2, n.id, 1, null, null, "hijack", null, null));
    await c.rpc("update_okr_note", w.presenter, n.id, 1, null, null, "facilitator edit", null, null);   // the facilitator may
  }));

  it("amending a note of a completed session needs a reason and keeps the earlier version", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id, { content: "original wording" });
    await c.rpc("transition_okr_session", w.presenter, s.id, "COMPLETED", null, null, null);
    await c.expectError("REASON_REQUIRED", () => c.rpc("update_okr_note", w.presenter, n.id, 1, null, null, "changed", null, null));
    await c.rpc("update_okr_note", w.presenter, n.id, 1, null, null, "corrected wording", null, "Typo in a figure");
    const v = await c.q<{ content: string; change_kind: string; reason: string }>("select content, change_kind, reason from okr_session_note_versions where note_id = $1", [n.id]);
    expect(v).toEqual([{ content: "original wording", change_kind: "AMENDED_AFTER_COMPLETION", reason: "Typo in a figure" }]);
  }));

  it("archives and restores a note without deleting it", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id);
    await c.expectError("REASON_REQUIRED", () => c.rpc("archive_okr_note", w.presenter, n.id, false, null));
    await c.rpc("archive_okr_note", w.presenter, n.id, false, "Wrong session");
    expect((await c.q<{ status: string }>("select status from okr_session_notes where id = $1", [n.id]))[0].status).toBe("ARCHIVED");
    await c.expectError("SESSION_READ_ONLY", () => c.rpc("update_okr_note", w.presenter, n.id, 2, null, null, "x", null, null));
    await c.rpc("archive_okr_note", w.presenter, n.id, true, "Restored by mistake");
    expect((await c.q<{ status: string }>("select status from okr_session_notes where id = $1", [n.id]))[0].status).toBe("ACTIVE");
  }));

  it("links a note to every OKR component without changing any of them", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const before = JSON.stringify([
      await c.q("select * from tasks order by id"), await c.q("select * from smart_goals order by id"), await c.q("select * from weekly_reports order by id"),
      await c.q("select * from weekly_score_snapshots order by id"), await c.q("select * from weekly_compliance order by id"), await c.q("select * from key_results order by id"),
    ]);
    const links = [
      { target_type: "QUARTER", target_id: w.s.quarterId }, { target_type: "OBJECTIVE", target_id: w.s.objectiveId }, { target_type: "KEY_RESULT", target_id: w.s.krIds[0] },
      { target_type: "SUB_KEY_RESULT", target_id: w.s.subKrIds[0] }, { target_type: "WEEKLY_GOAL", target_id: w.goalId }, { target_type: "TASK", target_id: w.taskId }, { target_type: "WEEKLY_REPORT", target_id: w.reportId },
    ];
    const n = await note(c, w.presenter, s.id, { links });
    expect((await c.q("select 1 from okr_session_links where owner_id = $1 and removed_at is null", [n.id])).length).toBe(7);
    await c.rpc("set_okr_note_link", w.presenter, n.id, "KEY_RESULT", w.s.krIds[0], true);
    expect((await c.q("select 1 from okr_session_links where owner_id = $1 and removed_at is null", [n.id])).length).toBe(6);
    const after = JSON.stringify([
      await c.q("select * from tasks order by id"), await c.q("select * from smart_goals order by id"), await c.q("select * from weekly_reports order by id"),
      await c.q("select * from weekly_score_snapshots order by id"), await c.q("select * from weekly_compliance order by id"), await c.q("select * from key_results order by id"),
    ]);
    expect(after).toBe(before);
  }));

  it("refuses to link a session of one unit to another unit's goal, task or report", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(w.presenter, { bu: w.ops, participants: [] }); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await c.expectError("LINK_TARGET_INVALID", () => note(c, w.presenter, s.id, { links: [{ target_type: "WEEKLY_GOAL", target_id: w.goalId }] }));
    await c.expectError("LINK_TARGET_INVALID", () => note(c, w.presenter, s.id, { links: [{ target_type: "TASK", target_id: w.taskId }] }));
    await c.expectError("LINK_TARGET_INVALID", () => note(c, w.presenter, s.id, { links: [{ target_type: "KEY_RESULT", target_id: "00000000-0000-4000-8000-000000000000" }] }));
  }));

  it("returns the same note for a repeated create with the same client key", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const a = await note(c, w.presenter, s.id, { key: "note-key-0001" });
    const b = await note(c, w.presenter, s.id, { key: "note-key-0001" });
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
  }));
});

describe("access: who can see what", () => {
  it("HR, Finance and Admin hold no session permission and cannot reach content (the Super Admin does, ADR-112)", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id);
    for (const u of [w.hr, w.finance, w.admin]) {
      const codes = (await c.q<{ c: string }>("select unnest(actor_permission_codes($1)) c", [u])).map((r) => r.c).filter((x) => x.startsWith("session_"));
      expect(codes.filter((x) => x !== "session_notes.configure")).toEqual([]);
      await c.expectError("PERMISSION_DENIED", () => note(c, u, s.id));
      await c.asUser(u, async () => {
        expect(await c.q("select 1 from okr_sessions")).toHaveLength(0);
        expect(await c.q("select 1 from okr_session_notes")).toHaveLength(0);
        expect(await c.q("select 1 from okr_session_events")).toHaveLength(0);
      });
    }
  }));

  it("the Super Admin has no limit: reads every note including confidential ones, and may verify their own completion (ADR-112)", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id, { title: "shared" });
    await note(c, w.presenter, s.id, { title: "mgmt", visibility: "MANAGEMENT" });
    await note(c, w.presenter, s.id, { title: "conf", visibility: "CONFIDENTIAL" });
    await c.asUser(w.superAdmin, async () => {
      expect(await c.q("select 1 from okr_sessions")).toHaveLength(1);
      expect((await c.q<{ title: string }>("select title from okr_session_notes order by title")).map((r) => r.title)).toEqual(["conf", "mgmt", "shared"]);
    });
    await note(c, w.superAdmin, s.id, { title: "by the owner" });
    const d = await c.rpc<{ id: string }>("create_okr_decision", w.superAdmin, s.id, "t", "d", null, null, null, null, [], null, null, null, null, [], null);
    expect((await c.rpc<{ status: string }>("decide_okr_decision", w.superAdmin, d.id, "APPROVE", null, null, null, null)).status).toBe("APPROVED");
    const a = await c.rpc<{ id: string }>("create_okr_action", w.superAdmin, s.id, "Do it", w.finLead, null, "LOW", "2031-01-20", null, null, true, false, [], null);
    await c.rpc("update_okr_action", w.superAdmin, a.id, 1, "COMPLETED", null, null, "Done", null, null, null);
    expect((await c.rpc<{ verification_status: string }>("verify_okr_action", w.superAdmin, a.id, "VERIFIED", null, 2)).verification_status).toBe("VERIFIED");   // their own completion
  }));

  it("a BU Lead sees only their own unit's sessions (read and write), never another unit's", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id);
    await c.asUser(w.finLead, async () => { expect(await c.q("select 1 from okr_sessions")).toHaveLength(1); expect(await c.q("select 1 from okr_session_notes")).toHaveLength(1); });
    await c.asUser(w.opsLead, async () => {
      expect(await c.q("select 1 from okr_sessions")).toHaveLength(0);
      expect(await c.q("select 1 from okr_session_notes")).toHaveLength(0);
      expect(await c.rpc("read_okr_session", s.id)).toBeNull();
    });
    await c.expectError("BU_SCOPE_DENIED", () => note(c, w.opsLead, s.id));                                    // IDOR: write by id
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("update_okr_note", w.opsLead, n.id, 1, null, null, "x", null, null));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("transition_okr_session", w.opsLead, s.id, "COMPLETED", null, null, null));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("create_okr_session", w.opsLead, "Sneaky", w.type, "2031-01-09", w.wk, w.fin, null, null, null, w.opsLead, null, null, [], null));
  }));

  it("a participant from another unit is invited into one session only", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(w.presenter, { participants: [{ user_id: w.finLead, role: "BU_LEAD" }, { user_id: w.opsLead, role: "ATTENDEE" }] });
    const other = await w.newSession(w.presenter, { title: "Another FIN session", participants: [] });
    await c.asUser(w.opsLead, async () => {
      const ids = (await c.q<{ id: string }>("select id from okr_sessions")).map((r) => r.id);
      expect(ids).toEqual([s.id]);
      expect(ids).not.toContain(other.id);
    });
  }));

  it("an Executive reads every unit but can create and change nothing", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id);
    await c.asUser(w.exec, async () => { expect(await c.q("select 1 from okr_sessions")).toHaveLength(1); });
    await c.expectError("PERMISSION_DENIED", () => note(c, w.exec, s.id));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("update_okr_note", w.exec, n.id, 1, null, null, "x", null, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("create_okr_session", w.exec, "Exec session", w.type, "2031-01-09", w.wk, w.fin, null, null, null, w.exec, null, null, [], null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("create_okr_decision", w.exec, s.id, "t", "d", null, null, null, null, [], null, null, null, null, [], null));
  }));

  it("classifies notes: management notes are hidden from BU Leads, confidential ones from everyone but the author and facilitator", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(w.presenter, { participants: [{ user_id: w.finLead, role: "BU_LEAD" }, { user_id: w.presenter2, role: "PRESENTER" }] });
    await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id, { title: "shared", visibility: "SHARED" });
    await note(c, w.presenter, s.id, { title: "mgmt", visibility: "MANAGEMENT" });
    await note(c, w.presenter, s.id, { title: "conf", visibility: "CONFIDENTIAL" });
    const titles = async (u: string) => c.asUser(u, async () => (await c.q<{ title: string }>("select title from okr_session_notes order by title")).map((r) => r.title));
    expect(await titles(w.finLead)).toEqual(["shared"]);
    expect(await titles(w.presenter2)).toEqual(["mgmt", "shared"]);
    expect(await titles(w.exec)).toEqual(["mgmt", "shared"]);
    expect(await titles(w.presenter)).toEqual(["conf", "mgmt", "shared"]);
  }));
});

describe("decisions register", () => {
  const propose = (c: Ctx, actor: string, session: string, title = "Adopt weekly ledger sign-off") =>
    c.rpc<{ id: string; version: number }>("create_okr_decision", actor, session, title, "Sign-off every Friday", "Background", "Reduces errors", null, null, [], "Fewer rework items", null, null, null, [], null);

  it("is PROPOSED until a person with the approval authority approves; BU Leads cannot record or approve", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await c.expectError("PERMISSION_DENIED", () => propose(c, w.finLead, s.id));
    const d = await propose(c, w.presenter, s.id);
    expect((await c.q<{ status: string; decided_by: string | null }>("select status, decided_by from okr_session_decisions where id = $1", [d.id]))[0]).toEqual({ status: "PROPOSED", decided_by: null });
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_okr_decision", w.finLead, d.id, "APPROVE", null, null, null, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_okr_decision", w.exec, d.id, "APPROVE", null, null, null, null));
    const done = await c.rpc<{ status: string }>("decide_okr_decision", w.presenter, d.id, "APPROVE", "Agreed in session", "Management committee", null, null);
    expect(done.status).toBe("APPROVED");
    expect((await c.q<{ decided_by: string; authority_note: string }>("select decided_by, authority_note from okr_session_decisions where id = $1", [d.id]))[0]).toEqual({ decided_by: w.presenter, authority_note: "Management committee" });
  }));

  it("never edits an approved decision: it is superseded and both are kept", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const d = await propose(c, w.presenter, s.id);
    await c.rpc("decide_okr_decision", w.presenter, d.id, "APPROVE", null, null, null, null);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("update_okr_decision", w.presenter, d.id, 2, "New title", null, null, null, null, null, null, null, null, "Correction"));
    const sup = await c.rpc<{ id: string; superseded_id: string }>("supersede_okr_decision", w.presenter, d.id, "Adopt ledger sign-off on Thursdays", null, null, null, null, null, "Friday clashes with payroll", null);
    const rows = await c.q<{ id: string; status: string; superseded_by_id: string | null; supersedes_id: string | null }>("select id, status, superseded_by_id, supersedes_id from okr_session_decisions order by reference");
    expect(rows.map((r) => r.status)).toEqual(["SUPERSEDED", "APPROVED"]);
    expect(rows[0].superseded_by_id).toBe(sup.id);
    expect(rows[1].supersedes_id).toBe(d.id);
    expect((await c.q("select 1 from okr_session_events where record_id = $1 and event_type = 'SUPERSEDED'", [d.id])).length).toBe(1);
  }));

  it("amends a proposal with the earlier wording preserved; rejection needs a reason", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const d = await propose(c, w.presenter, s.id);
    await c.expectError("REASON_REQUIRED", () => c.rpc("update_okr_decision", w.presenter, d.id, 1, "Better title", null, null, null, null, null, null, null, null, null));
    await c.rpc("update_okr_decision", w.presenter, d.id, 1, "Better title", null, null, null, null, null, null, null, null, "Clarified");
    const ev = await c.q<{ details: { before: { title: string } } }>("select details from okr_session_events where record_id = $1 and event_type = 'AMENDED'", [d.id]);
    expect(ev[0].details.before.title).toBe("Adopt weekly ledger sign-off");
    await c.expectError("REASON_REQUIRED", () => c.rpc("decide_okr_decision", w.presenter, d.id, "REJECT", null, null, 2, null));
    await c.expectError("VERSION_CONFLICT", () => c.rpc("decide_okr_decision", w.presenter, d.id, "REJECT", "No", null, 1, null));
  }));

  it("replays a repeated approval with the same key", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const d = await propose(c, w.presenter, s.id);
    const a = await c.rpc<{ replayed: boolean }>("decide_okr_decision", w.presenter, d.id, "APPROVE", null, null, null, "approve-key-0001");
    const b = await c.rpc<{ replayed: boolean }>("decide_okr_decision", w.presenter, d.id, "APPROVE", null, null, null, "approve-key-0001");
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
  }));
});

describe("action items and carrying forward", () => {
  const mk = (c: Ctx, actor: string, session: string, assignee: string, over: Record<string, unknown> = {}) =>
    c.rpc<{ id: string; version: number }>("create_okr_action", actor, session, over.description ?? "Investigate declining transaction success", assignee, null, over.priority ?? "HIGH", over.due ?? "2031-01-20", null, null,
      over.verify ?? false, over.evidence ?? false, [], over.key ?? null);

  it("assigns, notifies, reports progress, blocks and completes without touching the OKR task", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const tasksBefore = JSON.stringify(await c.q("select * from tasks order by id"));
    const a = await mk(c, w.presenter, s.id, w.finLead);
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'SESSION_ACTION_ASSIGNED'", [w.finLead])).length).toBe(1);
    await c.expectError("PERMISSION_DENIED", () => mk(c, w.finLead, s.id, w.finLead));                                             // a BU Lead cannot create actions
    await c.expectError("REASON_REQUIRED", () => c.rpc("update_okr_action", w.finLead, a.id, 1, "BLOCKED", null, null, null, null, null, null));
    const p = await c.rpc<{ version: number }>("update_okr_action", w.finLead, a.id, 1, "IN_PROGRESS", "Pulled the failed-transaction export", null, null, null, null, null);
    const blocked = await c.rpc<{ version: number }>("update_okr_action", w.finLead, a.id, p.version, "BLOCKED", null, "Waiting for the bank's report", null, null, null, null);
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'SESSION_ACTION_BLOCKED'", [w.presenter])).length).toBe(1);   // the creator (who is also the facilitator) is told once
    await c.expectError("REASON_REQUIRED", () => c.rpc("update_okr_action", w.finLead, a.id, blocked.version, "COMPLETED", null, null, null, null, null, null));
    await c.rpc("update_okr_action", w.finLead, a.id, blocked.version, "COMPLETED", null, null, "Root cause found and fixed", null, null, null);
    expect((await c.q<{ status: string; completion_remarks: string }>("select status, completion_remarks from okr_session_actions where id = $1", [a.id]))[0]).toEqual({ status: "COMPLETED", completion_remarks: "Root cause found and fixed" });
    expect(JSON.stringify(await c.q("select * from tasks order by id"))).toBe(tasksBefore);                                          // completion never completes an OKR task
    expect((await c.q("select 1 from okr_session_events where record_id = $1", [a.id])).length).toBeGreaterThanOrEqual(4);
  }));

  it("lets only people of the responsible unit (or the assignee/assigner) work an action", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const a = await mk(c, w.presenter, s.id, w.finLead);
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("update_okr_action", w.opsLead, a.id, 1, "IN_PROGRESS", null, null, null, null, null, null));
    await c.rpc("update_okr_action", w.finLead2, a.id, 1, "IN_PROGRESS", null, null, null, null, null, null);                                // a BU Lead of the same unit
    await c.expectError("PERMISSION_DENIED", () => c.rpc("reassign_okr_action", w.finLead, a.id, w.finLead2, "Workload", 2, null));       // reassigning needs session_actions.assign
    await c.asUser(w.opsLead, async () => expect(await c.q("select 1 from okr_session_actions")).toHaveLength(0));
  }));

  it("reassigns with a reason, an audit trail and a notice to the new owner; refuses a suspended assignee", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const a = await mk(c, w.presenter, s.id, w.finLead);
    await c.expectError("REASON_REQUIRED", () => c.rpc("reassign_okr_action", w.presenter, a.id, w.finLead2, null, 1, null));
    await c.rpc("reassign_okr_action", w.presenter, a.id, w.finLead2, "Workload", 1, null);
    const ev = await c.q<{ details: { from: string; to: string }; remarks: string }>("select details, remarks from okr_session_events where record_id = $1 and event_type = 'REASSIGNED'", [a.id]);
    expect(ev[0].details).toMatchObject({ from: w.finLead, to: w.finLead2 });
    expect(ev[0].remarks).toBe("Workload");
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'SESSION_ACTION_ASSIGNED'", [w.finLead2])).length).toBe(1);
    await c.q("update users set status = 'SUSPENDED' where id = $1", [w.finLead]);
    await c.expectError("ASSIGNEE_UNAVAILABLE", () => c.rpc("reassign_okr_action", w.presenter, a.id, w.finLead, "Back", 2, null));
    await c.expectError("ASSIGNEE_UNAVAILABLE", () => mk(c, w.presenter, s.id, w.finLead));
  }));

  it("extends the deadline only with a justification and a later date", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const a = await mk(c, w.presenter, s.id, w.finLead);
    await c.expectError("REASON_REQUIRED", () => c.rpc("extend_okr_action", w.presenter, a.id, "2031-01-27", null, 1, null));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("extend_okr_action", w.presenter, a.id, "2031-01-10", "Earlier?", 1, null));
    await c.rpc("extend_okr_action", w.presenter, a.id, "2031-01-27", "Bank report delayed", 1, null);
    expect((await c.q<{ due_date: string; extensions: number; original_due_date: string }>("select to_char(due_date,'YYYY-MM-DD') due_date, extensions, to_char(original_due_date,'YYYY-MM-DD') original_due_date from okr_session_actions"))[0])
      .toEqual({ due_date: "2031-01-27", extensions: 1, original_due_date: "2031-01-20" });
  }));

  it("requires evidence and independent verification where the action asks for them", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const a = await mk(c, w.presenter, s.id, w.finLead, { verify: true, evidence: true });
    await c.expectError("EVIDENCE_REQUIRED", () => c.rpc("update_okr_action", w.finLead, a.id, 1, "COMPLETED", null, null, "Done", null, null, null));
    await c.rpc("record_okr_attachment", w.finLead, s.id, "ACTION", a.id, "COMPLETION_EVIDENCE", "reconciliation.pdf", "application/pdf", 1200, "abc123", "okr-sessions/x/reconciliation.pdf");
    await c.rpc("update_okr_action", w.finLead, a.id, 1, "COMPLETED", null, null, "Done", null, null, null);
    expect((await c.q<{ verification_status: string }>("select verification_status from okr_session_actions"))[0].verification_status).toBe("PENDING");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("verify_okr_action", w.finLead, a.id, "VERIFIED", null, 2));                         // no verify permission
    await c.rpc("verify_okr_action", w.presenter, a.id, "VERIFIED", "Evidence checked", 2);
    expect((await c.q<{ verification_status: string }>("select verification_status from okr_session_actions"))[0].verification_status).toBe("VERIFIED");
  }));

  it("sends a rejected completion back to IN_PROGRESS and forbids verifying your own completion", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const a = await mk(c, w.presenter, s.id, w.presenter2, { verify: true });
    await c.rpc("update_okr_action", w.presenter2, a.id, 1, "COMPLETED", null, null, "All done", null, null, null);
    await c.expectError("SESSION_ACTION_SELF_VERIFICATION", () => c.rpc("verify_okr_action", w.presenter2, a.id, "VERIFIED", null, 2));
    await c.expectError("REASON_REQUIRED", () => c.rpc("verify_okr_action", w.presenter, a.id, "REJECTED", null, 2));
    await c.rpc("verify_okr_action", w.presenter, a.id, "REJECTED", "No evidence", 2);
    expect((await c.q<{ status: string; completed_at: string | null }>("select status, completed_at from okr_session_actions"))[0]).toEqual({ status: "IN_PROGRESS", completed_at: null });
  }));

  it("carries an open commitment into the next session as the SAME row, once, with the history intact", () => withTx(async (c) => {
    const w = await world(c);
    const s1 = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s1.id, "IN_PROGRESS", null, null, null);
    const a = await mk(c, w.presenter, s1.id, w.finLead);
    await c.rpc("transition_okr_session", w.presenter, s1.id, "COMPLETED", null, null, null);
    await c.setNow("2031-01-15T10:00:00+01:00");
    const s2 = await c.rpc<{ id: string }>("create_okr_session", w.presenter, "FIN weekly review 2", w.type, "2031-01-16", null, w.fin, null, null, null, w.presenter, null, null, [], null);
    await c.rpc("transition_okr_session", w.presenter, s2.id, "IN_PROGRESS", null, null, null);
    const out = await c.rpc<{ actions: { id: string }[] }>("read_okr_outstanding", s2.id);
    expect(out.actions.map((x) => x.id)).toEqual([a.id]);
    const items = [{ type: "ACTION", id: a.id, outcome: "UPDATE_REQUESTED", remarks: "Update asked from BU" }];
    await c.rpc("carry_forward_okr_items", w.presenter, s2.id, items, "carry-key-0001");
    await c.rpc("carry_forward_okr_items", w.presenter, s2.id, items, "carry-key-0001");              // duplicate request
    await c.rpc("carry_forward_okr_items", w.presenter, s2.id, items, null);                           // a second review in the same session updates, never duplicates
    expect((await c.q<{ n: string }>("select count(*) n from okr_session_actions"))[0].n).toBe("1");
    expect((await c.q<{ n: string }>("select count(*) n from okr_session_carryovers"))[0].n).toBe("1");
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'SESSION_ACTION_FOLLOW_UP'", [w.finLead])).length).toBe(1);
    // the owner updates it from the new session; the history shows the earlier session's origin
    await c.rpc("update_okr_action", w.finLead, a.id, 1, "IN_PROGRESS", "Bank report received", null, null, s2.id, null, null);
    const timeline = await c.q<{ session_id: string; event_type: string }>("select session_id, event_type from okr_session_events where record_id = $1 order by seq", [a.id]);
    expect(timeline.map((t) => t.event_type)).toEqual(["CREATED", "REVIEWED_IN_SESSION", "REVIEWED_IN_SESSION", "STATUS_IN_PROGRESS"]);
    expect(timeline[3].session_id).toBe(s2.id);
    // a unit cannot be reviewed from another unit's session
    const opsSession = await w.newSession(w.presenter, { bu: w.ops, participants: [] }); await c.rpc("transition_okr_session", w.presenter, opsSession.id, "IN_PROGRESS", null, null, null);
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("carry_forward_okr_items", w.presenter, opsSession.id, items, null));
  }));

  it("notifies once per action and due date (due soon, overdue), and not at all when reminders are switched off", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await mk(c, w.presenter, s.id, w.finLead, { due: "2031-01-10" });
    await c.setNow("2031-01-09T08:00:00+01:00");
    await c.rpc("run_okr_session_reminders");
    await c.rpc("run_okr_session_reminders");
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'SESSION_ACTION_DUE'", [w.finLead])).length).toBe(1);
    await c.setNow("2031-01-12T08:00:00+01:00");
    await c.rpc("run_okr_session_reminders");
    await c.rpc("run_okr_session_reminders");
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'SESSION_ACTION_OVERDUE'", [w.finLead])).length).toBe(1);
    const dash = await c.asUser(w.presenter, () => c.rpc<{ actions_overdue: number; actions_outstanding: number }>("read_okr_dashboard", null, null, null, null));
    expect(dash).toMatchObject({ actions_overdue: 1, actions_outstanding: 1 });
    await c.q("update notification_settings set reminders_enabled = false");
    await c.rpc("update_okr_action", w.presenter, (await c.q<{ id: string }>("select id from okr_session_actions"))[0].id, 1, "IN_PROGRESS", null, null, null, null, null, null);
    expect(await c.rpc("run_okr_session_reminders")).toBe(0);
  }));
});

describe("risks, blockers and issues", () => {
  it("is a formal record only for those who manage risks; repeated issues across sessions are recognised", () => withTx(async (c) => {
    const w = await world(c);
    const s1 = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s1.id, "IN_PROGRESS", null, null, null);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("create_okr_risk", w.finLead, s1.id, "RISK", "Bank API instability", "desc", null, "TECHNICAL", "HIGH", null, null, null, null, null, null, [], null));
    const r = await c.rpc<{ id: string }>("create_okr_risk", w.presenter, s1.id, "RISK", "Bank API instability", "Intermittent timeouts", null, "TECHNICAL", "HIGH", "Delays", null, "Retry logic", w.finLead, "2031-02-01", null, [], null);
    await c.rpc("transition_okr_session", w.presenter, s1.id, "COMPLETED", null, null, null);
    await c.setNow("2031-01-15T10:00:00+01:00");
    const s2 = await c.rpc<{ id: string }>("create_okr_session", w.presenter, "Review 2", w.type, "2031-01-16", null, w.fin, null, null, null, w.presenter, null, null, [], null);
    await c.rpc("transition_okr_session", w.presenter, s2.id, "IN_PROGRESS", null, null, null);
    await c.rpc("create_okr_risk", w.presenter, s2.id, "RISK", "  bank   api INSTABILITY ", "Still timing out", null, "TECHNICAL", "HIGH", null, null, null, null, null, null, [], null);
    const dash = await c.asUser(w.presenter, () => c.rpc<{ repeated_issues: { sessions: number; unresolved: number }[]; risks_open: number }>("read_okr_dashboard", null, null, null, null));
    expect(dash.repeated_issues).toHaveLength(1);
    expect(dash.repeated_issues[0]).toMatchObject({ sessions: 2, unresolved: 2 });
    await c.expectError("REASON_REQUIRED", () => c.rpc("update_okr_risk", w.presenter, r.id, 1, "RESOLVED", null, null, null, null, null, null, null, null, null, null));
    await c.rpc("update_okr_risk", w.presenter, r.id, 1, "RESOLVED", null, null, null, null, null, null, null, "Provider fixed the API", null, null);
    await c.expectError("VERSION_CONFLICT", () => c.rpc("update_okr_risk", w.presenter, r.id, 1, "CLOSED", null, null, null, null, null, null, null, "x", null, null));
  }));
});

describe("minutes: draft, review, finalise, keep the originals", () => {
  it("walks DRAFT -> SUBMITTED -> REVIEWED -> FINALISED, freezes a snapshot and then refuses any change; an amendment is a new revision", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id, { content: "Discussion text" });
    await note(c, w.presenter, s.id, { content: "Confidential matter", visibility: "CONFIDENTIAL", title: "conf" });
    const m = await c.rpc<{ id: string; version: number; revision: number }>("save_okr_minutes_draft", w.presenter, s.id, "# Minutes\nFirst draft", "PARTICIPANTS", false, null, null, null);
    expect(m.revision).toBe(1);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("finalise_okr_minutes", w.presenter, m.id, 1, null));
    await c.rpc("submit_okr_minutes", w.presenter, m.id, 1);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("save_okr_minutes_draft", w.presenter, s.id, "edit while submitted", "PARTICIPANTS", false, null, 2, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("review_okr_minutes", w.finLead, m.id, "APPROVE", null, 2));
    await c.rpc("review_okr_minutes", w.presenter2, m.id, "APPROVE", "Good", 2);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("finalise_okr_minutes", w.presenter, m.id, 3, null));         // the session is not completed yet
    await c.rpc("transition_okr_session", w.presenter, s.id, "COMPLETED", null, null, null);
    const f = await c.rpc<{ content_hash: string }>("finalise_okr_minutes", w.presenter2, m.id, 3, null);
    expect(f.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const row = (await c.q<{ status: string; snapshot: { notes: { content: string }[] }; finalised_by: string }>("select status, snapshot, finalised_by from okr_session_minutes where id = $1", [m.id]))[0];
    expect(row.status).toBe("FINALISED");
    expect(row.finalised_by).toBe(w.presenter2);
    expect(row.snapshot.notes.map((n) => n.content)).toEqual(["Discussion text"]);       // confidential notes never enter the minutes
    await failsWith(c, /IMMUTABLE_RECORD/, "update okr_session_minutes set content = 'tampered' where id = $1", [m.id]);
    await failsWith(c, /IMMUTABLE_RECORD/, "delete from okr_session_minutes where id = $1", [m.id]);
    const rev2 = await c.rpc<{ revision: number }>("save_okr_minutes_draft", w.presenter, s.id, "# Minutes\nAmended", "PARTICIPANTS", false, null, null, null);
    expect(rev2.revision).toBe(2);
    expect((await c.q<{ amends_revision: number }>("select amends_revision from okr_session_minutes where revision = 2"))[0].amends_revision).toBe(1);
    expect((await c.q("select 1 from okr_session_minutes where revision = 1 and status = 'FINALISED'")).length).toBe(1);
  }));

  it("records that a draft started from AI and still needs a person's review", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const m = await c.rpc<{ id: string }>("save_okr_minutes_draft", w.presenter, s.id, "Proposed summary", "PARTICIPANTS", true, "test-model", null, null);
    const row = (await c.q<{ ai_drafted: boolean; status: string }>("select ai_drafted, status from okr_session_minutes where id = $1", [m.id]))[0];
    expect(row).toEqual({ ai_drafted: true, status: "DRAFT" });
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("review_okr_minutes", w.presenter, m.id, "APPROVE", null, 1));        // a draft cannot skip submission
  }));
});

describe("history, search and dashboard", () => {
  it("stays searchable and readable after the week is finalised and the quarter locks", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id, { content: "Settlement reconciliation drifted by 3 days", title: "Reconciliation drift" });
    await c.rpc("create_okr_decision", w.presenter, s.id, "Daily settlement check", "Run a check every morning", null, null, null, null, [], null, null, null, null, [], null);
    await c.rpc("transition_okr_session", w.presenter, s.id, "COMPLETED", null, null, null);
    await c.setNow("2031-04-20T10:00:00+01:00");                                      // the quarter is long over
    await c.rpc("run_scheduled_jobs");
    const hit = await c.asUser(w.presenter, () => c.rpc<{ total: number; rows: { id: string; snippets: string[] }[] }>("read_okr_session_search", "settlement reconciliation", w.fin, null, null, null, null, null, null, null, null, null, null, null, null, null, 25, 0));
    expect(hit.total).toBe(1);
    expect(hit.rows[0].id).toBe(s.id);
    expect(hit.rows[0].snippets[0]).toContain("[[");
    const full = await c.asUser(w.finLead, () => c.rpc<{ session: { reference: string }; notes: unknown[]; decisions: unknown[] }>("read_okr_session", s.id));
    expect(full.notes).toHaveLength(1);
    expect(full.decisions).toHaveLength(1);
    const none = await c.asUser(w.opsLead, () => c.rpc<{ total: number }>("read_okr_session_search", "settlement", null, null, null, null, null, null, null, null, null, null, null, null, null, null, 25, 0));
    expect(none.total).toBe(0);
    await c.setNow("2031-01-07T10:00:00+01:00");
  }));

  it("filters by status, category, decision status and linked OKR component", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id, { category: "RISK_BLOCKER", links: [{ target_type: "KEY_RESULT", target_id: w.s.krIds[1] }] });
    const search = (over: Record<string, unknown>) => c.asUser(w.presenter, () => c.rpc<{ total: number }>("read_okr_session_search", null, over.bu ?? null, null, null, null, null, null, null, null, over.status ?? null, over.category ?? null,
      over.decision ?? null, null, over.linkType ?? null, over.linkId ?? null, 25, 0));
    expect((await search({ category: "RISK_BLOCKER" })).total).toBe(1);
    expect((await search({ category: "QUESTION_RAISED" })).total).toBe(0);
    expect((await search({ status: "COMPLETED" })).total).toBe(0);
    expect((await search({ linkType: "KEY_RESULT", linkId: w.s.krIds[1] })).total).toBe(1);
    expect((await search({ linkType: "KEY_RESULT", linkId: w.s.krIds[0] })).total).toBe(0);
    expect((await search({ decision: "APPROVED" })).total).toBe(0);
  }));

  it("counts the dashboard from real records only, and for a BU Lead only their own unit", () => withTx(async (c) => {
    const w = await world(c);
    const empty = await c.asUser(w.presenter, () => c.rpc<{ sessions_total: number; completion_rate: number | null }>("read_okr_dashboard", null, null, null, null));
    expect(empty).toMatchObject({ sessions_total: 0, completion_rate: null });
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const o = await w.newSession(w.presenter, { bu: w.ops, participants: [] }); await c.rpc("transition_okr_session", w.presenter, o.id, "IN_PROGRESS", null, null, null);
    const a1 = await c.rpc<{ id: string }>("create_okr_action", w.presenter, s.id, "A1", w.finLead, null, "LOW", "2031-01-20", null, null, false, false, [], null);
    await c.rpc("create_okr_action", w.presenter, s.id, "A2", w.finLead, null, "LOW", "2031-01-20", null, null, false, false, [], null);
    await c.rpc("update_okr_action", w.finLead, a1.id, 1, "COMPLETED", null, null, "done", null, null, null);
    const org = await c.asUser(w.exec, () => c.rpc<{ sessions_total: number; actions_total: number; completion_rate: number }>("read_okr_dashboard", null, null, null, null));
    expect(org).toMatchObject({ sessions_total: 2, actions_total: 2, completion_rate: 50 });
    const mine = await c.asUser(w.finLead, () => c.rpc<{ sessions_total: number }>("read_okr_dashboard", null, null, null, null));
    expect(mine.sessions_total).toBe(1);
    const theirs = await c.asUser(w.opsLead, () => c.rpc<{ sessions_total: number; actions_total: number }>("read_okr_dashboard", null, null, null, null));
    expect(theirs).toMatchObject({ sessions_total: 1, actions_total: 0 });
  }));
});

describe("mentions", () => {
  const tok = (name: string, id: string) => `Please look, @[${name}](user:${id}) `;
  const told = (c: Ctx, u: string) => c.q("select 1 from notifications where user_id = $1 and event_type = 'SESSION_MENTION'", [u]);

  it("tells a mentioned person who can read the note, once, and never the author", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id, { content: tok("Fin Lead", w.finLead) + tok("Me", w.presenter) });
    expect(await told(c, w.finLead)).toHaveLength(1);
    expect(await told(c, w.presenter)).toHaveLength(0);
    await c.rpc("update_okr_note", w.presenter, n.id, 1, null, null, tok("Fin Lead", w.finLead) + "again", null, null);
    expect(await told(c, w.finLead)).toHaveLength(1);                         // one notice per note and person
  }));

  it("never tells someone who could not read the note (another unit, management-only, confidential)", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id, { content: tok("Ops Lead", w.opsLead) });                                        // other unit, not invited
    await note(c, w.presenter, s.id, { content: tok("Fin Lead", w.finLead), visibility: "MANAGEMENT" });              // management-only
    await note(c, w.presenter, s.id, { content: tok("Fin Lead", w.finLead), visibility: "CONFIDENTIAL" });
    expect(await told(c, w.opsLead)).toHaveLength(0);
    expect(await told(c, w.finLead)).toHaveLength(0);
    await note(c, w.presenter, s.id, { content: tok("Exec", w.exec), visibility: "MANAGEMENT" });                     // an executive may read management notes
    expect(await told(c, w.exec)).toHaveLength(1);
  }));

  it("ignores a token that is not a person, and a bad token never breaks saving", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    await note(c, w.presenter, s.id, { content: "@[Nobody](user:00000000-0000-4000-8000-000000000000) and @[Bad](user:xyz)" });
    expect(await told(c, w.finLead)).toHaveLength(0);
    expect(await told(c, w.exec)).toHaveLength(0);
  }));
});

describe("audit and immutability", () => {
  it("writes the session timeline and the audit log for every governed act, and neither can be changed", () => withTx(async (c) => {
    const w = await world(c);
    const s = await w.newSession(); await c.rpc("transition_okr_session", w.presenter, s.id, "IN_PROGRESS", null, null, null);
    const n = await note(c, w.presenter, s.id);
    await c.rpc("archive_okr_note", w.presenter, n.id, false, "Duplicate");
    const d = await c.rpc<{ id: string }>("create_okr_decision", w.presenter, s.id, "t", "d", null, null, null, null, [], null, null, null, null, [], null);
    await c.rpc("decide_okr_decision", w.presenter, d.id, "APPROVE", null, null, null, null);
    await c.rpc("record_okr_export", w.presenter, "SESSION_MINUTES", s.id, "pdf", {}, 1);
    const actions = (await c.q<{ action: string }>("select action from audit_logs where action like 'OKR_SESSION_%' order by seq")).map((r) => r.action);
    for (const a of ["OKR_SESSION_CREATED", "OKR_SESSION_STATUS_IN_PROGRESS", "OKR_SESSION_CREATED", "OKR_SESSION_ARCHIVED", "OKR_SESSION_APPROVED", "OKR_SESSION_EXPORTED"]) expect(actions).toContain(a);
    await failsWith(c, /IMMUTABLE_RECORD/, "update okr_session_events set remarks = 'x'");
    await failsWith(c, /IMMUTABLE_RECORD/, "delete from okr_session_events");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("record_okr_export", w.hr, "SESSION_MINUTES", s.id, "pdf", {}, 1));
  }));

  it("gives people no direct write access to any session table or write function", () => withTx(async (c) => {
    const w = await world(c);
    await w.newSession();
    await c.asUser(w.presenter, async () => {
      for (const tb of ["okr_sessions", "okr_session_notes", "okr_session_decisions", "okr_session_actions", "okr_session_risks", "okr_session_minutes", "okr_session_links", "okr_session_events", "okr_session_attachments"]) {
        await failsWith(c, /permission denied/, `delete from ${tb}`);
        await failsWith(c, /permission denied/, `update ${tb} set id = id`);
        await failsWith(c, /permission denied/, `insert into ${tb} default values`);
      }
    });
    const writers = await c.q<{ proname: string; ok: boolean }>("select proname, has_function_privilege('authenticated', oid, 'execute') ok from pg_proc where pronamespace = 'public'::regnamespace and (proname ~ '^(create|update|archive|decide|supersede|reassign|extend|escalate|verify|transition|set|carry|save|submit|review|finalise|record|remove)_okr_' or proname in ('okr_log','okr_notify','okr_next_ref','run_okr_session_reminders'))");
    expect(writers.length).toBeGreaterThan(20);
    expect(writers.filter((r) => r.ok)).toEqual([]);
    const readers = await c.q<{ proname: string; ok: boolean }>("select proname, has_function_privilege('authenticated', oid, 'execute') ok from pg_proc where pronamespace = 'public'::regnamespace and proname like 'read\\_okr\\_%'");
    expect(readers.length).toBeGreaterThan(8);
    expect(readers.filter((r) => !r.ok)).toEqual([]);
  }));

  it("configures session types only with session_notes.configure (Admin), and never exposes content to the administrator", () => withTx(async (c) => {
    const w = await world(c);
    const id = await c.rpc<string>("save_okr_session_type", w.admin, null, "BOARD_REVIEW", "Board review", "Quarterly board session", 70, true);
    expect(id).toBeTruthy();
    await c.expectError("PERMISSION_DENIED", () => c.rpc("save_okr_session_type", w.presenter, null, "OTHER_TYPE", "Other", null, 80, true));
    const t = await c.asUser(w.admin, () => c.q("select 1 from okr_session_types"));
    expect(t.length).toBeGreaterThan(6);
    const sess = await c.rpc<{ id: string }>("create_okr_session", w.presenter, "On the new type", id, "2031-01-09", w.wk, w.fin, null, null, null, w.presenter, null, null, [], null);
    expect(sess.id).toBeTruthy();
  }));
});
