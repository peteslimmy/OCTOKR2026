import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

// Rolling back strategy, sign-in and historical imports (ADR-088). Nothing is lost; refusals name their reasons.
let seq = 0;
const sha = () => createHash("sha256").update(`void-more-${Date.now()}-${++seq}`).digest("hex");
const REASON = "Uploaded the wrong sheet by mistake";

async function world(c: Ctx) {
  const bu = await c.bu("VM"); const bu2 = await c.bu("VN");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa"); const admin = await c.user(["ADMIN"], bu, "admin");
  await c.setNow("2026-06-01T09:00:00+01:00");
  return { bu, bu2, sa, admin };
}
const count = async (c: Ctx, table: string, where = "true") => (await c.q<{ n: number }>(`select count(*)::int n from ${table} where ${where}`))[0].n;

// ---------------------------------------------------------------- strategy
type SR = { row_no: number; year: number; quarter: number; objective: string; kr_no: number; kr_title: string; sub_no: number; sub_title: string };
function sheet(year: number, quarter: number): SR[] {
  const out: SR[] = []; let n = 2;
  for (let k = 1; k <= 3; k++) for (let s = 1; s <= 2; s++) out.push({ row_no: n++, year, quarter, objective: `Objective ${year}Q${quarter}`, kr_no: k, kr_title: `KR ${k}`, sub_no: s, sub_title: `Sub ${k}.${s}` });
  return out;
}
const importStrategy = async (c: Ctx, actor: string, rows: SR[], s = sha()) => {
  await c.rpc("strategy_import_commit", actor, JSON.stringify(rows), "strategy.xlsx", s, "IMPORT STRATEGY");
  return (await c.q<{ id: string }>("select id from strategy_import_batches where file_sha256 = $1", [s]))[0].id;
};
const voidStrategy = (c: Ctx, actor: string, batch: string, confirm = "VOID IMPORT") =>
  c.rpc<{ quarters_removed: number; quarters_restored_to_planned: number; replayed: boolean }>("strategy_void", actor, batch, REASON, confirm);

describe("rolling back a strategy import", () => {
  it("archives and removes the strategy and the quarters it created, records and audits it, and lets the quarters be imported again", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const batch = await importStrategy(c, w.sa, [...sheet(2024, 1), ...sheet(2027, 2)]);
      expect(await count(c, "quarters", "year in (2024, 2027)")).toBe(2);
      const out = await voidStrategy(c, w.sa, batch);
      expect(out.quarters_removed).toBe(2);
      expect(await count(c, "quarters", "year in (2024, 2027)")).toBe(0);
      expect(await count(c, "quarterly_objectives", "title in ('Objective 2024Q1', 'Objective 2027Q2')")).toBe(0);
      expect(await count(c, "strategy_import_archive", `batch_id = '${batch}'`)).toBe(2 * (1 + 1 + 3 + 6));                // per quarter: quarter, objective, 3 key results, 6 Sub-KRs
      expect(await count(c, "import_rollbacks", `kind = 'STRATEGY' and batch_id = '${batch}'`)).toBe(1);
      expect(await count(c, "audit_logs", "action = 'STRATEGY_IMPORT_VOIDED'")).toBe(1);
      expect((await voidStrategy(c, w.sa, batch)).replayed).toBe(true);
      expect(await importStrategy(c, w.sa, sheet(2024, 1))).toBeTruthy();                                                   // the quarter is free again
    });
  });

  it("is for Super Admins, needs the typed words, and is refused once the strategy was edited or the window has closed", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const batch = await importStrategy(c, w.sa, sheet(2027, 2));
      await c.expectError("PERMISSION_DENIED", () => voidStrategy(c, w.admin, batch));
      await c.expectError("VALIDATION_ERROR", () => voidStrategy(c, w.sa, batch, "yes"));
      await c.setNow("2026-06-01T12:00:00+01:00");
      await c.q("update key_results set title = 'Edited later', updated_at = app_now() where title = 'KR 1'");
      await c.expectError("IMPORT_VOID_BLOCKED", () => voidStrategy(c, w.sa, batch));
      expect(await count(c, "quarters", "year = 2027")).toBe(1);                                                            // nothing happened
      await c.setNow("2026-06-05T09:00:00+01:00");
      await c.expectError("IMPORT_VOID_WINDOW_CLOSED", () => voidStrategy(c, w.sa, batch));
    });
  });
});

// ---------------------------------------------------------------- sign-ins
describe("rolling back a sign-in import", () => {
  it("lists unused accounts to remove, refuses when someone has signed in, and records the rollback once they are gone", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const a = await c.user(["BU_LEAD"], w.bu, "ua"); const b = await c.user(["BU_LEAD"], w.bu, "ub");
      const email = async (id: string) => (await c.q<{ email: string }>("select email from users where id = $1", [id]))[0].email;
      const batch = await c.rpc<string>("record_sign_in_import", w.sa, [{ userId: a, email: await email(a), roles: ["BU_LEAD"] }, { userId: b, email: await email(b), roles: ["BU_LEAD"] }]);
      await c.q("update auth.users set last_sign_in_at = null where id in ($1, $2)", [a, b]);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("sign_in_import_void_prepare", w.admin, batch, REASON, "VOID IMPORT"));

      await c.q("update auth.users set last_sign_in_at = now() where id = $1", [b]);
      await c.expectError("IMPORT_VOID_BLOCKED", () => c.rpc("sign_in_import_void_prepare", w.sa, batch, REASON, "VOID IMPORT"));
      await c.q("update auth.users set last_sign_in_at = null where id = $1", [b]);

      const plan = await c.rpc<{ userIds: string[] }>("sign_in_import_void_prepare", w.sa, batch, REASON, "VOID IMPORT");
      expect([...plan.userIds].sort()).toEqual([a, b].sort());
      await c.expectError("IMPORT_VOID_BLOCKED", () => c.rpc("sign_in_import_void_finish", w.sa, batch, REASON, "VOID IMPORT", 2));      // the accounts are still there
      for (const id of plan.userIds) await c.rpc("delete_user", w.sa, id, "Sign-in import rolled back");
      const done = await c.rpc<{ accounts_removed: number; replayed: boolean }>("sign_in_import_void_finish", w.sa, batch, REASON, "VOID IMPORT", 2);
      expect([done.accounts_removed, done.replayed]).toEqual([2, false]);
      expect(await count(c, "import_rollbacks", `kind = 'SIGN_INS' and batch_id = '${batch}'`)).toBe(1);
      expect(await count(c, "sign_in_import_users", `batch_id = '${batch}'`)).toBe(2);                                              // the record of who was created stays
    });
  });
});

