import "server-only";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

// Governance and finance read models. All reads run under the caller's own RLS.

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw dbError(res.error, what);
  return res.data as T;
}

export interface RosterView {
  session: {
    id: string; reporting_week_id: string; session_date: string; outcome: "SCHEDULED" | "HELD" | "SKIPPED";
    roster_status: "NONE" | "DRAFT" | "FINALIZED"; outcome_at: string | null; staff_count: number | null;
    skip_operation_ref: string | null; skip_reason?: string | null; outcome_by_name: string | null;
  };
  week: { week_number: number; week_year: number; week_start_at: string; reporting_state: string };
  rows: {
    id: string; employee_id: string; name: string; email: string; business_unit: string; source_status: string; effective_status: string;
    notes: string | null; source: string; pending_request_id: string | null;
  }[];
  tally: Record<string, number>;
}

export async function getRoster(sessionId: string): Promise<RosterView | null> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_session_roster", { p_session_id: sessionId });
  if (error) throw dbError(error, "roster");
  return (data as RosterView | null) ?? null;
}

export async function listSessions(limit = 12) {
  const sb = await userClient();
  return unwrap(
    await sb.from("governance_sessions")
      .select("id, session_date, outcome, roster_status, roster_staff_count, reporting_week_id, reporting_weeks(week_number, week_year, week_start_at, reporting_state)")
      .order("session_date", { ascending: false }).limit(limit),
    "sessions",
  ) as unknown as {
    id: string; session_date: string; outcome: string; roster_status: string; roster_staff_count: number | null; reporting_week_id: string;
    reporting_weeks: { week_number: number; week_year: number; week_start_at: string; reporting_state: string };
  }[];
}

export async function sessionForWeek(weekId: string) {
  const sb = await userClient();
  const { data } = await sb.from("governance_sessions").select("id, outcome, roster_status, session_date").eq("reporting_week_id", weekId).maybeSingle();
  return data as { id: string; outcome: string; roster_status: string; session_date: string } | null;
}

export interface AmendmentRow {
  id: string; status: "PENDING" | "APPROVED" | "REJECTED"; requested_at: string; reason: string; evidence_refs: { ref?: string; note?: string }[];
  source_status: string; effective_status: string; proposed_status: string; requested_by: string; requester_name: string | null;
  decided_at: string | null; decision_reason: string | null; decider_name: string | null; employee_name: string | null; session_date: string | null;
  events: { type: string; at: string; reason: string | null; actor: string | null }[];
}

export async function listAmendments(status?: string): Promise<AmendmentRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_amendment_requests", { p_status: status ?? null });
  if (error) throw dbError(error, "amendments");
  return (data as AmendmentRow[]) ?? [];
}

export interface ViolationRow {
  id: string; employee_name: string; business_unit: string; type: string; type_code: string; criticality: string; fine_amount: number;
  status: "OPEN" | "PAID" | "DEDUCTION_RECORDED" | "VOID"; created_at: string; session_date: string | null; notes: string | null;
  override_reason: string | null; employee_email?: string | null; void_reason?: string | null; voided_at?: string | null; payment: { method: string; reference: string; paid_at: string; reversed?: boolean } | null; reversed_payments?: number;
  evidence_files?: EvidenceFileRow[];
}

export async function listViolations(): Promise<ViolationRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_violations");
  if (error) throw dbError(error, "violations");
  return (data as ViolationRow[]) ?? [];
}

export async function listViolationTypes() {
  const sb = await userClient();
  return unwrap(await sb.from("violation_types").select("id, code, name, criticality, default_fine, active").order("code"), "violation types") as
    { id: string; code: string; name: string; criticality: string; default_fine: number; active: boolean }[];
}

export async function listPaymentMethods() {
  const sb = await userClient();
  return unwrap(await sb.from("payment_methods").select("id, code, name, is_deduction, active").order("code"), "payment methods") as
    { id: string; code: string; name: string; is_deduction: boolean; active: boolean }[];
}

export async function listAllowedDomains() {
  const sb = await userClient();
  return unwrap(await sb.from("allowed_email_domains").select("domain, created_at").order("domain"), "email domains") as { domain: string; created_at: string }[];
}

export async function listActiveEmployees() {
  const sb = await userClient();
  // the reserve Super Admin account is not offered to anyone else
  const { data: hidden } = await sb.rpc("read_hidden_employee_ids");
  const skip = new Set((hidden as string[] | null) ?? []);
  const rows = unwrap(
    await sb.from("employees").select("id, first_name, last_name, email, business_unit_id, business_units(name)").eq("employment_status", "ACTIVE").order("last_name"),
    "employees",
  ) as unknown as { id: string; first_name: string; last_name: string; email: string; business_unit_id: string; business_units: { name: string } | null }[];
  return rows.filter((e) => !skip.has(e.id));
}

