/** Where a notification should take the person: the place the underlying action is done. Events with nothing to do return null. */
export interface NotificationAction { href: string; label: string }

const ROUTES: [RegExp, NotificationAction][] = [
  [/^REPORT_DUE_REMINDER$|^ORGANIZATION_HOLIDAY(_AMENDED)?$|^FINAL_LOCKED$|^INTEGRITY_CORRECTION$/, { href: "/weekly", label: "Open weekly reports" }],
  [/^QUOTE_TURN_/, { href: "/quote", label: "Open the weekly quote" }],
  [/^SESSION_ACTION_/, { href: "/notes", label: "Open the notes" }],
  [/^SESSION_DECISION$/, { href: "/notes", label: "Open the notes" }],
  [/^SESSION_MINUTES_/, { href: "/notes", label: "Open the notes" }],
  [/^EO_COMMENT_/, { href: "/executive-oversight?tab=comments", label: "Open the conversation" }],
  [/^EO_REC_/, { href: "/executive-oversight?tab=recommendations", label: "Open the recommendation" }],
  [/^LIFECYCLE_CHANGE$/, { href: "/account/journey", label: "See your journey" }],
  [/^CONFIG_CHANGE_/, { href: "/admin/approvals", label: "Open approvals" }],
  [/^HOLIDAY_AMENDMENT_/, { href: "/admin", label: "Open holiday amendment requests" }],
  [/^LEDGER_REVERSAL_/, { href: "/violations?tab=fund&view=ledger", label: "Open the ledger and reversal requests" }],
  [/^DISBURSEMENT_/, { href: "/violations?tab=fund", label: "Open fund requests" }],
  [/^ATTENDANCE_AMENDMENT_/, { href: "/governance/amendments", label: "Open attendance amendments" }],
  [/^QUARTER_SCORE_AMENDED$/, { href: "/dashboard", label: "Open the dashboard" }],
  [/^(MFA_RECOVERED|MFA_RESET|PASSWORD_CHANGED|BREAK_GLASS)$/, { href: "/account/security", label: "Review your account security" }],
];

export function notificationAction(eventType: string): NotificationAction | null {
  for (const [pattern, action] of ROUTES) if (pattern.test(eventType)) return action;
  return null;
}
