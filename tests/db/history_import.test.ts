import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("HI");
  const bu2 = await c.bu("HJ");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const hr = await c.user(["HR"], bu, "hr");
  await c.setNow("2026-06-01T09:00:00+01:00");
  return { bu, bu2, sa, admin, hr };
}
let seq = 0;
const sha = () => createHash("sha256").update(`hist-${Date.now()}-${++seq}`).digest("hex");
type Row = { row_no: number; year: number; week: number; bu_id: string; sub_kr: string | null; goal: string; tasks: { d: string; s: "DONE" | "NOT_DONE" }[] };
const rows = (bu: string): Row[] => [
  { row_no: 2, year: 2025, week: 3, bu_id: bu, sub_kr: "1.1", goal: "Launch pilot", tasks: [{ d: "Brief", s: "DONE" }, { d: "Build", s: "DONE" }, { d: "Ship", s: "NOT_DONE" }] },
  { row_no: 3, year: 2025, week: 3, bu_id: bu, sub_kr: null, goal: "Stretch idea", tasks: [{ d: "Try", s: "DONE" }] },
  { row_no: 4, year: 2025, week: 4, bu_id: bu, sub_kr: "2.3", goal: "Close deals", tasks: [{ d: "Call", s: "DONE" }] },
];
async function stage(c: Ctx, actor: string, data: Row[]) {
  const b = await c.rpc<{ batch_id: string }>("history_create_batch", actor, "sample.xlsx", sha(), data.length);
  await c.rpc("history_stage_rows", actor, b.batch_id, JSON.stringify(data));
  const f = await c.rpc<{ count: number; issues: { row: number; message: string }[] }>("history_finish_staging", actor, b.batch_id);
  return { id: b.batch_id, f };
}