/** Individually designated permissions (e.g. a "designated HR approver"), keyed by user id. Visible to role managers only (RLS). */
export async function listPermissionGrants(): Promise<Record<string, string[]>> {
  const sb = await userClient();
  const rows = unwrap(await sb.from("user_permission_grants").select("user_id, permissions(code)"), "grants") as unknown as { user_id: string; permissions: { code: string } | null }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) if (r.permissions) (out[r.user_id] ??= []).push(r.permissions.code);
  return out;
}

export interface WeekQuote {
  id: string; speaker_name: string; quote: string; business_unit_id: string;
  status: "draft" | "submitted" | "approved" | "published" | "archived"; recorded_by: string; submitted_by: string | null;
}

export async function getWeekQuote(weekId: string): Promise<WeekQuote | null> {
  const sb = await userClient();
  const { data } = await sb.from("weekly_quotes").select("id, speaker_name, quote, business_unit_id, status, recorded_by, submitted_by").eq("reporting_week_id", weekId).maybeSingle();
  return data as WeekQuote | null;
}

export interface PublishedQuote { id: string; speaker_name: string; quote: string; business_unit: string; published_at: string }

export async function getPublishedQuote(weekId: string): Promise<PublishedQuote | null> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_published_quote", { p_week_id: weekId });
  if (error) throw dbError(error, "published quote");
  return (data as PublishedQuote | null) ?? null;
}

// ---------------------------------------------------------------- finance
export interface FundSummary {
  configured: boolean; currency?: string; balance: number; committed: number; available: number; inflow: number; outflow: number;
  pending_requests: number; approved_awaiting_disbursement?: number; reconciled: boolean;
  reconciliation?: { ledger_credits: number; recorded_payments: number; ledger_debits: number; recorded_disbursements: number };
}

export async function getFundSummary(): Promise<FundSummary> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_fund_summary");
  if (error) throw dbError(error, "fund");
  return data as FundSummary;
}

/** For dashboards shown to roles that may or may not see the fund: null when not permitted. */
export async function fundSummaryOrNull(): Promise<FundSummary | null> {
  try {
    return await getFundSummary();
  } catch {
    return null;
  }
}

export interface LedgerRow {
  id: string; entry_type: "CREDIT" | "DEBIT"; amount: number; source_type: string; reference: string; created_at: string; running_balance: number;
  reverses_entry_id: string | null; reversed: boolean; reversal_open: boolean;
}

export async function getLedger(limit = 100): Promise<LedgerRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_ledger", { p_limit: limit });
  if (error) throw dbError(error, "ledger");
  return (data as LedgerRow[]) ?? [];
}

export interface DisbursementRow {
  id: string; amount: number; purpose: string; justification: string; status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DISBURSED" | "WITHDRAWN";
  created_at: string; updated_at: string; requested_by: string; requester_name: string | null; requester_unit: string | null;
  resubmits: string | null; resubmit_note: string | null; resubmitted_as: string | null;
  decision: { decision: string; reason: string | null; at: string; by: string | null } | null; disbursement: { reference: string; at: string; amount: number; by: string | null } | null;
}

export async function listDisbursements(): Promise<DisbursementRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_disbursement_requests");
  if (error) throw dbError(error, "disbursements");
  return (data as DisbursementRow[]) ?? [];
}

export interface PurposeRow { id: string; name: string; active: boolean }
export async function listPurposes(): Promise<PurposeRow[]> {
  const sb = await userClient();
  return unwrap(await sb.from("disbursement_purposes").select("id, name, active").order("name"), "purposes") as PurposeRow[];
}

// ---------------------------------------------------------------- late-report score amendment (milestone 3)
export interface LateExceptionRow {
  id: string; status: "AUTHORISED" | "SUBMITTED" | "APPLIED" | "REVOKED"; reason: string; authorised_at: string; authorised_by: string;
  business_unit_id: string; business_unit: string; reporting_week_id: string; week_number: number; week_year: number; week_start_at: string;
  weekly_report_id: string | null; submitted_at: string | null; review_status: "NOT_REVIEWED" | "REVIEWED" | null; reviewed_by_id: string | null;
  applied_at: string | null; apply_reason: string | null; revoked_at: string | null; revoke_reason: string | null;
  amendment: { old_weekly_score: number; new_weekly_score: number; old_quarterly_score: number | null; new_quarterly_score: number | null; quarter_locked: boolean } | null;
  events: { type: string; at: string; reason: string | null; actor: string | null }[];
}
export interface LateCandidate {
  business_unit_id: string; business_unit: string; reporting_week_id: string; week_number: number; week_year: number; week_start_at: string; quarter_locked: boolean;
}

