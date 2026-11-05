// Shapes returned by the read functions of migration 20261106000003 (jsonb).

export interface EoComment {
  id: string; reference: string; title: string | null; summary: string; content: string; category_code: string | null; category: string | null;
  author_id: string; author_name: string; author_role: string; business_unit_id: string | null; business_unit_name: string; module: string;
  subject_type: string | null; subject_id: string | null; subject_label: string | null; quarter_id: string | null; quarter: string | null; reporting_week_id: string | null; week: string | null;
  visibility: "SHARED" | "MANAGEMENT"; status: "PUBLISHED" | "WITHDRAWN"; version: number; created_at: string; amended_at: string | null; last_activity_at: string; withdrawn_reason: string | null;
  replies: number; attachments: number; links: number;
}

export interface EoLink { id: string; target_type: string; target_id: string; label: string; target_bu_id: string | null; added_by?: string }
export interface EoAttachment { id: string; file_name: string; mime_type: string; size_bytes: number; uploaded_by: string; uploaded_by_id: string; uploaded_at: string; target_id?: string | null }
export interface EoEvent {
  id: string; seq: number; target_id?: string | null; target_unit?: string | null; event_type: string; actor_id: string | null; actor_name: string | null; actor_role: string | null;
  body: string | null; details: Record<string, unknown> | null; occurred_at: string;
}
export interface EoCommentVersion { version: number; title: string | null; content: string; category: string | null; saved_at: string; replaced_at: string; replaced_by: string; change_kind: string; reason: string }
export type EoCommentThread = Omit<EoComment, "links" | "attachments"> & { versions: EoCommentVersion[]; events: EoEvent[]; links: EoLink[]; attachments: EoAttachment[] };

/** One line of the recommendation register: a recommendation as it stands with one addressed unit. */
export interface EoRecLine {
  id: string; target_id: string; reference: string | null; title: string; priority: string; rec_status: string; status: string; awaiting: "BU" | "EXECUTIVE" | null; decision: string | null; overdue: boolean;
  category_code: string | null; category: string | null; author_id: string; author_name: string; author_role: string; business_unit_id: string; business_unit_name: string; module: string;
  subject_type: string | null; subject_id: string | null; subject_label: string | null; quarter_id: string | null; quarter: string | null; reporting_week_id: string | null; week: string | null;
  issued_at: string; response_requested: boolean; response_due: string | null; responsible_user_id: string | null; responsible_name: string | null; responsible_unavailable: boolean;
  escalation_level: number; closed_without_response: boolean; version: number; target_version: number; last_activity_at: string;
  latest_update: { event_type: string; occurred_at: string; actor_name: string | null; excerpt: string } | null; attachments: number; links: number;
}
export interface EoTarget extends EoRecLine { acknowledged_at: string | null; acknowledged_by: string | null; responded_at: string | null; closed_at: string | null; closed_by: string | null; close_reason: string | null; business_unit_active: boolean }
export interface EoRecFull {
  id: string; reference: string | null; title: string; detail: string; background: string | null; reason: string | null; expected_outcome: string | null; proposed_direction: string | null; priority: string; status: string; version: number;
  category_code: string | null; category: string | null; author_id: string; author_name: string; author_role: string; author_active: boolean; module: string;
  subject_type: string | null; subject_id: string | null; subject_label: string | null; quarter_id: string | null; quarter: string | null; reporting_week_id: string | null; week: string | null;
  recommended_owner_role: string | null; recommended_owner_user: string | null; recommended_owner_name: string | null; response_requested: boolean; response_due: string | null;
  created_at: string; published_at: string | null; withdrawn_at: string | null; withdrawn_reason: string | null;
  targets: EoTarget[]; events: EoEvent[]; links: EoLink[]; attachments: EoAttachment[];
}

export interface EoDashboard {
  comments_total: number; comments_by_category: { category: string; count: number }[]; recommendations_total: number; recommendation_units_total: number;
  awaiting_acknowledgement: number; awaiting_response: number; awaiting_executive: number; overdue: number; accepted_for_action: number; declined: number; under_implementation: number;
  implementation_reported: number; closed: number; withdrawn: number; by_status: Record<string, number>; by_priority: Record<string, number>;
  by_unit: { business_unit_id: string; name: string; open: number; overdue: number; total: number }[]; escalated: number; my_drafts: number;
  recent_comments: EoComment[]; recent_recommendations: EoRecLine[]; pending_responses: EoRecLine[]; overdue_list: EoRecLine[]; awaiting_executive_list: EoRecLine[];
}

export interface EoContext { comments: EoComment[]; recommendations: EoRecLine[] }
export interface LinkOption { type: string; id: string; label: string; session_id?: string }
export interface EoPerson { id: string; name: string; is_lead: boolean }
export interface EoCategory { id: string; code: string; name: string; description: string | null; sort_order: number; active: boolean }
export interface EoRule { stage: string; days: number; recipient_kind: string; role_code: string | null; active: boolean }
