import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function finalisedReport(c: Ctx) {
  const buA = await c.bu("ALPHA");
  const admin = await c.user(["ADMIN"], buA, "admin");
  const presenter = await c.user(["PRESENTER"], buA, "presenter");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  const { reportId } = await draftGoal(c, leadA, wk, strat.subKrIds[0]);
  await c.rpc("submit_weekly_report", leadA, reportId, null, null);
  await c.setNow(W1.finalLock);
  await c.rpc("finalize_reporting_week", wk);
  return { reportId, presenter, leadA, buA };
}

const row = async (c: Ctx, id: string) =>
  (await c.q<Record<string, unknown>>(
    "select review_status, review_comments, review_rejection_reason, rejected_by, reviewed_by from weekly_reports where id = $1", [id]))[0];

describe("report review comments and rejection", () => {
  it("stores optional review comments and audits the review", async () => {
    await withTx(async (c) => {
      const w = await finalisedReport(c);
      await c.rpc("review_weekly_report", w.presenter, w.reportId, "  Solid week.  ");
      expect(await row(c, w.reportId)).toMatchObject({ review_status: "REVIEWED", review_comments: "Solid week.", review_rejection_reason: null });
      const audit = await c.q("select 1 from audit_logs where action = 'REPORT_REVIEWED' and entity_id = $1", [w.reportId]);
      expect(audit.length).toBe(1);
    });
  });

  it("rejection needs a reason and permission, keeps the report awaiting review, and is audited", async () => {
    await withTx(async (c) => {
      const w = await finalisedReport(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("reject_weekly_report", w.leadA, w.reportId, "nope"));
      await c.expectError("VALIDATION_FAILED", () => c.rpc("reject_weekly_report", w.presenter, w.reportId, "   "));
      await c.rpc("reject_weekly_report", w.presenter, w.reportId, "Goals are not measurable");
      expect(await row(c, w.reportId)).toMatchObject({
        review_status: "NOT_REVIEWED", review_rejection_reason: "Goals are not measurable", rejected_by: w.presenter,
      });
      const audit = await c.q("select reason from audit_logs where action = 'REPORT_REJECTED' and entity_id = $1", [w.reportId]);
      expect(audit.map((a) => (a as { reason: string }).reason)).toEqual(["Goals are not measurable"]);
      const note = await c.q<{ user_id: string; message: string }>("select user_id, message from notifications where event_type = 'REPORT_REJECTED' and entity_id = $1", [w.reportId]);
      expect(note.map((n) => n.user_id)).toEqual([w.leadA]);
      expect(note[0].message).toContain("Goals are not measurable");
      // the score snapshot is untouched
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update weekly_score_snapshots set final_score = 100"));
    });
  });

  it("a later review clears the rejection; a reviewed report cannot be rejected; the view exposes the fields", async () => {
    await withTx(async (c) => {
      const w = await finalisedReport(c);
      await c.rpc("reject_weekly_report", w.presenter, w.reportId, "Fix the goals");
      await c.rpc("review_weekly_report", w.presenter, w.reportId, "Fixed, thanks");
      expect(await row(c, w.reportId)).toMatchObject({ review_status: "REVIEWED", review_comments: "Fixed, thanks", review_rejection_reason: null });
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("reject_weekly_report", w.presenter, w.reportId, "too late"));
      const view = await c.rpc<{ report: Record<string, unknown> }>("read_report_view", w.reportId);
      expect(view.report).toMatchObject({ review_status: "REVIEWED", review_comments: "Fixed, thanks", review_rejection_reason: null });
    });
  });

  it("other final-locked columns stay immutable", async () => {
    await withTx(async (c) => {
      const w = await finalisedReport(c);
      await c.expectError("REPORT_FINAL_LOCKED", () => c.q("update weekly_reports set skipped_session_summary_comment = 'x' where id = $1", [w.reportId]));
    });
  });
});