export async function listLateExceptions(): Promise<LateExceptionRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_late_report_exceptions");
  if (error) throw dbError(error, "late-report exceptions");
  return (data as LateExceptionRow[]) ?? [];
}

export async function listLateCandidates(): Promise<LateCandidate[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_late_report_candidates");
  if (error) throw dbError(error, "late-report candidates");
  return (data as LateCandidate[]) ?? [];
}

// ---------------------------------------------------------------- holiday amendment (milestone 3b)
export interface HolidayAmendmentRow {
  id: string; direction: "DECLARE" | "REVERSE"; reason: string; created_at: string; week_number: number; week_year: number; week_start_at: string; reporting_week_id: string;
  week_final_locked: boolean; quarter_locked: boolean; backfilled_zero_count: number; actor: string | null;
  impact: { business_unit: string; old_score: number | null; new_score: number | null; old_version: number | null; new_version: number }[];
}

export async function listHolidayAmendments(): Promise<HolidayAmendmentRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_holiday_amendments");
  if (error) throw dbError(error, "holiday amendments");
  return (data as HolidayAmendmentRow[]) ?? [];
}

export interface HolidayRequestRow {
  id: string; status: "PENDING" | "APPLIED" | "REJECTED"; direction: "DECLARE" | "REVERSE"; reason: string; created_at: string; decided_at: string | null;
  decision_comment: string | null; reporting_week_id: string; week_number: number; week_year: number; week_start_at: string;
  requested_by_id: string; requested_by: string | null; decided_by: string | null;
}

export async function listHolidayRequests(): Promise<HolidayRequestRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_holiday_amendment_requests");
  if (error) throw dbError(error, "holiday amendment requests");
  return (data as HolidayRequestRow[]) ?? [];
}

// ---------------------------------------------------------------- ledger reversal (ADR-059)
export interface LedgerReversalRow {
  id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED"; emergency: boolean; reason: string; created_at: string; decided_at: string | null; executed_at: string | null;
  decision_comment: string | null; requested_by_id: string; decided_by_id: string | null; entry_id: string; entry_reference: string; entry_type: "CREDIT" | "DEBIT";
  amount: number; source_type: string; reversal_reference: string | null; requested_by: string | null; decided_by: string | null; executed_by: string | null;
}

export async function listLedgerReversals(): Promise<LedgerReversalRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_ledger_reversals");
  if (error) throw dbError(error, "ledger reversals");
  return (data as LedgerReversalRow[]) ?? [];
}

// ---------------------------------------------------------------- reminders and email (ADR-061)
export interface EmailSummary {
  counts: Record<string, number>;
  recent_problems: { at: string; status: string; attempts: number; error: string | null; subject: string }[];
  settings: { reminders_enabled: boolean; reminder_hours: number[]; max_reminders_per_week: number; email_enabled: boolean; updated_at: string };
}
export async function getEmailSummary(): Promise<EmailSummary> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_email_summary");
  if (error) throw dbError(error, "email summary");
  return data as EmailSummary;
}

// ---------------------------------------------------------------- session-outcome correction (ADR-063)
export interface SessionCorrectionRow {
  id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED"; emergency: boolean; reason: string; from_outcome: "HELD" | "SKIPPED"; created_at: string;
  decided_at: string | null; executed_at: string | null; decision_comment: string | null; archived_rows: number | null; requested_by_id: string; session_id: string;
  week_number: number; week_year: number; week_start_at: string; requested_by: string | null; decided_by: string | null; executed_by: string | null;
}

export async function listSessionCorrections(): Promise<SessionCorrectionRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_session_corrections");
  if (error) throw dbError(error, "session corrections");
  return (data as SessionCorrectionRow[]) ?? [];
}

// ---------------------------------------------------------------- evidence files
export interface EvidenceFileRow {
  id: string;
  entity_type: "VIOLATION" | "LEDGER" | "REPORT" | "SESSION";
  entity_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  uploaded_by: string;
  uploaded_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export async function listEvidenceFiles(entityType: EvidenceFileRow["entity_type"], entityId: string): Promise<EvidenceFileRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_evidence_files", { p_entity_type: entityType, p_entity_id: entityId });
  if (error) throw dbError(error, "evidence files");
  return (data as EvidenceFileRow[]) ?? [];
}
