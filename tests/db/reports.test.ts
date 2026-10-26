import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { W1, amendClosed, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

interface Row {
  business_unit: string; business_unit_id: string; result_state: string; final_score: string | null; compliance_status: string | null;
  reporting_state: string; week_status: string; submitted_before_content_lock: boolean | null; late_exception_status: string | null;
}

interface KrExecRow {
  key_result_id: string; kr_code: string; kr_title: string; kr_sequence: number;
  sub_key_result_id: string; sub_code: string; sub_title: string; sub_sequence: number;
  reporting_week_id: string; week_number: number; week_start_at: string;
  mapped_goals: number; done_goals: number;
}

/** Three BUs. A files and completes its only goal (100). B and C file nothing (0, non-compliant). The week is finalised. */
async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"); const buB = await c.bu("BRAVO"); const buC = await c.bu("CHARLIE");
  const admin = await c.user(["ADMIN"], buA, "admin"); const sa = await c.user(["SUPER_ADMIN"], buA, "sa");
  const presenter = await c.user(["PRESENTER"], buA, "presenter"); const exec = await c.user(["EXECUTIVE"], buA, "exec");
  const hr = await c.user(["HR"], buA, "hr"); const finance = await c.user(["FINANCE"], buA, "fin");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"); const leadB = await c.user(["BU_LEAD"], buB, "leadB");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  const { reportId, goalId } = await draftGoal(c, leadA, wk, strat.subKrIds[0], ["task"], "Publish the pricing sheets by Friday");
  await c.rpc("submit_weekly_report", leadA, reportId, null, null);
  await c.setNow(W1.afterContentLock);
  const t = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1", [goalId]))[0].id;
  await c.rpc("execute_task", leadA, t, "DONE");
  await c.setNow(W1.finalLock);
  await c.rpc("finalize_reporting_week", wk);
  return { buA, buB, buC, admin, sa, presenter, exec, hr, finance, leadA, leadB, strat, wk, quarterId: strat.quarterId, reportId };
}
const weekly = (c: Ctx, user: string, q: string) => c.asUser(user, () => c.rpc<Row[]>("read_report_weekly_scores", q, null));

