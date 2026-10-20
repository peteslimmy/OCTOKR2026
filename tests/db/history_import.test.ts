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
  it("only the Super Admin tier holds history.import, and no other role can be given it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("history_create_batch", w.admin, "a.xlsx", sha(), 1));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("history_create_batch", w.hr, "a.xlsx", sha(), 1));
      const holders = await c.q<{ code: string }>("select r.code from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id where p.code = 'history.import'");
      expect(holders.map((h) => h.code)).toEqual(["SUPER_ADMIN"]);
      const reserved = await c.q<{ code: string }>("select code from permissions where reserved order by code");
      expect(reserved.map((r) => r.code)).toContain("history.import");
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
