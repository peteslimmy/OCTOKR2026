// Stable machine-readable error codes (12-API-CONTRACT) mapped to HTTP status and safe user copy.
export interface DomainError {
  code: string;
  status: number;
  message: string;
  details?: unknown;
}

const MAP: Record<string, { status: number; message: string }> = {
  AUTHENTICATION_REQUIRED: { status: 401, message: "Please sign in to continue." },
  PERMISSION_DENIED: { status: 403, message: "You do not have permission to do this." },
  BU_SCOPE_DENIED: { status: 403, message: "This record belongs to another Business Unit." },
  REPORT_CONTENT_LOCKED: { status: 409, message: "Content Locked — goal and task definitions can no longer be changed." },
  REPORT_FINAL_LOCKED: { status: 409, message: "Report Finalized — the historical record is immutable." },
  GOAL_MINIMUM_REQUIRED: { status: 422, message: "Add at least one SMART Goal before submitting your report." },
  GOAL_SUB_KR_REQUIRED: { status: 422, message: "Choose a Sub-KR, or classify the goal as Stretch." },
  GOAL_SUB_KR_INVALID: { status: 422, message: "That Sub-KR does not belong to this report's quarter." },
  GOAL_TASK_REQUIRED: { status: 422, message: "Every goal needs at least one task." },
  SUBMISSION_BLOCKED: { status: 422, message: "The report cannot be submitted yet." },
  SKIPPED_SUMMARY_REQUIRED: { status: 422, message: "A performance summary is required for a skipped OKR week." },
  INVALID_STATE_TRANSITION: { status: 409, message: "That status change is not allowed." },
  EXECUTION_NOT_OPEN: { status: 409, message: "Task status can be set only after the content lock." },
  INTEGRITY_REASON_REQUIRED: { status: 422, message: "A reason is required for every integrity correction." },
  PENALTY_DECISION_REQUIRED: { status: 422, message: "Choose whether to apply or waive the penalty." },
  WAIVER_REASON_REQUIRED: { status: 422, message: "A reason is required to waive the penalty." },
  PENALTY_CONFIG_MISSING: {
    status: 409,
    message: "No penalty rate is configured yet. Ask an Admin to configure it, or waive the penalty.",
  },
  CORRECTION_NOT_AVAILABLE: { status: 409, message: "Integrity corrections apply only after content lock." },
  QUARTER_LOCKED: { status: 409, message: "This quarter is locked and read-only." },
  QUARTER_NOT_ACTIVE: { status: 409, message: "The quarter for this week is not active yet." },
  QUARTER_NOT_READY: { status: 422, message: "The quarter is incomplete and cannot be activated." },
  KR_LIMIT_EXCEEDED: { status: 422, message: "A quarter may contain at most 4 key results." },
  REPORTING_NOT_REQUIRED: { status: 409, message: "This week is an organisation holiday — no report is required." },
  REPORTING_WEEK_NOT_OPEN: { status: 409, message: "This reporting week has not opened yet." },
  EDIT_LEASE_REQUIRED: { status: 409, message: "Start an editing session before changing this report." },
  EDIT_LEASE_CONFLICT: { status: 409, message: "Another BU Lead is currently editing this report." },
  CONCURRENT_UPDATE: { status: 409, message: "This report changed since you loaded it. Reload to continue." },
  REASON_REQUIRED: { status: 422, message: "A reason is required." },
  VALIDATION_ERROR: { status: 422, message: "Some of the information provided is not valid." },
  HOLIDAY_AMENDMENT_REQUIRED: {
    status: 409,
    message: "This week already has submitted reports or is locked. An Admin can apply the holiday through the controlled amendment (Administration → Organization Holiday).",
  },
  SMART_EVAL_PERSIST_FAILED: {
    status: 500,
    message: "The goal could not be saved with its SMART evaluation. Nothing was changed.",
  },
  NOT_FOUND: { status: 404, message: "That record was not found." },
  ATTENDANCE_AMENDMENT_REASON_REQUIRED: { status: 422, message: "A reason is required for every attendance amendment request." },
  ATTENDANCE_AMENDMENT_SELF_APPROVAL: { status: 403, message: "You cannot decide an amendment request you submitted." },
  ATTENDANCE_AMENDMENT_STALE: { status: 409, message: "The attendance record changed after this request was made. It was not applied; submit a new request." },
  ATTENDANCE_AMENDMENT_ALREADY_PENDING: { status: 409, message: "This attendance record already has a pending amendment request." },
  ATTENDANCE_SESSION_NOT_AMENDABLE: { status: 409, message: "Only finalised, held-session attendance can be amended; skipped-week rows are not individually amendable." },
  ATTENDANCE_SESSION_NOT_SKIPPABLE: { status: 409, message: "This session already has a finalised roster and cannot be skipped." },
  ATTENDANCE_SESSION_SKIPPED: { status: 409, message: "This OKR session was skipped; its roster is read-only." },
  VIOLATION_NOT_ALLOWED_SKIPPED_SESSION: { status: 409, message: "A skipped OKR session cannot generate an absence violation." },
  VIOLATION_ALREADY_SETTLED: { status: 409, message: "This violation has already been settled." },
  DUPLICATE_PAYMENT: { status: 409, message: "That payment reference has already been used." },
  DISBURSEMENT_SELF_APPROVAL: { status: 403, message: "You cannot approve or release a request you created." },
  DISBURSEMENT_REJECTION_REASON_REQUIRED: { status: 422, message: "A justification is required to reject a disbursement request." },
  INSUFFICIENT_FUNDS: { status: 409, message: "The available fund balance is not sufficient for this amount." },
  FINAL_LOCK_PENDING: { status: 409, message: "That week is still being finalised. Try again in a moment." },
  LATE_EXCEPTION_NOT_APPLICABLE: { status: 409, message: "A late report can be authorised only for a finalised week in which the Business Unit filed no report." },
  LATE_EXCEPTION_ALREADY_EXISTS: { status: 409, message: "A late-report exception already exists for this Business Unit and week." },
  LATE_REPORT_NOT_REVIEWED: { status: 409, message: "The late report must be submitted and reviewed before the score can be amended." },
  LATE_AMENDMENT_SEGREGATION: { status: 403, message: "The person who reviewed the late report cannot also apply the score amendment." },
  LATE_EXCEPTION_PENDING: { status: 409, message: "A late-report exception is open for this week. Resolve it before changing the holiday state." },
  REPORT_NOT_FOUND: { status: 404, message: "That report does not exist." },
  REPORT_NOT_AVAILABLE: { status: 403, message: "You do not have access to this report." },
  EXPORT_TOO_LARGE: { status: 413, message: "This report has too many rows to export. Narrow the period or Business Unit." },
  SNAPSHOT_SCOPE: { status: 409, message: "Official snapshots are organisation-wide. This report cannot be snapshotted for your scope." },
  ALREADY_BOOTSTRAPPED: { status: 409, message: "The organisation has already been set up." },
  ORGANISATION_NOT_CONFIGURED: { status: 409, message: "The organisation has not been set up yet." },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Please wait and try again." },
  AUTHENTICATION_FAILED: { status: 401, message: "Invalid email or password." },
  IMMUTABLE_RECORD: { status: 409, message: "This record is immutable." },
  IDEMPOTENCY_KEY_REUSED: { status: 409, message: "That request key was already used for a different action." },
  REPORT_NOT_FINALISED: { status: 409, message: "Reports can be reviewed only after final lock." },
  TWO_PERSON_APPROVAL_REQUIRED: { status: 409, message: "This week is closed. Request the amendment; a different Admin must approve it." },
  HOLIDAY_REQUEST_NOT_NEEDED: { status: 409, message: "This week is not closed, so it can be amended directly without a second approval." },
  HOLIDAY_REQUEST_PENDING: { status: 409, message: "A request for this week is already waiting for a decision." },
  HOLIDAY_REQUEST_NOT_PENDING: { status: 409, message: "That request has already been decided." },
  HOLIDAY_REQUEST_SELF_APPROVAL: { status: 403, message: "You cannot decide a request you made. Another Admin must." },
  LEDGER_ENTRY_NOT_REVERSIBLE: { status: 409, message: "A reversal entry cannot itself be reversed." },
  LEDGER_ENTRY_ALREADY_REVERSED: { status: 409, message: "This ledger entry has already been reversed." },
  LEDGER_REVERSAL_PENDING: { status: 409, message: "A reversal for this entry is already waiting to be decided or posted." },
  LEDGER_REVERSAL_SELF_APPROVAL: { status: 403, message: "You cannot approve or post a reversal you requested." },
  LEDGER_REVERSAL_NOT_PENDING: { status: 409, message: "That reversal request has already been decided." },
  LEDGER_REVERSAL_NOT_APPROVED: { status: 409, message: "That reversal has not been approved, or has already been posted." },
  SESSION_NOT_CORRECTABLE: { status: 409, message: "This session has no recorded outcome to correct." },
  SESSION_CORRECTION_BLOCKED: { status: 409, message: "Attendance amendments refer to this roster, so it cannot be reopened. Their history cannot be detached from it." },
  SESSION_CORRECTION_PENDING: { status: 409, message: "A correction for this session is already waiting to be decided or executed." },
  SESSION_CORRECTION_NOT_PENDING: { status: 409, message: "That correction request has already been decided." },
  SESSION_CORRECTION_SELF_APPROVAL: { status: 403, message: "You cannot approve or execute a correction you requested." },
  SESSION_CORRECTION_NOT_APPROVED: { status: 409, message: "That correction has not been approved, or has already been executed." },
  STRATEGY_CHANGE_REQUIRED: { status: 409, message: "This quarter is active, so its strategy is a controlled baseline. Ask for the change; a different person must approve it." },
  STRATEGY_CHANGE_NOT_NEEDED: { status: 409, message: "This quarter is still in draft, so it can be edited directly." },
  STRATEGY_CHANGE_PENDING: { status: 409, message: "A change to this item is already waiting for a decision." },
  STRATEGY_CHANGE_NOT_PENDING: { status: 409, message: "That change request has already been decided." },
  STRATEGY_CHANGE_SELF_APPROVAL: { status: 403, message: "You cannot approve a change you requested." },
  CONFIG_CHANGE_PENDING: { status: 409, message: "A change to this setting is already waiting for a decision." },
  CONFIG_CHANGE_NOT_PENDING: { status: 409, message: "That change request has already been decided or withdrawn." },
  CONFIG_CHANGE_SELF_APPROVAL: { status: 403, message: "You cannot approve a change you requested. Someone else must." },
  ROLE_CONFLICT: { status: 409, message: "That would put two permissions on one role that must be held by different people (for example asking for money and approving it)." },
  ROLE_LOCKOUT: { status: 409, message: "That would leave nobody able to manage roles. Keep at least one role with that permission and one holder." },
  ROLE_RESERVED: { status: 409, message: "A reserved permission can only be held by a role that can manage roles (the Super Admin tier)." },
  HISTORY_ALREADY_IMPORTED: { status: 409, message: "This exact file has already been imported." },
  HISTORY_BATCH_STATE: { status: 409, message: "The file is not in the right step for that. Read it again." },
  HISTORY_HAS_ISSUES: { status: 422, message: "Some rows cannot be loaded. Fix the file and read it again. Nothing was changed." },
  STRATEGY_ITEM_RETIRED: { status: 409, message: "That item has been retired and cannot be changed or extended." },
  STRATEGY_BELOW_MINIMUM: { status: 409, message: "That would leave the quarter incomplete: it needs at least 3 active key results, each with an active Sub-KR." },
  IMPORT_INVALID: { status: 422, message: "The import contains rows that are not valid. Nothing was changed." },
  IMPORT_TOO_LARGE: { status: 413, message: "That file is too large to import." },
  ANNUAL_THEME_EXISTS: { status: 409, message: "An annual theme already exists for that year." },
  OBJECTIVE_EXISTS: { status: 409, message: "This quarter already has an objective." },
  QUARTER_NOT_FOUND: { status: 409, message: "No quarter covers that date." },
};

/** Convert a PostgREST/Postgres error (message = code) into a safe domain error. Never leaks raw SQL. */
export function toDomainError(
  err: { message?: string; details?: string | null; code?: string } | null | undefined,
): DomainError {
  const raw = (err?.message ?? "").trim();
  const code = raw.split(/[\s:]/)[0];
  const known = MAP[code];
  if (known) {
    let details: unknown = err?.details ?? undefined;
    if (typeof details === "string" && details.startsWith("[")) {
      try {
        details = JSON.parse(details);
      } catch {
        /* keep string */
      }
    }
    return { code, status: known.status, message: known.message, details };
  }
  if (err?.code === "23505") return { code: "CONFLICT", status: 409, message: "That record already exists." };
  if (err?.code === "23514" || err?.code === "23502" || err?.code === "22P02") {
    return { code: "VALIDATION_ERROR", status: 422, message: MAP.VALIDATION_ERROR.message };
  }
  return { code: "INTERNAL_ERROR", status: 500, message: "Something went wrong on our side. Nothing was changed; please try again." };
}