describe("report read models reconcile with the authoritative snapshots", () => {
  it("weekly results equal the stored snapshots and compliance records, row for row", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await weekly(c, w.admin, w.quarterId);
      const w1 = rows.filter((r) => r.week_status === "FINAL_LOCKED");
      expect(w1).toHaveLength(3);
      for (const r of w1) {
        const snap = (await c.q<{ final_score: string; score_state: string }>(
          "select final_score, score_state from weekly_score_snapshots where business_unit_id = $1 and reporting_week_id = $2 order by version_number desc limit 1", [r.business_unit_id, w.wk]))[0];
        expect(Number(r.final_score)).toBe(Number(snap.final_score));
        expect(r.result_state).toBe(snap.score_state);
        const comp = (await c.q<{ status: string }>("select status from weekly_compliance where business_unit_id = $1 and reporting_week_id = $2", [r.business_unit_id, w.wk]))[0];
        expect(r.compliance_status).toBe(comp.status);
      }
      const a = w1.find((r) => r.business_unit === "BU ALPHA")!;
      expect([a.result_state, Number(a.final_score), a.compliance_status, a.submitted_before_content_lock]).toEqual(["SCORED", 100, "COMPLIANT", true]);
      expect(w1.filter((r) => r.compliance_status === "NON_COMPLIANT").map((r) => r.business_unit).sort()).toEqual(["BU BRAVO", "BU CHARLIE"]);
      // not-yet-finalised weeks are listed as pending, never as zero
      const pending = rows.filter((r) => r.week_status !== "FINAL_LOCKED");
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.every((r) => r.result_state === "PENDING" && r.final_score === null)).toBe(true);
    });
  });

  it("quarterly results are the latest snapshot version, with the previous quarter beside them", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await c.asUser(w.admin, () => c.rpc<{ business_unit_id: string; score: string | null; version_number: number; versions: number; previous_score: string | null }[]>("read_report_quarter_scores", w.quarterId));
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        const snap = (await c.q<{ score: string; version_number: number }>("select score, version_number from quarterly_score_snapshots where quarter_id = $1 and business_unit_id = $2 order by version_number desc limit 1", [w.quarterId, r.business_unit_id]))[0];
        expect(Number(r.score)).toBe(Number(snap.score));
        expect(r.version_number).toBe(snap.version_number);
        expect(r.previous_score).toBeNull();      // no earlier quarter exists in this fixture: no invented comparison
      }
    });
  });

  it("Sub-KR execution uses the same definition as the Strategy screen", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await c.asUser(w.admin, () => c.rpc<{ sub_key_result_id: string; mapped_goals: number; done_goals: number }[]>("read_report_kr_execution", w.quarterId));
      const tree = await c.asUser(w.admin, () => c.rpc<{ key_results: { sub_key_results: { id: string; mapped_goals: number; done_goals: number }[] }[] }>("read_strategy_tree", w.quarterId));
      for (const kr of tree.key_results) for (const s of kr.sub_key_results) {
        const mine = rows.filter((r) => r.sub_key_result_id === s.id);
        expect(mine.reduce((a, r) => a + r.mapped_goals, 0)).toBe(s.mapped_goals);
        expect(mine.reduce((a, r) => a + r.done_goals, 0)).toBe(s.done_goals);
      }
      expect(tree.key_results[0].sub_key_results[0].mapped_goals).toBe(1);
    });
  });

  it("Sub-KR contribution card verifies weekly execution totals reconcile", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const krExecutionData = await c.asUser(w.admin, () => c.rpc<KrExecRow[]>("read_report_kr_execution", w.quarterId));

      // Manually compute summaries similar to sub-kr-contribution-card.tsx
      const bySubKr = new Map<string, KrExecRow[]>();
      for (const row of krExecutionData) {
        const key = row.sub_key_result_id;
        if (!bySubKr.has(key)) bySubKr.set(key, []);
        bySubKr.get(key)!.push(row);
      }

      const summaries: { sub_key_result_id: string; total_mapped_goals: number; total_done_goals: number }[] = [];
      for (const [subId, entries] of bySubKr) {
        const totalMapped = entries.reduce((sum, e) => sum + e.mapped_goals, 0);
        const totalDone = entries.reduce((sum, e) => sum + e.done_goals, 0);
        summaries.push({ sub_key_result_id: subId, total_mapped_goals: totalMapped, total_done_goals: totalDone });
      }

      // Assertions - read_report_kr_execution returns all 3 Sub-KRs, but only first has goals
      expect(summaries).toHaveLength(3);

      // Verify each Sub-KR has valid data (done <= mapped)
      summaries.forEach((s) => {
        expect(s.total_done_goals).toBeLessThanOrEqual(s.total_mapped_goals);
      });

      // The first Sub-KR (Pipeline) should have the data from the fixture
      const pipelineSummary = summaries.find((s) => s.sub_key_result_id === w.strat.subKrIds[0]);
      expect(pipelineSummary).toBeDefined();
      expect(pipelineSummary?.total_mapped_goals).toBe(1);
      expect(pipelineSummary?.total_done_goals).toBe(1);

      // The other two Sub-KRs should have 0 mapped/done goals
      const otherSummaries = summaries.filter((s) => s.sub_key_result_id !== w.strat.subKrIds[0]);
      otherSummaries.forEach((s) => {
        expect(s.total_mapped_goals).toBe(0);
        expect(s.total_done_goals).toBe(0);
      });
    });
  });
});