describe("historical import (ADR-077)", () => {
  it("Super Admin and Admin hold history.import (ADR-122); no other role does, and it stays a protected permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("history_create_batch", w.hr, "a.xlsx", sha(), 1));
      await c.rpc("history_create_batch", w.admin, "a.xlsx", sha(), 1);
      const holders = await c.q<{ code: string }>("select r.code from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id where p.code = 'history.import' order by 1");
      expect(holders.map((h) => h.code)).toEqual(["ADMIN", "SUPER_ADMIN"]);
      const [flags] = await c.q<{ protected: boolean; reserved: boolean }>("select protected, reserved from permissions where code = 'history.import'");
      expect(flags).toEqual({ protected: true, reserved: false });
    });
  });

  it("stages, reports every problem with its row, and refuses to commit a file with problems", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const bad = rows(w.bu);
      bad.push({ row_no: 5, year: 2026, week: 30, bu_id: w.bu, sub_kr: "1.1", goal: "Future", tasks: [{ d: "x", s: "DONE" }] });        // not closed yet
      bad.push({ row_no: 6, year: 2025, week: 5, bu_id: w.bu, sub_kr: "9", goal: "Bad key", tasks: [{ d: "x", s: "DONE" }] });
      const { id, f } = await stage(c, w.sa, bad);
      expect(f.count).toBe(2);
      expect(f.issues.map((i) => i.row).sort()).toEqual([5, 6]);
      await c.expectError("HISTORY_HAS_ISSUES", () => c.rpc("history_commit", w.sa, id, false, "IMPORT HISTORY"));
      expect((await c.q("select 1 from weekly_reports")).length).toBe(0);
    });
  });

  it("rehearsal shows the recomputed result and changes nothing; commit writes it, scored by the ordinary engine", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { id, f } = await stage(c, w.sa, rows(w.bu));
      const sameFile = await c.q<{ file_sha256: string }>("select file_sha256 from historical_import_batches where id = $1", [id]);
      expect(f.count).toBe(0);
      const rh = await c.rpc<{ reports: number; goals: number; tasks: number; tasks_done: number; quarters_created: number; rehearsal: boolean }>("history_rehearse", w.sa, id, false);
      expect(rh).toMatchObject({ rehearsal: true, reports: 2, goals: 3, tasks: 5, tasks_done: 4, quarters_created: 1 });
      expect((await c.q("select 1 from weekly_reports")).length).toBe(0);
      expect((await c.q("select 1 from quarters where year = 2025")).length).toBe(0);

      await c.expectError("VALIDATION_ERROR", () => c.rpc("history_commit", w.sa, id, false, "yes"));
      const done = await c.rpc<{ reports: number; quarterly_scores: { unit: string; score: number }[] }>("history_commit", w.sa, id, false, "IMPORT HISTORY");
      expect(done.reports).toBe(2);
      expect((await c.q("select 1 from weekly_reports")).length).toBe(2);
      const weeks = await c.q<{ status: string }>("select status from reporting_weeks where week_year = 2025 and week_number in (3,4)");
      expect(weeks.map((x) => x.status)).toEqual(["FINAL_LOCKED", "FINAL_LOCKED"]);
      const snaps = await c.q<{ base_score: string }>("select base_score from weekly_score_snapshots");
      expect(snaps.length).toBe(2);
      expect(Number(snaps[0].base_score) + Number(snaps[1].base_score)).toBeGreaterThan(0);
      // nothing was sent to anybody
      expect((await c.q("select 1 from notifications where event_type = 'FINAL_LOCKED'")).length).toBe(0);
      expect((await c.q("select 1 from task_status_history where change_source = 'HISTORICAL_IMPORT'")).length).toBe(5);
      // committing again returns the same result, and the same file cannot be imported twice
      expect(await c.rpc("history_commit", w.sa, id, false, "IMPORT HISTORY")).toMatchObject({ already_committed: true });
      await c.expectError("HISTORY_ALREADY_IMPORTED", () => c.rpc("history_create_batch", w.sa, "again.xlsx", sameFile[0].file_sha256, 3));
      expect((await c.q("select 1 from audit_logs where action = 'HISTORICAL_IMPORT_COMMITTED'")).length).toBe(1);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update historical_import_rows set goal = 'x'"));
    });
  });

  it("a week the application already closed, or a unit that already has a report, is refused", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const first = await stage(c, w.sa, rows(w.bu));
      await c.rpc("history_commit", w.sa, first.id, false, "IMPORT HISTORY");
      const second = await stage(c, w.sa, [{ row_no: 2, year: 2025, week: 3, bu_id: w.bu, sub_kr: "1.1", goal: "Again", tasks: [{ d: "x", s: "DONE" }] }]);
      expect(second.f.count).toBe(1);
      expect(second.f.issues[0].message).toMatch(/already/);
    });
  });

  it("a half-year for several units loads in one go, scores every unit for both quarters, and finishes in reasonable time", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const units = [w.bu, w.bu2, await c.bu("HK"), await c.bu("HL")];
      const data: Row[] = [];
      let n = 2;
      for (let week = 2; week <= 27; week++) for (const [i, bu] of units.entries()) for (let g = 0; g < 3; g++) {
        data.push({ row_no: n++, year: 2025, week, bu_id: bu, sub_kr: g === 2 ? null : `${g + 1}.1`, goal: `Goal ${week}-${i}-${g}`, tasks: [{ d: "a", s: "DONE" }, { d: "b", s: (week + i + g) % 3 === 0 ? "NOT_DONE" : "DONE" }] });
      }
      const { id, f } = await stage(c, w.sa, data);
      expect(f.count).toBe(0);
      const t0 = Date.now();
      const out = await c.rpc<{ reports: number; quarters_created: number; quarterly_scores: { score: number | null; status: string }[] }>("history_commit", w.sa, id, true, "IMPORT HISTORY");
      const secs = (Date.now() - t0) / 1000;
      expect(out.reports).toBe(26 * 4);
      expect(out.quarters_created).toBe(2);
      expect(out.quarterly_scores.length).toBe(8);                                               // 4 units x 2 quarters
      expect(out.quarterly_scores.every((s) => s.score !== null)).toBe(true);
      expect(secs).toBeLessThan(60);
    });
  });
});

