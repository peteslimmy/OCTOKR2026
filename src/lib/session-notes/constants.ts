// Client-safe vocabulary of the OKR Session Notes module. The database holds the authoritative CHECK constraints; these are the labels and orderings the screens use.

export const NOTE_CATEGORIES = [
  { code: "GENERAL_DISCUSSION", label: "General discussion" },
  { code: "PERFORMANCE_OBSERVATION", label: "Performance observation" },
  { code: "QUESTION_RAISED", label: "Question raised" },
  { code: "BU_RESPONSE", label: "BU explanation / response" },
  { code: "MANAGEMENT_FEEDBACK", label: "Management feedback" },
  { code: "CHALLENGE_CONCERN", label: "Challenge or concern" },
  { code: "RISK_BLOCKER", label: "Risk or blocker" },
  { code: "RECOMMENDATION", label: "Recommendation" },
  { code: "DECISION", label: "Decision (discussion)" },
  { code: "ACTION_ITEM", label: "Action item (discussion)" },
  { code: "FOLLOW_UP", label: "Matter for follow-up" },
] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number]["code"];
export const categoryLabel = (code: string) => NOTE_CATEGORIES.find((c) => c.code === code)?.label ?? code;

export const NOTE_VISIBILITY = [
  { code: "SHARED", label: "Shared with everyone in the session", hint: "The unit's people and the other participants can read it" },
  { code: "MANAGEMENT", label: "Management only", hint: "Presenters and executives (and you) can read it; unit members cannot" },
  { code: "CONFIDENTIAL", label: "Confidential", hint: "Only you and the facilitator can read it" },
] as const;
export const visibilityLabel = (code: string) => NOTE_VISIBILITY.find((v) => v.code === code)?.label ?? code;

export const SESSION_STATUSES = ["DRAFT", "IN_PROGRESS", "COMPLETED", "ARCHIVED"] as const;
export const sessionStatusLabel: Record<string, string> = { DRAFT: "Draft", IN_PROGRESS: "In progress", COMPLETED: "Completed", ARCHIVED: "Archived" };

export const DECISION_STATUSES = ["PROPOSED", "APPROVED", "REJECTED", "SUPERSEDED", "WITHDRAWN"] as const;
export const decisionStatusLabel: Record<string, string> = { PROPOSED: "Proposed", APPROVED: "Approved", REJECTED: "Rejected", SUPERSEDED: "Superseded", WITHDRAWN: "Withdrawn" };

export const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"] as const;
export const actionStatusLabel: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", BLOCKED: "Blocked", COMPLETED: "Completed", CANCELLED: "Cancelled" };
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const RISK_KINDS = ["RISK", "BLOCKER", "ISSUE"] as const;
export const RISK_CATEGORIES = ["OPERATIONAL", "FINANCIAL", "PEOPLE", "TECHNICAL", "COMPLIANCE", "EXTERNAL", "OTHER"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const RISK_STATUSES = ["OPEN", "MITIGATING", "RESOLVED", "CLOSED"] as const;

export const MINUTES_STATUSES = ["DRAFT", "SUBMITTED", "REVIEWED", "FINALISED"] as const;
export const minutesStatusLabel: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Submitted for review", REVIEWED: "Reviewed", FINALISED: "Finalised" };

export const CARRY_OUTCOMES = [
  { code: "STILL_OPEN", label: "Still open" },
  { code: "UPDATE_REQUESTED", label: "Update requested from the owner" },
  { code: "EXPLAINED", label: "Explanation recorded" },
  { code: "COMPLETION_CONFIRMED", label: "Completion confirmed" },
  { code: "EXTENDED", label: "Deadline extended" },
  { code: "ESCALATED", label: "Escalated" },
  { code: "RESOLVED", label: "Resolved" },
] as const;

export const LINK_TYPES = [
  { code: "ANNUAL_THEME", label: "Annual theme" },
  { code: "QUARTER", label: "Quarter" },
  { code: "OBJECTIVE", label: "Objective" },
  { code: "KEY_RESULT", label: "Key result" },
  { code: "SUB_KEY_RESULT", label: "Sub-KR" },
  { code: "BU_GOAL", label: "BU goal" },
  { code: "WEEKLY_GOAL", label: "Weekly goal" },
  { code: "TASK", label: "Task" },
  { code: "WEEKLY_REPORT", label: "Weekly report" },
] as const;
export type LinkType = (typeof LINK_TYPES)[number]["code"];
export const linkTypeLabel = (code: string) => LINK_TYPES.find((l) => l.code === code)?.label ?? code;

export const PARTICIPANT_ROLES = ["PRESENTER", "BU_LEAD", "ATTENDEE", "OBSERVER"] as const;

/** An action carried into three or more sessions is flagged as repeatedly carried forward. */
export const REPEATED_CARRY_THRESHOLD = 3;

/** How quickly an unsaved edit is sent to the server, and how often a failed save is retried. */
export const AUTOSAVE_DELAY_MS = 1500;
export const AUTOSAVE_RETRY_MS = [2000, 5000, 15000];
