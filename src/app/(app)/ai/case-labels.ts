export const SEVERITY: Record<string, "critical" | "warn" | "info" | "done"> = { CRITICAL: "critical", HIGH: "critical", MEDIUM: "warn", LOW: "info" };
export const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open", UNDER_INVESTIGATION: "Under investigation", AWAITING_RESPONSE: "Awaiting response", INTERVENTION_REQUIRED: "Intervention required",
  CORRECTIVE_ACTION_IN_PROGRESS: "Corrective action in progress", ESCALATED: "Escalated", RESOLVED: "Resolved", CLOSED: "Closed",
};
export const CATEGORY_LABEL: Record<string, string> = {
  MISSED_COMMITMENTS: "Missed commitments", REPEATED_DELAYS: "Repeated activity delays", UNDERPERFORMING_KR: "Underperforming KR", UNDERPERFORMING_BU: "Underperforming unit",
  REPORTING_NON_COMPLIANCE: "Reporting non-compliance", CROSS_BU_DEPENDENCY: "Cross-unit dependency", RESOURCE_CONSTRAINT: "Resource constraint",
  STRATEGIC_OBJECTIVE_AT_RISK: "Strategic objective at risk", INACTIVE_ACTIVITY: "Inactive activity", OTHER: "Other",
};
export const EVENT_LABEL: Record<string, string> = { CREATED: "Opened", COMMUNICATION: "Unit asked", RESPONSE: "Unit responded", APPROVAL: "Approval", ESCALATION: "Escalated to executives", STATUS_CHANGE: "Status changed", ACTION: "Action", NOTE: "Note" };