describe("report scope follows the existing access rules", () => {
  it("a BU Lead sees only their own BU; organisation roles see all", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(new Set((await weekly(c, w.leadA, w.quarterId)).map((r) => r.business_unit))).toEqual(new Set(["BU ALPHA"]));
      expect(new Set((await weekly(c, w.leadB, w.quarterId)).map((r) => r.business_unit))).toEqual(new Set(["BU BRAVO"]));
      for (const u of [w.admin, w.presenter, w.exec]) expect(new Set((await weekly(c, u, w.quarterId)).map((r) => r.business_unit)).size).toBe(3);
      const q = await c.asUser(w.leadB, () => c.rpc<{ business_unit: string }[]>("read_report_quarter_scores", w.quarterId));
      expect(q.map((r) => r.business_unit)).toEqual(["BU BRAVO"]);
      // a crafted BU filter cannot widen the view
      const crafted = await c.asUser(w.leadB, () => c.rpc<Row[]>("read_report_weekly_scores", w.quarterId, w.buA));
      expect(crafted).toEqual([]);
    });
  });

  it("a password-only session of an elevated role gets no report rows", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await c.asUser(w.admin, () => c.rpc<Row[]>("read_report_weekly_scores", w.quarterId, null), "aal1");
      expect(rows).toEqual([]);
    });
  });

  it("data-quality checks are organisation-wide only", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.leadA, () => c.rpc("read_report_data_quality", w.quarterId)));
      const checks = await c.asUser(w.admin, () => c.rpc<{ check: string; severity: string; count: number }[]>("read_report_data_quality", w.quarterId));
      expect(checks.find((k) => k.check.startsWith("Final-locked weeks missing"))).toMatchObject({ severity: "OK", count: 0 });
    });
  });

  it("finance actuals are empty for roles that cannot read the ledger, and exact for those who can", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const staff = (await c.q<{ id: string }>("select id from employees limit 1"))[0].id;
      const vt = await c.rpc<string>("create_violation_type", w.hr, "LATE", "Late", "LOW", 1000);
      const v = await c.rpc<{ violation_id: string }>("create_violation", w.hr, staff, null, vt, 2500, "agreed", null, randomUUID());
      await c.rpc("record_violation_payment", w.hr, v.violation_id, "PAYMENT", "REF-1", "2031-01-14", randomUUID());
      const run = (u: string) => c.asUser(u, () => c.rpc<{ credits: string | null; debits: string | null; closing_balance: string | null; violations_raised: number | null }[]>("read_report_finance", "2000-01-01", "2099-12-31"));
      expect(await run(w.leadA)).toEqual([]);
      const rows = await run(w.finance);
      expect(rows.reduce((a, r) => a + Number(r.credits), 0)).toBe(2500);
      expect(Number(rows[rows.length - 1].closing_balance)).toBe(2500);
      expect(rows.every((r) => r.violations_raised === null)).toBe(true);        // Finance may not read violations: blank, not zero
      const hrRows = await run(w.admin);                                         // Admin may read both
      expect(hrRows.reduce((a, r) => a + (r.violations_raised ?? 0), 0)).toBe(1);
      expect(Number((await c.q<{ b: string }>("select fund_balance((select id from violation_funds limit 1)) b"))[0].b)).toBe(2500);   // reconciles to the ledger function
    });
  });
});

describe("outstanding items, late-report history and holidays", () => {
  it("lists items by age with priority, and hides review work from roles that do not review", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow("2031-01-25T09:00:00+01:00");      // 10 days after final lock
      await c.rpc("authorise_late_report_exception", w.admin, w.buB, w.wk, "Outage", randomUUID());
      const items = await c.asUser(w.admin, () => c.rpc<{ category: string; priority: string; age_days: number }[]>("read_report_governance_items"));
      expect(items.some((i) => i.category === "REPORT_REVIEW" && i.priority === "HIGH" && i.age_days >= 10)).toBe(true);
      expect(items.some((i) => i.category === "LATE_REPORT")).toBe(true);
      const forLead = await c.asUser(w.leadA, () => c.rpc<{ category: string }[]>("read_report_governance_items"));
      expect(forLead.some((i) => i.category === "REPORT_REVIEW")).toBe(false);
      const forB = await c.asUser(w.leadB, () => c.rpc<{ category: string }[]>("read_report_governance_items"));
      expect(forB.some((i) => i.category === "LATE_REPORT")).toBe(true);        // their own BU's exception
      const forA = await c.asUser(w.leadA, () => c.rpc<{ category: string }[]>("read_report_governance_items"));
      expect(forA.some((i) => i.category === "LATE_REPORT")).toBe(false);       // not another BU's
    });
  });

  it("holiday history shows state changes and post-lock amendments", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await amendClosed(c, w.admin, w.sa, w.wk, "DECLARE", "Retroactive", randomUUID());
      const rows = await c.asUser(w.presenter, () => c.rpc<{ reporting_state: string; post_lock_amendments: number; state_changes: number }[]>("read_report_holidays", w.quarterId));
      expect(rows[0]).toMatchObject({ reporting_state: "ORGANIZATION_HOLIDAY", post_lock_amendments: 1 });
      const weeklyRows = await weekly(c, w.admin, w.quarterId);
      expect(weeklyRows.filter((r) => r.reporting_state === "ORGANIZATION_HOLIDAY").every((r) => r.result_state === "HOLIDAY")).toBe(true);
    });
  });
});

