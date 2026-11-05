import "server-only";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";
import type { ActionRow, DecisionRow, Dashboard, LinkOptions, MinutesRow, NoteRow, Outstanding, Person, RiskRow, SessionSummary, Workspace } from "@/lib/session-notes/types";

// Read models of the OKR Session Notes module. Every call runs as the signed-in person (their own row-level security decides what comes back).

async function read<T>(fn: string, args: Record<string, unknown>, what: string): Promise<T> {
  const sb = await userClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw dbError(error, what);
  return data as T;
}

export interface SessionFilters {
  q?: string; bu?: string; quarter?: string; week?: string; from?: string; to?: string; type?: string; facilitator?: string; participant?: string; status?: string;
  noteCategory?: string; decisionStatus?: string; actionStatus?: string; linkType?: string; linkId?: string; limit?: number; offset?: number;
}

export const searchSessions = (f: SessionFilters = {}) =>
  read<{ total: number; rows: SessionSummary[] }>("read_okr_session_search", {
    p_q: f.q || null, p_bu: f.bu || null, p_quarter: f.quarter || null, p_week: f.week || null, p_from: f.from || null, p_to: f.to || null, p_type: f.type || null,
    p_facilitator: f.facilitator || null, p_participant: f.participant || null, p_status: f.status || null, p_note_category: f.noteCategory || null,
    p_decision_status: f.decisionStatus || null, p_action_status: f.actionStatus || null, p_link_type: f.linkType || null, p_link_id: f.linkId || null,
    p_limit: f.limit ?? 25, p_offset: f.offset ?? 0,
  }, "sessions");

export const getWorkspace = (id: string) => read<Workspace | null>("read_okr_session", { p_session: id }, "session");
export const getOutstanding = (id: string) => read<Outstanding | null>("read_okr_outstanding", { p_session: id }, "outstanding items");
export const getNoteVersions = (noteId: string) => read<unknown[]>("read_okr_note_versions", { p_note: noteId }, "note versions");
export const getMinutes = (id: string) => read<(MinutesRow & { snapshot: unknown; session_reference: string }) | null>("read_okr_minutes", { p_minutes: id }, "minutes");
export const getDashboard = (f: { quarter?: string; bu?: string; from?: string; to?: string } = {}) =>
  read<Dashboard>("read_okr_dashboard", { p_quarter: f.quarter || null, p_bu: f.bu || null, p_from: f.from || null, p_to: f.to || null }, "dashboard");
export const getLinkOptions = (bu: string, week: string | null) => read<LinkOptions>("read_okr_link_options", { p_bu: bu, p_week: week }, "link options");
export const getPeople = () => read<Person[]>("read_okr_people", {}, "people");

export const listDecisions = (f: { bu?: string; quarter?: string; status?: string; from?: string; to?: string; limit?: number } = {}) =>
  read<DecisionRow[]>("read_okr_decisions", { p_bu: f.bu || null, p_quarter: f.quarter || null, p_status: f.status || null, p_from: f.from || null, p_to: f.to || null, p_limit: f.limit ?? 200 }, "decisions");
export const listActions = (f: { bu?: string; quarter?: string; status?: string; assignee?: string; overdue?: boolean; from?: string; to?: string; limit?: number } = {}) =>
  read<ActionRow[]>("read_okr_actions", { p_bu: f.bu || null, p_quarter: f.quarter || null, p_status: f.status || null, p_assignee: f.assignee || null, p_overdue: f.overdue ?? false, p_from: f.from || null, p_to: f.to || null, p_limit: f.limit ?? 200 }, "actions");
export const listRisks = (f: { bu?: string; quarter?: string; status?: string; severity?: string; openOnly?: boolean; limit?: number } = {}) =>
  read<RiskRow[]>("read_okr_risks", { p_bu: f.bu || null, p_quarter: f.quarter || null, p_status: f.status || null, p_severity: f.severity || null, p_open_only: f.openOnly ?? false, p_limit: f.limit ?? 200 }, "risks");

export async function listSessionTypes(): Promise<{ id: string; code: string; name: string; description: string | null; sort_order: number; active: boolean }[]> {
  const sb = await userClient();
  const { data, error } = await sb.from("okr_session_types").select("id, code, name, description, sort_order, active").order("sort_order").order("name");
  if (error) throw dbError(error, "session types");
  return data ?? [];
}

export async function listAttachmentsOf(sessionId: string) {
  const sb = await userClient();
  const { data, error } = await sb.from("okr_session_attachments").select("id, file_name, mime_type, size_bytes, storage_path, record_type, record_id, deleted_at").eq("session_id", sessionId).is("deleted_at", null);
  if (error) throw dbError(error, "attachments");
  return data ?? [];
}

export type { NoteRow };
