// Shapes returned by the read_okr_* functions (client-safe types; the database is the authority).

export interface LinkRef { id: string; target_type: string; target_id: string; label: string; business_unit_id: string | null }

export interface SessionHeader {
  id: string; reference: string; title: string; status: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "ARCHIVED"; version: number;
  session_type_id: string; type_name: string; type_code: string;
  session_date: string; starts_at: string | null; ends_at: string | null;
  business_unit_id: string | null; business_unit_name: string | null;
  quarter_id: string | null; quarter_label: string | null; quarter_status: string | null;
  reporting_week_id: string | null;
  week: { id: string; week_number: number; week_year: number; week_start_at: string; status: string; reporting_state: string } | null;
  attendance_session: { id: string; session_date: string; outcome: string } | null;
  governance_session_id: string | null;
  facilitator_id: string; facilitator_name: string | null; created_by: string; created_by_name: string | null;
  description: string | null; agenda: string | null;
  completed_at: string | null; completed_by_name: string | null; archived_at: string | null; archived_from: string | null;
  created_at: string; updated_at: string;
}

export interface Participant { user_id: string; name: string | null; role: string; removed_at: string | null }

export interface NoteRow {
  id: string; session_id: string; category: string; title: string | null; content: string; visibility: "SHARED" | "MANAGEMENT" | "CONFIDENTIAL";
  author_id: string; author_name: string | null; last_edited_by: string; last_edited_by_name: string | null;
  version: number; status: "ACTIVE" | "ARCHIVED"; archived_at: string | null; archive_reason: string | null;
  noted_at: string; created_at: string; updated_at: string; links: LinkRef[]; attachments: number; versions: number;
}

export interface DecisionRow {
  id: string; reference: string; session_id: string; session_reference: string; title: string; description: string; background: string | null; justification: string | null;
  decision_date: string; status: "PROPOSED" | "APPROVED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN"; decided_by: string | null; decided_by_name: string | null; decided_at: string | null;
  authority_note: string | null; involved: (string | null)[]; affected_bu_id: string | null; affected_bu_name: string | null; expected_outcome: string | null; follow_up: string | null;
  superseded_by_reference: string | null; supersedes_reference: string | null; status_reason: string | null; version: number; created_by: string; created_by_name: string | null;
  created_at: string; links: LinkRef[]; attachments: number;
}

export interface ActionRow {
  id: string; reference: string; origin_session_id: string; origin_session_reference: string; description: string; business_unit_id: string; business_unit_name: string | null;
  assignee_id: string; assignee_name: string | null; created_by: string; created_by_name: string | null; priority: string; assigned_at: string; due_date: string; original_due_date: string; extensions: number;
  status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED"; progress_note: string | null; blocked_reason: string | null;
  completed_at: string | null; completed_by_name: string | null; completion_remarks: string | null;
  requires_verification: boolean; evidence_required: boolean; verification_status: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REJECTED";
  escalated_at: string | null; escalation_reason: string | null; version: number;
  overdue: boolean; due_soon: boolean; reviews: number; assignee_unavailable: boolean; links: LinkRef[]; attachments: number; source_note_id: string | null; source_decision_id: string | null;
}

export interface RiskRow {
  id: string; reference: string; session_id: string; session_reference: string; kind: "RISK" | "BLOCKER" | "ISSUE"; title: string; description: string;
  business_unit_id: string; business_unit_name: string | null; category: string; severity: string; business_impact: string | null; root_cause: string | null; mitigation: string | null;
  owner_id: string | null; owner_name: string | null; target_date: string | null; status: "OPEN" | "MITIGATING" | "RESOLVED" | "CLOSED"; resolution_note: string | null;
  overdue: boolean; reviews: number; raised_in_sessions: number; version: number; created_by_name: string | null; created_at: string; links: LinkRef[];
}

export interface MinutesRow {
  id: string; session_id: string; revision: number; status: "DRAFT" | "SUBMITTED" | "REVIEWED" | "FINALISED"; audience: "PARTICIPANTS" | "MANAGEMENT"; content: string;
  ai_drafted: boolean; ai_model: string | null; amends_revision: number | null; content_hash: string | null; version: number;
  created_by_name: string | null; created_at: string; submitted_by_name: string | null; submitted_at: string | null;
  reviewed_by_name: string | null; reviewed_at: string | null; review_remarks: string | null; finalised_by_name: string | null; finalised_at: string | null;
}

export interface CarryRow { item_type: "ACTION" | "RISK"; item_id: string; outcome: string; remarks: string | null; reviewed_by_name: string | null; reviewed_at: string; record: ActionRow | RiskRow | null }
export interface AttachmentRow { id: string; record_type: string; record_id: string; purpose: string; file_name: string; mime_type: string; size_bytes: number; uploaded_by_name: string | null; uploaded_at: string }
export interface EventRow { seq: number; record_type: string; record_id: string | null; event_type: string; actor_name: string | null; details: Record<string, unknown> | null; remarks: string | null; occurred_at: string }

export interface Workspace {
  session: SessionHeader;
  viewer: { id: string; is_facilitator: boolean; is_creator: boolean };
  participants: Participant[];
  notes: NoteRow[];
  decisions: DecisionRow[];
  actions: ActionRow[];
  risks: RiskRow[];
  reviewed_here: CarryRow[];
  minutes: MinutesRow[];
  attachments: AttachmentRow[];
  events: EventRow[];
}

export interface Outstanding { actions: ActionRow[]; risks: RiskRow[] }

export interface SessionSummary {
  id: string; reference: string; title: string; status: string; session_date: string; type_name: string; business_unit_id: string | null; business_unit_name: string | null;
  facilitator_name: string | null; quarter_label: string | null; week_number: number | null; week_year: number | null; reporting_week_id: string | null;
  notes: number; decisions: number; open_actions: number; risks: number; minutes_status: string | null; snippets: string[];
}

export interface Dashboard {
  sessions_total: number; sessions_by_status: Record<string, number>; sessions_by_bu: { business_unit_id: string | null; name: string; sessions: number }[];
  sessions_by_quarter: { quarter_id: string; label: string; sessions: number }[];
  sessions_by_week: { week_id: string; label: string; quarter: string; sessions: number }[]; sessions_without_week: number; awaiting_finalisation: number;
  decisions_total: number; decisions_by_status: Record<string, number>;
  actions_total: number; actions_by_status: Record<string, number>; actions_outstanding: number; actions_overdue: number; actions_due_soon: number; actions_blocked: number;
  actions_awaiting_verification: number; actions_carried: number; actions_repeatedly_carried: ActionRow[]; completion_rate: number | null;
  risks_open: number; risks_by_severity: Record<string, number>; risks_overdue: number;
  repeated_issues: { title: string; business_unit_id: string; business_unit_name: string | null; sessions: number; unresolved: number }[];
}

export interface LinkOption { type: string; id: string; label: string; key_result_id?: string; goal_id?: string }
export interface LinkOptions {
  theme: LinkOption | null; quarter: LinkOption | null; objective: LinkOption | null; key_results: LinkOption[]; sub_key_results: LinkOption[]; bu_goals: LinkOption[];
  weekly_report: LinkOption | null; weekly_goals: LinkOption[]; tasks: LinkOption[];
}

export interface Person { id: string; name: string; business_unit_id: string; business_unit_name: string; can_view_sessions: boolean }