describe("historical import by an Admin (ADR-122)", () => {
  it("an Admin stages, rehearses and commits like a Super Admin, and the Super Admins are told", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { id, f } = await stage(c, w.admin, rows(w.bu));
      expect(f.count).toBe(0);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("history_commit", w.admin, id, false, "yes"));         // the typed confirmation still applies
      const done = await c.rpc<{ reports: number }>("history_commit", w.admin, id, false, "IMPORT HISTORY");
      expect(done.reports).toBe(2);
      const told = await c.q<{ user_id: string; title: string; message: string }>("select user_id, title, message from notifications where event_type = 'HISTORY_IMPORT_COMMITTED'");
      expect(told.map((t) => t.user_id)).toContain(w.sa);
      expect(told.map((t) => t.user_id)).not.toContain(w.admin);
      expect(told[0].message).toContain("sample.xlsx");
      expect((await c.q("select 1 from audit_logs where action = 'HISTORICAL_IMPORT_COMMITTED' and actor_user_id = $1", [w.admin])).length).toBe(1);
    });
  });

  it("a Super Admin's own commit does not notify the Super Admins", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { id } = await stage(c, w.sa, rows(w.bu));
      await c.rpc("history_commit", w.sa, id, false, "IMPORT HISTORY");
      expect((await c.q("select 1 from notifications where event_type = 'HISTORY_IMPORT_COMMITTED'")).length).toBe(0);
    });
  });

  it("an Admin may undo only a batch they loaded; a Super Admin may undo any", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const other = await c.user(["ADMIN"], w.bu, "admin2");
      const { id } = await stage(c, w.admin, rows(w.bu));
      await c.rpc("history_commit", w.admin, id, false, "IMPORT HISTORY");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("history_void", other, id, "loaded by somebody else", "VOID IMPORT"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("history_void", w.hr, id, "not an importer at all", "VOID IMPORT"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("history_void", w.admin, id, "I loaded this by mistake", "yes"));
      await c.rpc("history_void", w.admin, id, "I loaded this by mistake", "VOID IMPORT");
      expect((await c.q("select 1 from weekly_reports")).length).toBe(0);
      expect((await c.q<{ status: string }>("select status from historical_import_batches where id = $1", [id]))[0].status).toBe("VOIDED");
    });
  });

  it("a Super Admin can undo an Admin's batch", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { id } = await stage(c, w.admin, rows(w.bu));
      await c.rpc("history_commit", w.admin, id, false, "IMPORT HISTORY");
      await c.rpc("history_void", w.sa, id, "undoing the Admin's import", "VOID IMPORT");
      expect((await c.q<{ status: string }>("select status from historical_import_batches where id = $1", [id]))[0].status).toBe("VOIDED");
    });
  });
});

describe("historical import into the running quarter (ADR-122)", () => {
  const running = async (c: Ctx, w: { sa: string }) => {                                       // Q2 2026 is running (now = 2026-06-01) with a real strategy
    const [q] = await c.q<{ id: string }>("insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on, status, activated_at) values ($1, 2026, 2, '2026-04-01', '2026-06-30', 'ACTIVE', '2026-04-01') returning id", [c.org]);
    const [o] = await c.q<{ id: string }>("insert into quarterly_objectives (quarter_id, title, created_by) values ($1, 'Real objective', $2) returning id", [q.id, w.sa]);
    const [k] = await c.q<{ id: string }>("insert into key_results (objective_id, sequence, code, title) values ($1, 1, 'KR1', 'Real KR') returning id", [o.id]);
    await c.q("insert into sub_key_results (key_result_id, sequence, code, title) values ($1, 1, 'KR1.1', 'Real sub') returning id", [k.id]);
    return q.id;
  };
  const wk = (bu: string, week: number, sub: string | null, row_no = 2): Row => ({ row_no, year: 2026, week, bu_id: bu, sub_kr: sub, goal: `Goal ${week}`, tasks: [{ d: "Task", s: "DONE" }] });

  it("loads a closed week of the active quarter, leaves the quarter active and its strategy untouched", async () => {
    await withTx(async (c) => {
      const w = await world(c); const qid = await running(c, w);
      const { id, f } = await stage(c, w.admin, [wk(w.bu, 18, "1.1")]);
      expect(f.count).toBe(0);
      const out = await c.rpc<{ reports: number; quarters_created: number }>("history_commit", w.admin, id, true, "IMPORT HISTORY");   // fill gaps requested: ignored for a running quarter
      expect(out.reports).toBe(1);
      expect(out.quarters_created).toBe(0);
      expect((await c.q<{ status: string }>("select status from quarters where id = $1", [qid]))[0].status).toBe("ACTIVE");
      expect((await c.q("select 1 from key_results where title like '%historical%'")).length).toBe(0);
      expect((await c.q("select 1 from reporting_weeks where quarter_id = $1 and status = 'FINAL_LOCKED' and week_start_at > '2026-05-04'", [qid])).length).toBe(0);
    });
  });

  it("still refuses a week that has not closed, a Sub-KR the running quarter does not have, and a quarter that is not active", async () => {
    await withTx(async (c) => {
      const w = await world(c); await running(c, w);
      const { f } = await stage(c, w.sa, [wk(w.bu, 23, "1.1", 2), wk(w.bu, 18, "3.4", 3), wk(w.bu, 40, "1.1", 4)]);
      const by = Object.fromEntries(f.issues.map((i) => [i.row, i.message]));
      expect(by[2]).toMatch(/not closed yet/);
      expect(by[3]).toMatch(/not in the strategy of the active quarter/);
      expect(by[4]).toMatch(/not ended/);
    });
  });
});
