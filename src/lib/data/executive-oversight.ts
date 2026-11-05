import "server-only";
import { dbError } from "@/lib/data/errors";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";
import type { EoCategory, EoCommentThread, EoComment, EoContext, EoDashboard, EoPerson, EoRecFull, EoRecLine, EoRule, LinkOption } from "@/lib/executive-oversight/types";

// Read models of the Executive Oversight module. Every call runs as the signed-in person: their own row-level security decides what comes back.

async function read<T>(fn: string, args: Record<string, unknown>, what: string): Promise<T> {
  const sb = await userClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw dbError(error, what);
  return data as T;
}

export interface CommentFilters {
  q?: string; bu?: string; quarter?: string; week?: string; from?: string; to?: string; category?: string; module?: string; author?: string; subjectType?: string; subjectId?: string; status?: string; limit?: number; offset?: number;
}
export interface RecFilters {
  q?: string; bu?: string; quarter?: string; week?: string; from?: string; to?: string; priority?: string; status?: string; author?: string; category?: string; module?: string; overdue?: boolean; awaiting?: string;
  dueFrom?: string; dueTo?: string; subjectType?: string; subjectId?: string; sort?: string; limit?: number; offset?: number;
}

export const searchComments = (f: CommentFilters = {}) =>
  read<{ total: number; rows: EoComment[] }>("read_eo_comments", {
    p_q: f.q || null, p_bu: f.bu || null, p_quarter: f.quarter || null, p_week: f.week || null, p_from: f.from || null, p_to: f.to || null, p_category: f.category || null, p_module: f.module || null,
    p_author: f.author || null, p_subject_type: f.subjectType || null, p_subject_id: f.subjectId || null, p_status: f.status || null, p_limit: f.limit ?? 25, p_offset: f.offset ?? 0,
  }, "comments");

export const searchRecommendations = (f: RecFilters = {}) =>
  read<{ total: number; rows: EoRecLine[] }>("read_eo_recommendations", {
    p_q: f.q || null, p_bu: f.bu || null, p_quarter: f.quarter || null, p_week: f.week || null, p_from: f.from || null, p_to: f.to || null, p_priority: f.priority || null, p_status: f.status || null,
    p_author: f.author || null, p_category: f.category || null, p_module: f.module || null, p_overdue: f.overdue ? true : null, p_awaiting: f.awaiting || null, p_due_from: f.dueFrom || null, p_due_to: f.dueTo || null,
    p_subject_type: f.subjectType || null, p_subject_id: f.subjectId || null, p_sort: f.sort || null, p_limit: f.limit ?? 25, p_offset: f.offset ?? 0,
  }, "recommendations");

export const getComment = (id: string) => read<EoCommentThread | null>("read_eo_comment", { p_id: id }, "comment");
export const getRecommendation = (id: string) => read<EoRecFull | null>("read_eo_recommendation", { p_id: id }, "recommendation");
export const getDashboard = (f: { bu?: string; quarter?: string; from?: string; to?: string } = {}) =>
  read<EoDashboard>("read_eo_dashboard", { p_bu: f.bu || null, p_quarter: f.quarter || null, p_from: f.from || null, p_to: f.to || null }, "dashboard");
export const getContext = (f: { subjectType?: string | null; subjectId?: string | null; bu?: string | null; module?: string | null }) =>
  read<EoContext>("read_eo_context", { p_subject_type: f.subjectType || null, p_subject_id: f.subjectId || null, p_bu: f.bu || null, p_module: f.module || null }, "commentary");
export const getLinkOptions = (bu: string, week: string | null) => read<Record<string, unknown>>("read_eo_link_options", { p_bu: bu, p_week: week }, "link options");

/** Flattens the picker payload into labelled groups. */
export function groupLinkOptions(o: Record<string, unknown>): { group: string; options: LinkOption[] }[] {
  const one = (k: string): LinkOption[] => (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? [o[k] as LinkOption] : []);
  const many = (k: string): LinkOption[] => (Array.isArray(o[k]) ? (o[k] as LinkOption[]) : []);
  return [
    { group: "Sessions", options: many("sessions") }, { group: "Session notes", options: many("notes") }, { group: "Decisions", options: many("decisions") },
    { group: "Actions", options: many("actions") }, { group: "Risks and blockers", options: many("risks") },
    { group: "Theme and quarter", options: [...one("theme"), ...one("quarter"), ...one("objective")] }, { group: "Key results", options: many("key_results") }, { group: "Sub-KRs", options: many("sub_key_results") },
    { group: "Unit goals", options: many("bu_goals") }, { group: "Weekly report", options: one("weekly_report") }, { group: "Weekly goals", options: many("weekly_goals") }, { group: "Tasks", options: many("tasks") },
  ].filter((g) => g.options.length > 0);
}

/** People of a unit (names only). Needs the service role because staff records are not readable by every signed-in person; the function checks the caller's own rights. */
export async function listPeople(actorId: string, bu: string): Promise<EoPerson[]> {
  const { data, error } = await adminClient().rpc("list_eo_people", { p_actor: actorId, p_bu: bu });
  if (error) throw dbError(error, "people");
  return (data ?? []) as EoPerson[];
}

export async function listCategories(): Promise<EoCategory[]> {
  const sb = await userClient();
  const { data, error } = await sb.from("eo_categories").select("id, code, name, description, sort_order, active").order("sort_order").order("name");
  if (error) throw dbError(error, "categories");
  return data ?? [];
}
export async function listRules(): Promise<EoRule[]> {
  const sb = await userClient();
  const { data, error } = await sb.from("eo_escalation_rules").select("stage, days, recipient_kind, role_code, active");
  if (error) throw dbError(error, "escalation rules");
  const order = ["APPROACHING", "OVERDUE_REMINDER", "OVERDUE_MANAGEMENT", "OVERDUE_SENIOR"];
  return (data ?? []).sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
}