describe("saved reports, snapshots and export audit", () => {
  it("saving and sharing a definition never widens anyone's data access", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await c.rpc<string>("save_report", w.leadA, null, "My view", "bu-scorecard", "reports-1.0.0", { buId: w.buA }, null, null, [w.leadB]);
      expect((await c.asUser(w.leadA, () => c.q("select id from saved_reports"))).length).toBe(1);
      expect((await c.asUser(w.leadB, () => c.q("select id from saved_reports"))).length).toBe(1);           // shared with
      expect((await c.asUser(w.hr, () => c.q("select id from saved_reports"))).length).toBe(0);              // not shared
      // the recipient still runs the report under their own scope
      const asB = await c.asUser(w.leadB, () => c.rpc<Row[]>("read_report_weekly_scores", w.quarterId, w.buA));
      expect(asB).toEqual([]);
      const stranger = await c.user([], w.buA, "norole");
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_report", w.leadA, null, "Bad share", "bu-scorecard", "v", {}, null, null, [stranger]));
      await c.expectError("NOT_FOUND", () => c.rpc("save_report", w.leadB, id, "Hijack", "bu-scorecard", "v", {}, null, null, []));
      await c.expectError("NOT_FOUND", () => c.rpc("delete_saved_report", w.leadB, id));
      await c.rpc("delete_saved_report", w.leadA, id);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("save_report", stranger, null, "x", "bu-scorecard", "v", {}, null, null, []));
    });
  });

  it("official snapshots need the permission and organisation scope, are immutable, and are readable only at that scope", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const call = (u: string) => c.rpc<string>("create_report_snapshot", u, "bu-scorecard", "reports-1.0.0", "Q1 close", {}, "ORGANISATION", { columns: [], rows: [], summary: [] }, 0, "abc", null);
      for (const u of [w.leadA, w.presenter, w.hr, w.finance]) await c.expectError("PERMISSION_DENIED", () => call(u));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("create_report_snapshot", w.admin, "bu-scorecard", "v", "t", {}, "BUSINESS_UNIT", {}, 0, "x", null));
      const id = await call(w.admin);
      expect((await c.asUser(w.exec, () => c.q("select id from report_snapshots where id = $1", [id]))).length).toBe(1);
      expect((await c.asUser(w.leadA, () => c.q("select id from report_snapshots where id = $1", [id]))).length).toBe(0);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update report_snapshots set title = 'x'"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from report_snapshots"));
      const audit = await c.q<{ action: string }>("select action from audit_logs where entity_id = $1", [id]);
      expect(audit.map((a) => a.action)).toContain("REPORT_SNAPSHOT_CREATED");
    });
  });

  it("exports are audited with filters and row count, never with data", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("record_report_export", w.leadA, "bu-scorecard", "CSV", { buId: w.buA }, 4);
      const a = (await c.q<{ new_value: { format: string; rows: number } }>("select new_values as new_value from audit_logs where action = 'REPORT_EXPORTED'"))[0];
      expect(a.new_value).toMatchObject({ format: "CSV", rows: 4 });
      await c.expectError("VALIDATION_ERROR", () => c.rpc("record_report_export", w.leadA, "bu-scorecard", "DOCX", {}, 1));
      const noRole = await c.user([], w.buA, "norole2");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_report_export", noRole, "bu-scorecard", "CSV", {}, 1));
    });
  });
});
