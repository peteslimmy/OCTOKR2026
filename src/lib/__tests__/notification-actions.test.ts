import { describe, expect, it } from "vitest";
import { notificationAction } from "../notification-actions";

describe("notification actions", () => {
  it("leads each kind of event to the place it is acted on", () => {
    expect(notificationAction("REPORT_DUE_REMINDER")).toMatchObject({ href: "/weekly" });
    expect(notificationAction("HOLIDAY_AMENDMENT_REQUESTED")).toMatchObject({ href: "/admin" });
    expect(notificationAction("LEDGER_REVERSAL_EMERGENCY")).toMatchObject({ href: "/finance/ledger" });
    expect(notificationAction("DISBURSEMENT_REQUESTED")).toMatchObject({ href: "/finance" });
    expect(notificationAction("MFA_RECOVERED")).toMatchObject({ href: "/account/security" });
    expect(notificationAction("LATE_REPORT_AUTHORISED")).toMatchObject({ href: "/governance/late-reports" });
  });
  it("gives only same-site paths, and nothing for events with nothing to do", () => {
    for (const e of ["REPORT_DUE_REMINDER", "LEDGER_REVERSAL_DECIDED", "BREAK_GLASS", "ORGANIZATION_HOLIDAY"]) expect(notificationAction(e)?.href).toMatch(/^\/[a-z]/);
    expect(notificationAction("SOMETHING_NEW")).toBeNull();
    expect(notificationAction("")).toBeNull();
  });
});
