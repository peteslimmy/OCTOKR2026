import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

let seq = 0;
const sha = () => createHash("sha256").update(`strat-${Date.now()}-${++seq}`).digest("hex");
type R = { row_no: number; year: number; quarter: number; objective: string; kr_no: number; kr_title: string; sub_no: number; sub_title: string };
function sheet(year: number, quarter: number, krs = 3): R[] {
  const out: R[] = []; let n = 2;
  for (let k = 1; k <= krs; k++) for (let s = 1; s <= 2; s++) out.push({ row_no: n++, year, quarter, objective: `Objective ${year}Q${quarter}`, kr_no: k, kr_title: `KR title ${k}`, sub_no: s, sub_title: `Sub ${k}.${s}` });
  return out;
}
async function world(c: Ctx) {
  const bu = await c.bu("ST");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const admin = await c.user(["ADMIN"], bu, "admin");
  await c.setNow("2026-10-16T09:00:00+01:00");
  return { sa, admin };
}
const issues = (c: Ctx, rows: R[]) => c.rpc<{ row: number; message: string }[]>("strategy_import_issues", JSON.stringify(rows));
const commit = (c: Ctx, actor: string, rows: R[], confirm = "IMPORT STRATEGY", s = sha()) => c.rpc<{ objectives: number; key_results: number; sub_key_results: number; quarters: { status: string }[]; already_imported?: boolean }>("strategy_import_commit", actor, JSON.stringify(rows), "s.xlsx", s, confirm);

describe("strategy import (ADR-079)", () => {
  it("only the Super Admin tier can import", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => commit(c, w.admin, sheet(2024, 1)));
      expect((await c.q("select r.code from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id where p.code = 'strategy.import'")).map((x) => x.code)).toEqual(["SUPER_ADMIN"]);
    });
  });

  it("stores ended quarters LOCKED and later quarters PLANNED, with the full strategy, and records and audits it once", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = [...sheet(2024, 1), ...sheet(2027, 2, 4)];
      expect(await issues(c, rows)).toEqual([]);
      const s = sha();
      const out = await commit(c, w.sa, rows, "IMPORT STRATEGY", s);
      expect([out.objectives, out.key_results, out.sub_key_results]).toEqual([2, 7, 14]);
      expect((await c.q("select year, quarter_number, status from quarters where year in (2024, 2027) order by year")).map((q) => `${q.year}${q.quarter_number}${q.status}`)).toEqual(["20241LOCKED", "20272PLANNED"]);
      expect((await c.q("select 1 from sub_key_results s join key_results k on k.id = s.key_result_id join quarterly_objectives o on o.id = k.objective_id where o.title = 'Objective 2024Q1'")).length).toBe(6);
      expect((await commit(c, w.sa, rows, "IMPORT STRATEGY", s)).already_imported).toBe(true);        // the same file again changes nothing
      expect((await c.q("select 1 from audit_logs where action = 'STRATEGY_IMPORTED'")).length).toBe(1);
      expect((await c.q("select 1 from quarterly_objectives o join quarters q on q.id = o.quarter_id where q.year = 2024")).length).toBe(1);
    });
  });

  it("refuses everything that would break the strategy rules, with the row, and writes nothing", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await commit(c, w.sa, sheet(2024, 2));
      const again = await issues(c, sheet(2024, 2));
      expect(again.some((i) => /already has an objective/.test(i.message))).toBe(true);
      expect((await issues(c, sheet(2025, 1, 2))).some((i) => /2 key results/.test(i.message))).toBe(true);
      const gap = sheet(2025, 1).filter((r) => !(r.kr_no === 2 && r.sub_no === 1)).map((r) => (r.kr_no === 2 ? { ...r, sub_no: 2 } : r));
      expect((await issues(c, gap)).some((i) => /Sub-KR numbers must run/.test(i.message))).toBe(true);
      const mixed = sheet(2025, 1).map((r, i) => (i === 0 ? { ...r, objective: "Other" } : r));
      expect((await issues(c, mixed)).some((i) => /exactly one objective/.test(i.message))).toBe(true);
      await c.expectError("IMPORT_INVALID", () => commit(c, w.sa, sheet(2025, 1, 2)));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.sa, sheet(2025, 1), "yes"));
      expect((await c.q("select 1 from quarters where year = 2025")).length).toBe(0);
    });
  });

  it("refuses an active quarter: its strategy changes only by approved request", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on, status) values ($1, 2026, 4, '2026-10-01', '2026-12-31', 'ACTIVE')", [c.org]);
      expect((await issues(c, sheet(2026, 4))).some((i) => /is active/.test(i.message))).toBe(true);
      await c.expectError("IMPORT_INVALID", () => commit(c, w.sa, sheet(2026, 4)));
    });
  });
});
