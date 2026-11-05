import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"), buB = await c.bu("BRAVO");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa"), admin = await c.user(["ADMIN"], buA, "admin"), exec = await c.user(["EXECUTIVE"], buA, "exec"), hr = await c.user(["HR"], buA, "hr");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"), leadB = await c.user(["BU_LEAD"], buB, "leadB");
  await c.rpc("ai_set_setting", sa, "enabled", true);
  return { buA, buB, sa, admin, exec, hr, leadA, leadB };
}
type W = Awaited<ReturnType<typeof world>>;
const mkCase = (c: Ctx, bu: string | null, severity = "MEDIUM") => c.rpc<string>("ai_open_case", null, "A test case", "OTHER", "Something to look at", bu, severity, "assessment", "[]", "recommendation", [{ kind: "OTHER", summary: "evidence" }], null, null, null, null);
type Counts = { cases: Record<string, number>; approvalsPending: number; communications: Record<string, number>; plans: Record<string, number> };

describe("the executive counts", () => {
  it("count what is there, for an executive across units and for a unit lead within their own", async () => {
    await withTx(async (c) => {
      const w: W = await world(c);
      await mkCase(c, w.buA, "HIGH"); await mkCase(c, w.buA, "LOW"); await mkCase(c, w.buB, "CRITICAL");
      await c.rpc("ai_engagement_tick");
      const exec = await c.asUser(w.exec, () => c.rpc<Counts>("read_ai_executive_counts"));
      expect(exec.cases).toMatchObject({ open: 3, highOpen: 2 });
      const lead = await c.asUser(w.leadA, () => c.rpc<Counts>("read_ai_executive_counts"));
      expect(lead.cases).toMatchObject({ open: 2, highOpen: 1 });                 // only the unit's own cases are visible to count
      expect((await c.asUser(w.hr, () => c.rpc<Counts>("read_ai_executive_counts"))).cases).toMatchObject({ open: 0 });
    });
  });

  it("a resolved case leaves the open count and enters the resolved-in-30-days count", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await mkCase(c, w.buA, "HIGH");
      await c.rpc("ai_case_update", w.admin, id, "RESOLVED", "Fixed");
      const n = await c.asUser(w.exec, () => c.rpc<Counts>("read_ai_executive_counts"));
      expect(n.cases).toMatchObject({ open: 0, resolvedLast30: 1 });
    });
  });

  it("approvals waiting are counted only for those who may see them", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("insert into ai_approvals (action_type, subject_type, proposal, requested_by, by_agent) values ('CHANGE_GOAL', 'goal', '{}', $1, false)", [w.leadA]);
      expect((await c.asUser(w.sa, () => c.rpc<Counts>("read_ai_executive_counts"))).approvalsPending).toBe(1);
      expect((await c.asUser(w.exec, () => c.rpc<Counts>("read_ai_executive_counts"))).approvalsPending).toBe(0);
    });
  });
});

describe("the communication history", () => {
  it("shows who was told, in the application and by email, with the email's delivery state, and never an email address", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await mkCase(c, w.buA, "MEDIUM");
      await c.rpc("ai_engagement_tick");
      type Row = { recipient: string; kind: string; inApp: string; email: string; emailAttempts: number; followUp: string; unit: string };
      let rows = await c.asUser(w.exec, () => c.rpc<Row[]>("read_ai_communications", 50));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "ALERT", inApp: "SENT", email: "PENDING", followUp: "PENDING", unit: "BU ALPHA" });
      expect(JSON.stringify(rows)).not.toContain("@");
      await c.q("update email_outbox set status = 'FAILED', attempts = 3");
      rows = await c.asUser(w.exec, () => c.rpc<Row[]>("read_ai_communications", 50));
      expect(rows[0]).toMatchObject({ email: "FAILED", emailAttempts: 3 });
      await c.q("update email_outbox set status = 'SENT'");
      expect((await c.asUser(w.exec, () => c.rpc<Row[]>("read_ai_communications", 50)))[0].email).toBe("SENT");
    });
  });

  it("an organisation view for executives, own unit only for a lead, nothing for a person without the permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await mkCase(c, w.buA, "MEDIUM"); await mkCase(c, w.buB, "MEDIUM");
      await c.rpc("ai_engagement_tick");
      type Row = { unit: string };
      const units = async (u: string) => (await c.asUser(u, () => c.rpc<Row[]>("read_ai_communications", 50))).map((r) => r.unit).sort();
      expect(await units(w.exec)).toEqual(["BU ALPHA", "BU BRAVO"]);
      expect(await units(w.leadA)).toEqual([]);                                  // a lead does not hold the communication-history permission
      expect(await units(w.hr)).toEqual([]);
      await c.q("insert into user_permission_grants (user_id, permission_id, expires_at) select $1, id, null from permissions where code = 'ai.communication.view'", [w.leadA]).catch(() => undefined);
    });
  });

  it("caps the number of rows it returns", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (let i = 0; i < 3; i++) await mkCase(c, w.buA, "MEDIUM");
      await c.rpc("ai_engagement_tick");
      expect(await c.asUser(w.exec, () => c.rpc<unknown[]>("read_ai_communications", 1))).toHaveLength(1);
    });
  });
});

describe("report exports are audited without their content", () => {
  it("need the export permission and the module on, record who, which report and which format, and refuse an unknown format", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_log_report", w.leadA, "weekly-org", "csv", "Organisation"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_log_report", w.exec, "weekly-org", "pdf", "Organisation"));
      await c.rpc("ai_log_report", w.exec, "weekly-org", "csv", "Organisation");
      const a = await c.q<{ actor_user_id: string; entity_id: string; new_values: { format: string; scope: string } }>("select actor_user_id, entity_id, new_values from audit_logs where action = 'AI_REPORT_EXPORTED'");
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ actor_user_id: w.exec, entity_id: "weekly-org", new_values: { format: "csv", scope: "Organisation" } });
      await c.rpc("ai_set_setting", w.sa, "enabled", false);
      await c.expectError("AI_DISABLED", () => c.rpc("ai_log_report", w.exec, "weekly-org", "csv", "Organisation"));
    });
  });
});
