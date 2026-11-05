// Labels and small vocabularies of the Executive Oversight module (docs/41-EXECUTIVE-OVERSIGHT.md). Display only: the database owns every rule.

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export const priorityLabel: Record<string, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", CRITICAL: "Critical" };

export const MODULES = [
  ["DASHBOARD", "Executive dashboard"], ["BU_PERFORMANCE", "Business unit performance"], ["WEEKLY_REPORT", "Weekly report"], ["PRESENTATION", "Presentation"], ["STRATEGY", "Strategy"],
  ["OBJECTIVE", "Objective"], ["KEY_RESULT", "Key result"], ["SUB_KEY_RESULT", "Sub-KR"], ["GOAL", "Goal"], ["TASK", "Task"], ["BU_GOAL", "Business unit goal"],
  ["COMPLIANCE", "Compliance"], ["RISK", "Risk or blocker"], ["HISTORICAL_REPORT", "Historical report"], ["SESSION_NOTES", "Session notes"], ["OTHER", "Other"],
] as const;
export const moduleLabel = (m: string) => MODULES.find(([k]) => k === m)?.[1] ?? m;

export const TARGET_STATUSES = [
  "DRAFT", "SUBMITTED", "ACKNOWLEDGED", "RESPONSE_REQUESTED", "RESPONSE_SUBMITTED", "UNDER_CONSIDERATION", "ACCEPTED_FOR_ACTION", "PARTIALLY_ACCEPTED", "NOT_ACCEPTED",
  "IMPLEMENTATION_IN_PROGRESS", "IMPLEMENTATION_REPORTED", "CLOSED", "WITHDRAWN",
] as const;
export const statusLabel: Record<string, string> = {
  DRAFT: "Draft", SUBMITTED: "Awaiting acknowledgement", ACKNOWLEDGED: "Acknowledged", RESPONSE_REQUESTED: "Awaiting response", RESPONSE_SUBMITTED: "Alternative proposed",
  UNDER_CONSIDERATION: "Under consideration", ACCEPTED_FOR_ACTION: "Accepted for action", PARTIALLY_ACCEPTED: "Partially accepted", NOT_ACCEPTED: "Not accepted",
  IMPLEMENTATION_IN_PROGRESS: "Implementation in progress", IMPLEMENTATION_REPORTED: "Implementation reported", CLOSED: "Closed", WITHDRAWN: "Withdrawn",
};
export const awaitingLabel: Record<string, string> = { BU: "Waiting for the business unit", EXECUTIVE: "Waiting for the Executive" };

export const LINK_TYPES: Record<string, string> = {
  ANNUAL_THEME: "Annual theme", QUARTER: "Quarter", OBJECTIVE: "Objective", KEY_RESULT: "Key result", SUB_KEY_RESULT: "Sub-KR", BU_GOAL: "Unit goal", WEEKLY_GOAL: "Weekly goal", TASK: "Task",
  WEEKLY_REPORT: "Weekly report", SESSION: "Session", SESSION_NOTE: "Session note", SESSION_DECISION: "Decision", SESSION_ACTION: "Action", SESSION_RISK: "Risk",
};
export const linkTypeLabel = (t: string) => LINK_TYPES[t] ?? t;

export const EVENT_LABEL: Record<string, string> = {
  CREATED: "Posted", REPLY: "Replied", AMENDED: "Amended", WITHDRAWN: "Withdrawn", DRAFT_CREATED: "Draft started", PUBLISHED: "Issued", ACKNOWLEDGED: "Acknowledged receipt", ACCEPTED: "Accepted for action",
  PARTIALLY_ACCEPTED: "Partially accepted", DECLINED: "Declined", ALTERNATIVE_PROPOSED: "Proposed an alternative", UNDER_CONSIDERATION: "Is considering it", CLARIFICATION_REQUESTED: "Asked for clarification",
  FOLLOW_UP_QUESTION: "Asked a follow-up question", MESSAGE: "Wrote", PROGRESS_REPORTED: "Reported progress", IMPLEMENTATION_REPORTED: "Reported it implemented", CLOSED: "Closed",
  REASSIGNED: "Changed the responsible contact", ESCALATED: "Escalated (response overdue)", LINK_ADDED: "Linked a record", LINK_REMOVED: "Removed a link", ATTACHMENT_ADDED: "Attached a file", ATTACHMENT_REMOVED: "Withdrew a file",
};
export const eventLabel = (e: string) => EVENT_LABEL[e] ?? e;

/** The decisions a unit can give, with the explanation each needs (the database enforces the same). */
export const RESPONSES = [
  { value: "ACCEPT", label: "Accept for action", needs: "optional", help: "You agree to act on it. You will report progress here; the change itself is made through your usual workflow." },
  { value: "PARTIAL", label: "Partially accept", needs: "required", help: "Say what you will do and what you will not." },
  { value: "DECLINE", label: "Decline", needs: "required", help: "A reason is recorded. Declining advice is allowed and has no compliance consequence." },
  { value: "ALTERNATIVE", label: "Propose an alternative", needs: "required", help: "Describe the different approach you suggest." },
  { value: "CONSIDERING", label: "Still considering", needs: "optional", help: "Record constraints or what you are waiting for." },
  { value: "CLARIFICATION", label: "Ask for clarification", needs: "required", help: "Ask the Executive what is meant. The response clock waits for their answer." },
] as const;

export const ESCALATION_STAGES: Record<string, string> = {
  APPROACHING: "Deadline approaching (days before)", OVERDUE_REMINDER: "Reminder after the deadline (days after)", OVERDUE_MANAGEMENT: "Management contact (days after)", OVERDUE_SENIOR: "Senior authority (days after)",
};

export const MAX_EXPORT = 5000;
