import { describe, expect, it } from "vitest";
import { notificationAction } from "../notification-actions";

describe("notification actions", () => {
  it("leads each kind of event to the place it is acted on", () => {
    expect(notificationAction("REPORT_DUE_REMINDER")).toMatchObject({ href: "/weekly" });
    expect(notificationAction("HOLIDAY_AMENDMENT_REQUESTED")).toMatchObject({ href: "/admin" });
    expect(notificationAction("LEDGER_REVERSAL_EMERGENCY")).toMatchObject({ href: "/violations?tab=fund&view=ledger" });
    expect(notificationAction("DISBURSEMENT_REQUESTED")).toMatchObject({ href: "/violations?tab=fund" });
    expect(notificationAction("MFA_RECOVERED")).toMatchObject({ href: "/account/security" });
    expect(notificationAction("LATE_REPORT_AUTHORISED")).toMatchObject({ href: "/governance/late-reports" });
  });
  it("leads a 4COREPAL request to the remarks and an escalation to monitoring", () => {
    expect(notificationAction("AI_REMARK_REQUEST")).toMatchObject({ href: "/ai/remarks" });
    expect(notificationAction("AI_REMARK_REMINDER")).toMatchObject({ href: "/ai/remarks" });
    expect(notificationAction("AI_ESCALATION")).toMatchObject({ href: "/ai/monitoring" });
  });
  it("leads 4COREPAL cases, approvals and the monthly review to their pages", () => {
    for (const e of ["AI_CASE", "AI_CASE_ESCALATION", "AI_CASE_RESOLVED", "AI_PLAN_DECIDED"]) expect(notificationAction(e)).toMatchObject({ href: "/ai/cases" });
    expect(notificationAction("AI_CLOSURE_REQUEST")).toMatchObject({ href: "/ai/closure" });
    expect(notificationAction("AI_APPROVAL_REQUEST")).toMatchObject({ href: "/ai/approvals" });
  });
  it("gives only same-site paths, and nothing for events with nothing to do", () => {
    for (const e of ["REPORT_DUE_REMINDER", "LEDGER_REVERSAL_DECIDED", "BREAK_GLASS", "ORGANIZATION_HOLIDAY"]) expect(notificationAction(e)?.href).toMatch(/^\/[a-z]/);
    expect(notificationAction("SOMETHING_NEW")).toBeNull();
    expect(notificationAction("")).toBeNull();
  });
});
