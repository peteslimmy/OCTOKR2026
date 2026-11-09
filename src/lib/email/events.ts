import type { EmailContent, FooterKind } from "./layout";

/**
 * What each notification email says (ADR-117). One entry per event the database can email (the `email_event_types` table): a prefix for the subject, a scripted
 * opening, the button and where it goes. The specifics (unit, week, amount, reason) always come from the notification itself and are shown in a box, so no
 * detail is lost; the words around them are written here, in one place, so they can be reviewed together.
 */
export interface EventRow { event_type?: string | null; title?: string | null; message?: string | null; first_name?: string | null }

interface Copy { prefix: string; lead: string; button: string; path: string; footer: FooterKind; closing?: string }

const A = "Action required: ", U = "Update: ", D = "Decision: ", R = "Reminder: ", I = "Important: ";
const FUND = "/violations?tab=fund";

const COPY: Record<string, Copy> = {
  REPORT_DUE_REMINDER: { prefix: R, lead: "Your weekly report is due soon. Please complete and submit it before the deadline so your unit is scored on time.", button: "Open weekly report", path: "/weekly", footer: "reminder" },
  ORGANIZATION_HOLIDAY: { prefix: U, lead: "An organisation holiday has been declared. The reporting rules for the affected week have been adjusted.", button: "Open weekly reports", path: "/weekly", footer: "operational" },
  ORGANIZATION_HOLIDAY_AMENDED: { prefix: U, lead: "A past week was changed to or from a holiday, which can change how that week was scored.", button: "View performance", path: "/performance", footer: "operational" },
  HOLIDAY_AMENDMENT_REQUESTED: { prefix: A, lead: "A holiday amendment is waiting for your decision.", button: "Review the request", path: "/admin/approvals", footer: "operational" },
  HOLIDAY_AMENDMENT_APPROVED: { prefix: D, lead: "Your holiday amendment request has been approved.", button: "View details", path: "/notifications", footer: "operational" },
  HOLIDAY_AMENDMENT_REJECTED: { prefix: D, lead: "Your holiday amendment request was not approved.", button: "View details", path: "/notifications", footer: "operational" },
  LEDGER_REVERSAL_REQUESTED: { prefix: A, lead: "A ledger reversal needs your decision.", button: "Review the request", path: FUND, footer: "operational" },
  LEDGER_REVERSAL_APPROVED: { prefix: A, lead: "A ledger reversal has been approved and is ready to be posted.", button: "Open the fund", path: FUND, footer: "operational" },
  LEDGER_REVERSAL_DECIDED: { prefix: D, lead: "A decision was made on your ledger reversal request.", button: "View details", path: FUND, footer: "operational" },
  LEDGER_REVERSAL_EXECUTED: { prefix: U, lead: "A ledger reversal has been posted.", button: "Open the fund", path: FUND, footer: "operational" },
  LEDGER_REVERSAL_EMERGENCY: { prefix: I, lead: "An emergency ledger reversal was posted. Emergency reversals skip the usual approval steps, so please review it.", button: "Review the ledger", path: FUND, footer: "security" },
  DISBURSEMENT_REQUESTED: { prefix: A, lead: "A disbursement request needs your decision.", button: "Review the request", path: FUND, footer: "operational" },
  DISBURSEMENT_APPROVED: { prefix: D, lead: "Your disbursement request has been approved.", button: "View the request", path: FUND, footer: "operational" },
  DISBURSEMENT_REJECTED: { prefix: D, lead: "Your disbursement request was not approved.", button: "View the request", path: FUND, footer: "operational" },
  LATE_REPORT_AUTHORISED: { prefix: U, lead: "A late report has been authorised, so it can now be submitted.", button: "Open weekly report", path: "/weekly", footer: "operational" },
  LIFECYCLE_CHANGE: { prefix: U, lead: "Your Business Unit or your roles were changed. If anything looks wrong, please contact your administrator.", button: "Open your dashboard", path: "/dashboard", footer: "operational" },
  QUOTE_TURN_MOVED: { prefix: U, lead: "A session was skipped, so your unit's turn to give the quote moves to the next session.", button: "View weekly quote", path: "/quote", footer: "operational" },
  SESSION_ACTION_ASSIGNED: { prefix: A, lead: "An action item from an OKR session has been assigned to you.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_ACTION_REASSIGNED: { prefix: U, lead: "An action item from an OKR session was reassigned.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_ACTION_BLOCKED: { prefix: A, lead: "An action item from an OKR session was marked as blocked and needs attention.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_ACTION_DUE: { prefix: R, lead: "An action item from an OKR session is due soon.", button: "View details", path: "/notifications", footer: "reminder" },
  SESSION_ACTION_OVERDUE: { prefix: A, lead: "An action item from an OKR session is overdue.", button: "View details", path: "/notifications", footer: "reminder" },
  SESSION_ACTION_FOLLOW_UP: { prefix: A, lead: "A commitment from a previous OKR session needs an update.", button: "View details", path: "/notifications", footer: "reminder" },
  SESSION_ACTION_COMPLETED: { prefix: U, lead: "An action item from an OKR session was marked as completed.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_ACTION_VERIFIED: { prefix: U, lead: "The completion of an action item was verified, or sent back for more work.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_DECISION: { prefix: U, lead: "A decision was recorded or changed in an OKR session.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_MINUTES_REVIEW: { prefix: A, lead: "Session minutes were submitted and are waiting for your review.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_MINUTES_FINAL: { prefix: U, lead: "The minutes of an OKR session have been finalised.", button: "View details", path: "/notifications", footer: "operational" },
  SESSION_MENTION: { prefix: U, lead: "You were mentioned in the notes of an OKR session.", button: "View details", path: "/notifications", footer: "operational" },
  HISTORY_IMPORT_COMMITTED: { prefix: I, lead: "An Admin loaded historical reports into closed quarters. The import can be rolled back inside the rollback window if it was not expected.", button: "Review the import", path: "/admin/import/history", footer: "operational" },
  EO_COMMENT_NEW: { prefix: U, lead: "An executive posted a comment about your Business Unit.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
  EO_COMMENT_REPLY: { prefix: U, lead: "Someone replied in a conversation you take part in.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
  EO_REC_NEW: { prefix: A, lead: "A recommendation was addressed to your Business Unit. Please respond before the deadline.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
  EO_REC_RESPONSE: { prefix: U, lead: "A Business Unit responded to your recommendation.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
  EO_REC_CLARIFICATION: { prefix: A, lead: "A clarification was requested on a recommendation.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
  EO_REC_DECISION: { prefix: D, lead: "A recommendation was accepted, partly accepted or declined.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
  EO_REC_UPDATE: { prefix: U, lead: "Implementation progress was reported on a recommendation.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
  EO_REC_DEADLINE: { prefix: R, lead: "The response to a recommendation is due soon.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "reminder" },
  EO_REC_OVERDUE: { prefix: A, lead: "The response to a recommendation is overdue.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "reminder" },
  EO_REC_CLOSED: { prefix: U, lead: "A recommendation was closed or withdrawn.", button: "Open Executive Oversight", path: "/executive-oversight", footer: "operational" },
};

const greet = (first?: string | null) => (first && first.trim() ? `Dear ${first.trim()},` : "Hello,");
const unitOf = (message: string, re: RegExp) => re.exec(message)?.[1]?.trim() || null;
const url = (appUrl: string | undefined, path: string) => `${(appUrl ?? "").replace(/\/+$/, "")}${path}`;

/** The events that are written out in full, in a person's own words rather than as a lead and a box. */
function quote(row: EventRow, appUrl?: string): EmailContent | null {
  const message = row.message ?? "";
  if (row.event_type === "QUOTE_TURN_ASSIGNED") {
    const unit = unitOf(message, /^(.+?) was chosen to give the quote/i);
    if (!unit) return null;
    return {
      subject: `Action required: Submit your weekly session quote – ${unit}`, preheader: "Your team has been chosen to present this week's quote.",
      greeting: greet(row.first_name),
      paragraphs: [`Your team, ${unit}, has been selected to present the motivational quote for this week's OKR session.`, "Please submit your chosen quote and credit the author in the portal before the meeting."],
      cta: { label: "Submit weekly quote", url: url(appUrl, "/quote") }, closing: "Thank you for setting the tone for this week's discussion.", footer: "operational",
    };
  }
  if (row.event_type === "QUOTE_TURN_SUBMITTED") {
    const unit = unitOf(message, /^(.+?) entered its quote/i);
    if (!unit) return null;
    return {
      subject: `Update: Weekly quote submitted by ${unit}`, preheader: `${unit} has entered its quote.`,
      greeting: greet(row.first_name),
      paragraphs: [`${unit} has submitted its motivational quote for this week's OKR session.`, "You can review the submission in the portal ahead of the meeting."],
      cta: { label: "View weekly quote", url: url(appUrl, "/quote") }, footer: "operational",
    };
  }
  return null;
}

/** Security events, written as the person would want to read them: what happened, and what to do whether it was them or not. */
function security(row: EventRow, appUrl?: string): EmailContent | null {
  const account = { label: "Review account activity", url: url(appUrl, "/account/security") };
  const notYou = { heading: "If this was not you:", text: "Please contact your administrator immediately, and review your account activity to secure your credentials." };
  const g = greet(row.first_name);
  switch (row.event_type) {
    case "PASSWORD_CHANGED":
      return {
        subject: "Your 4Core Weekly OKR password was changed", preheader: "As a precaution, all other sessions were signed out.", greeting: g,
        paragraphs: ["Your 4Core Weekly OKR password was just changed. As a precaution, every other device signed in to your account was signed out."],
        notes: [{ heading: "If this was you:", text: "No action is needed. Sign in again on any other device you use." }, notYou], cta: account, footer: "security",
      };
    case "MFA_RESET":
      return {
        subject: "Your authenticator was reset", preheader: "You will set up your authenticator again at your next sign-in.", greeting: g,
        paragraphs: ["The authenticator on your 4Core Weekly OKR account was reset. You will be asked to set it up again the next time you sign in."],
        notes: [{ heading: "If you asked for this:", text: "No action is needed. Sign in and follow the steps to set up your authenticator." }, notYou], cta: account, footer: "security",
      };
    case "MFA_RECOVERED":
      return {
        subject: "A recovery code was used on your account", preheader: "A one-time recovery code was used to sign in.", greeting: g,
        paragraphs: ["A one-time recovery code was just used to sign in to your 4Core Weekly OKR account. That code cannot be used again."],
        notes: [{ heading: "If this was you:", text: "Consider setting up your authenticator again and generating new recovery codes." }, notYou], cta: account, footer: "security",
      };
    case "BREAK_GLASS":
      return {
        subject: "A break-glass reset was performed on your account", preheader: "An emergency reset was performed by an administrator.", greeting: g,
        paragraphs: ["An emergency (break-glass) reset was performed on your 4Core Weekly OKR account."], details: row.message ?? undefined,
        notes: [{ heading: "If you were not expecting this:", text: "Please contact your administrator immediately, and review your account activity." }], cta: account, footer: "security",
      };
    default:
      return null;
  }
}

/** The subject, HTML-ready content and button of the email for one notification. An event with no entry above still gets the same layout, with the notification's own words. */
export function contentForEvent(row: EventRow, appUrl?: string): EmailContent {
  const written = security(row, appUrl) ?? quote(row, appUrl);
  if (written) return written;
  const title = (row.title ?? "").trim() || "A notification from 4Core Weekly OKR";
  const copy = row.event_type ? COPY[row.event_type] : undefined;
  const message = (row.message ?? "").trim();
  if (!copy) {
    return { subject: title, preheader: message.slice(0, 120), greeting: greet(row.first_name), paragraphs: [message || title], cta: appUrl ? { label: "Open 4Core Weekly OKR", url: url(appUrl, "/notifications") } : undefined, footer: "operational" };
  }
  return {
    subject: `${copy.prefix}${title}`, preheader: message.slice(0, 120), greeting: greet(row.first_name), paragraphs: [copy.lead],
    details: message && message !== copy.lead ? message : undefined,
    cta: appUrl ? { label: copy.button, url: url(appUrl, copy.path) } : undefined, closing: copy.closing, footer: copy.footer,
  };
}

/** Every event that has written copy, so a test can prove each emailed event type has some. */
export const EVENTS_WITH_COPY = [...Object.keys(COPY), "PASSWORD_CHANGED", "MFA_RESET", "MFA_RECOVERED", "BREAK_GLASS", "QUOTE_TURN_ASSIGNED", "QUOTE_TURN_SUBMITTED"];
