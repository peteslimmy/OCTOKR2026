import { describe, expect, it } from "vitest";
import { composeMail } from "../deliver";
import { EVENTS_WITH_COPY, contentForEvent } from "../events";
import { renderEmail } from "../layout";
import { composeInvitation } from "../invite";

const APP = "https://okr.example.test";
const row = (over: Record<string, string | null>) => ({ id: "1", to_email: "ada@example.test", subject: "Title", body: "Message", attempts: 1, ...over });

// the events the database can email (email_event_types, after the AI events were removed): each must have written copy
const EMAILED = [
  "BREAK_GLASS", "HISTORY_IMPORT_COMMITTED", "DISBURSEMENT_APPROVED", "DISBURSEMENT_REJECTED", "DISBURSEMENT_REQUESTED", "EO_COMMENT_NEW", "EO_COMMENT_REPLY", "EO_REC_CLARIFICATION", "EO_REC_CLOSED", "EO_REC_DEADLINE",
  "EO_REC_DECISION", "EO_REC_NEW", "EO_REC_OVERDUE", "EO_REC_RESPONSE", "EO_REC_UPDATE", "HOLIDAY_AMENDMENT_APPROVED", "HOLIDAY_AMENDMENT_REJECTED", "HOLIDAY_AMENDMENT_REQUESTED",
  "LATE_REPORT_AUTHORISED", "LEDGER_REVERSAL_APPROVED", "LEDGER_REVERSAL_DECIDED", "LEDGER_REVERSAL_EMERGENCY", "LEDGER_REVERSAL_EXECUTED", "LEDGER_REVERSAL_REQUESTED", "LIFECYCLE_CHANGE",
  "MFA_RECOVERED", "MFA_RESET", "ORGANIZATION_HOLIDAY", "ORGANIZATION_HOLIDAY_AMENDED", "PASSWORD_CHANGED", "QUOTE_TURN_ASSIGNED", "QUOTE_TURN_MOVED", "QUOTE_TURN_SUBMITTED", "REPORT_DUE_REMINDER",
  "SESSION_ACTION_ASSIGNED", "SESSION_ACTION_BLOCKED", "SESSION_ACTION_COMPLETED", "SESSION_ACTION_DUE", "SESSION_ACTION_FOLLOW_UP", "SESSION_ACTION_OVERDUE", "SESSION_ACTION_REASSIGNED",
  "SESSION_ACTION_VERIFIED", "SESSION_DECISION", "SESSION_MENTION", "SESSION_MINUTES_FINAL", "SESSION_MINUTES_REVIEW",
];