// ---------------------------------------------------------------- history
type HR = { row_no: number; year: number; week: number; bu_id: string; sub_kr: string | null; goal: string; tasks: { d: string; s: "DONE" | "NOT_DONE" }[] };
const rows = (bu: string, bu2: string): HR[] => [
  { row_no: 2, year: 2025, week: 3, bu_id: bu, sub_kr: "1.1", goal: "Launch pilot", tasks: [{ d: "Brief", s: "DONE" }, { d: "Ship", s: "NOT_DONE" }] },
  { row_no: 3, year: 2025, week: 3, bu_id: bu2, sub_kr: null, goal: "Stretch idea", tasks: [{ d: "Try", s: "DONE" }] },
  { row_no: 4, year: 2025, week: 4, bu_id: bu, sub_kr: "2.3", goal: "Close deals", tasks: [{ d: "Call", s: "DONE" }] },
];
async function importHistory(c: Ctx, actor: string, data: HR[], file: string) {
  const b = await c.rpc<{ batch_id: string }>("history_create_batch", actor, "sample.xlsx", file, data.length);
  await c.rpc("history_stage_rows", actor, b.batch_id, JSON.stringify(data));
  await c.rpc("history_finish_staging", actor, b.batch_id);
  await c.rpc("history_commit", actor, b.batch_id, true, "IMPORT HISTORY");
  return b.batch_id;
}
const voidHistory = (c: Ctx, actor: string, batch: string) =>
  c.rpc<{ reports_removed: number; tasks_removed: number; quarters_removed: number; replayed: boolean }>("history_void", actor, batch, REASON, "VOID IMPORT");
const counts = async (c: Ctx) => ({
  reports: await count(c, "weekly_reports"), goals: await count(c, "smart_goals"), tasks: await count(c, "tasks"), weeks: await count(c, "reporting_weeks"),
  compliance: await count(c, "weekly_compliance"), weekly: await count(c, "weekly_score_snapshots"), quarterly: await count(c, "quarterly_score_snapshots"), quarters: await count(c, "quarters"),
  objectives: await count(c, "quarterly_objectives"), krs: await count(c, "key_results"), subs: await count(c, "sub_key_results"),
});

describe("rolling back a historical import", () => {
  it("puts the database back exactly as it was, restores unit dates, and lets the same file be imported again", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const before = await counts(c);
      const buDates = await c.q<{ id: string; created_at: string }>("select id, created_at::text from business_units order by id");
      const file = sha();
      const batch = await importHistory(c, w.sa, rows(w.bu, w.bu2), file);
      expect((await counts(c)).reports).toBeGreaterThan(0);
      const out = await voidHistory(c, w.sa, batch);
      expect(out.reports_removed).toBe(3);
      expect(await counts(c)).toEqual(before);
      expect(await c.q("select id, created_at::text from business_units order by id")).toEqual(buDates);
      expect((await c.q<{ status: string }>("select status from historical_import_batches where id = $1", [batch]))[0].status).toBe("VOIDED");
      expect(await count(c, "audit_logs", "action = 'HISTORICAL_IMPORT_VOIDED'")).toBe(1);
      expect((await voidHistory(c, w.sa, batch)).replayed).toBe(true);
      const again = await importHistory(c, w.sa, rows(w.bu, w.bu2), file);                                                 // the same file, loaded again
      expect(again).toBe(batch);
      expect((await counts(c)).reports).toBe(3);
    });
  });

  it("keeps the quarter and strategy that existed before the import, removes only the placeholders and scores it added, and keeps the quarter's state", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("strategy_import_commit", w.sa, JSON.stringify(sheet(2025, 1)), "s.xlsx", sha(), "IMPORT STRATEGY");     // 3 key results, 2 Sub-KRs each: "2.3" is missing
      const before = await counts(c);
      const q = (await c.q<{ status: string }>("select status from quarters where year = 2025 and quarter_number = 1"))[0].status;
      const batch = await importHistory(c, w.sa, rows(w.bu, w.bu2), sha());
      expect((await counts(c)).subs).toBe(before.subs + 1);                                                                  // a placeholder Sub-KR 2.3
      await voidHistory(c, w.sa, batch);
      expect(await counts(c)).toEqual(before);
      expect((await c.q<{ status: string }>("select status from quarters where year = 2025 and quarter_number = 1"))[0].status).toBe(q);
    });
  });

  it("is for Super Admins only and closes after 72 hours, changing nothing when refused", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const batch = await importHistory(c, w.sa, rows(w.bu, w.bu2), sha());
      await c.expectError("PERMISSION_DENIED", () => voidHistory(c, w.admin, batch));
      await c.setNow("2026-06-05T09:00:00+01:00");
      await c.expectError("IMPORT_VOID_WINDOW_CLOSED", () => voidHistory(c, w.sa, batch));
      expect((await counts(c)).reports).toBe(3);
    });
  });
});