describe("notification emails", () => {
  it("every emailed event has written copy", () => {
    expect(EMAILED.filter((e) => !EVENTS_WITH_COPY.includes(e))).toEqual([]);
  });

  it("every event email greets by name, has a button to the application, a signature and a footer that says why", () => {
    for (const e of EMAILED) {
      const m = composeMail(row({ event_type: e, first_name: "Ada", subject: "Week 46 report", body: "Engineering: details here." }), APP);
      expect(m.text, e).toContain("Dear Ada,");
      expect(m.text, e).toContain(`${APP}/`);
      expect(m.text, e).toContain("Regards,\n4Core BizOps Team");
      expect(m.text, e).toMatch(/4Core Weekly OKR • /);
      expect(m.html, e).toContain("<table");
      expect(m.html, e).not.toMatch(/<script/i);
      expect(m.subject.length, e).toBeGreaterThan(5);
    }
  });

  it("says Hello when the first name is not known, and never prints a placeholder", () => {
    const m = composeMail(row({ event_type: "REPORT_DUE_REMINDER", first_name: null }), APP);
    expect(m.text.startsWith("Hello,")).toBe(true);
    expect(m.text + m.html).not.toMatch(/\{\{|undefined|null/);
  });

  it("the password-changed email says what happened and what to do, whether it was the person or not", () => {
    const m = composeMail(row({ event_type: "PASSWORD_CHANGED", first_name: "Ada" }), APP);
    expect(m.subject).toBe("Your 4Core Weekly OKR password was changed");
    expect(m.text).toContain("If this was you:");
    expect(m.text).toContain("If this was not you:");
    expect(m.text).toContain("contact your administrator immediately");
    expect(m.text).toContain("This is an automated security notice.");
    expect(m.text).not.toMatch(/unusual activity/i);
    expect(m.html).toContain(`${APP}/account/security`);
  });

  it("the quote emails read as written: the unit is named and the button goes to the weekly quote", () => {
    const a = composeMail(row({ event_type: "QUOTE_TURN_ASSIGNED", first_name: "Tolu", subject: "Your unit gives the quote in week 46", body: "Business Operations was chosen to give the quote in the weekly session. Enter the quote and who said it under Weekly quote." }), APP);
    expect(a.subject).toBe("Action required: Submit your weekly session quote – Business Operations");
    expect(a.text).toContain("Your team, Business Operations, has been selected to present the motivational quote for this week's OKR session.");
    expect(a.text).toContain(`Submit weekly quote: ${APP}/quote`);
    expect(a.text).toContain("Thank you for setting the tone for this week's discussion.");
    const b = composeMail(row({ event_type: "QUOTE_TURN_SUBMITTED", first_name: "Tolu", subject: "Quote entered for week 46", body: "Business Operations entered its quote." }), APP);
    expect(b.subject).toBe("Update: Weekly quote submitted by Business Operations");
    expect(b.text).toContain("Business Operations has submitted its motivational quote for this week's OKR session.");
    expect(b.text).toContain(`View weekly quote: ${APP}/quote`);
    expect(b.text).toContain("You received this operational update based on your role on the team.");
  });

  it("keeps the specifics of the notification in the email, and prefixes the subject by what is asked of the reader", () => {
    const c = contentForEvent({ event_type: "DISBURSEMENT_REQUESTED", title: "Disbursement request awaiting approval", message: "₦50,000 for team lunch, requested by Ada.", first_name: "Bayo" }, APP);
    expect(c.subject).toBe("Action required: Disbursement request awaiting approval");
    expect(c.details).toBe("₦50,000 for team lunch, requested by Ada.");
    expect(c.cta?.url).toBe(`${APP}/violations?tab=fund`);
  });

  it("an event nobody wrote copy for still gets the same layout with the notification's own words", () => {
    const m = composeMail(row({ event_type: "SOMETHING_NEW", first_name: "Ada", subject: "A new thing", body: "It happened." }), APP);
    expect(m.subject).toBe("A new thing");
    expect(m.text).toContain("It happened.");
    expect(m.text).toContain("Regards,\n4Core BizOps Team");
  });

  it("escapes everything it shows, and only links to http(s) addresses", () => {
    const m = composeMail(row({ event_type: "REPORT_DUE_REMINDER", first_name: "<b>Ada</b>", subject: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script> & more" }), APP);
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;script&gt;");
    const r = renderEmail({ subject: "s", greeting: "Hi,", paragraphs: ["p"], cta: { label: "Go", url: "javascript:alert(1)" }, footer: "operational" }, APP);
    expect(r.html).not.toContain("javascript:");
    expect(r.text).not.toContain("javascript:");
  });

  it("without an application address there are no links at all", () => {
    const m = composeMail(row({ event_type: "REPORT_DUE_REMINDER", first_name: "Ada" }));
    expect(m.html).not.toContain("href=");
    expect(m.text).not.toContain("http");
  });
});

describe("invitation email", () => {
  const link = `${APP}/auth/confirm?token_hash=abc123&type=recovery`;
  it("welcomes the person, says who invited them, and gives one button to set up the account", () => {
    const m = composeInvitation({ to: "ada@example.test", firstName: "Ada", setupUrl: link, appUrl: APP, invitedBy: "Peter Oria" });
    expect(m.subject).toBe("You've been invited to 4Core Weekly OKR");
    expect(m.text).toContain("Dear Ada,");
    expect(m.text).toContain("Peter Oria");
    expect(m.text).toContain(`Set up your account: ${link}`);
    expect(m.text).toContain("valid for 24 hours");
    expect(m.text).toContain("If you were not expecting this");
    expect(m.text).toContain("Regards,\n4Core BizOps Team");
    expect(m.html).toContain(link.replace(/&/g, "&amp;"));
  });
  it("refuses a link that is not http(s) and a recipient that is not one plain address", () => {
    expect(() => composeInvitation({ to: "ada@example.test", firstName: "Ada", setupUrl: "javascript:alert(1)", appUrl: APP })).toThrow();
    expect(() => composeInvitation({ to: "a@b.test,c@d.test", firstName: "Ada", setupUrl: link, appUrl: APP })).toThrow();
  });
});

describe("logo in emails", () => {
  const brand = { logoUrl: `${APP}/branding/logo?v=3`, logoHeight: 40 };
  it("shows the organisation's logo at the top of notification and invitation emails", () => {
    const n = composeMail(row({ event_type: "REPORT_DUE_REMINDER", first_name: "Ada" }), APP, brand);
    expect(n.html).toContain(`<img src="${APP}/branding/logo?v=3" alt="4Core Weekly OKR" height="40"`);
    const i = composeInvitation({ to: "ada@example.test", firstName: "Ada", setupUrl: `${APP}/auth/confirm?token_hash=abc&type=recovery`, appUrl: APP, brand });
    expect(i.html).toContain(`${APP}/branding/logo?v=3`);
    expect(n.text).not.toContain("branding/logo");                                     // the plain-text twin has no picture
  });
  it("falls back to the product name when there is no logo, and never uses an address that is not http(s)", () => {
    expect(composeMail(row({ event_type: "REPORT_DUE_REMINDER" }), APP).html).not.toContain("<img");
    expect(composeMail(row({ event_type: "REPORT_DUE_REMINDER" }), APP, { logoUrl: "javascript:alert(1)" }).html).not.toContain("<img");
    expect(composeMail(row({ event_type: "REPORT_DUE_REMINDER" }), APP, { logoUrl: `${APP}/x" onerror="alert(1)` }).html).not.toContain("onerror");
  });
  it("keeps the logo a sensible size", () => {
    expect(composeMail(row({ event_type: "REPORT_DUE_REMINDER" }), APP, { logoUrl: `${APP}/l`, logoHeight: 500 }).html).toContain('height="56"');
    expect(composeMail(row({ event_type: "REPORT_DUE_REMINDER" }), APP, { logoUrl: `${APP}/l`, logoHeight: 2 }).html).toContain('height="24"');
  });
});
