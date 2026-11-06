import "server-only";
import { evaluateSmart, SMART_ENGINE_VERSION } from "@/lib/domain/smart";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

// All reads run under the caller's own RLS (user-scoped client); nothing here uses the service role.

export interface Quarter {
  id: string; year: number; quarter_number: number; starts_on: string; ends_on: string;
  status: "PLANNED" | "ACTIVE" | "LOCKED"; activated_at: string | null;
}
export interface ReportingWeek {
  id: string; quarter_id: string; week_year: number; week_number: number; week_start_at: string; week_end_at: string;
  content_lock_at: string; final_lock_at: string; status: string; reporting_state: "NORMAL" | "ORGANIZATION_HOLIDAY";
  phase?: "NOT_OPEN" | "OPEN" | "CONTENT_LOCKED" | "FINAL_LOCKED";
  locks_suspended_at?: string | null; locks_suspended_reason?: string | null; opens_at_override?: string | null; opens_override_reason?: string | null;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw dbError(res.error, what);
  return res.data as T;
}

export async function listQuarters(): Promise<Quarter[]> {
  const sb = await userClient();
  return unwrap(await sb.from("quarters").select("*").order("year", { ascending: false }).order("quarter_number", { ascending: false }), "quarters");
}

/** Active quarter, else the most recent one. */
export async function currentQuarter(): Promise<Quarter | null> {
  const all = await listQuarters();
  return all.find((q) => q.status === "ACTIVE") ?? all[0] ?? null;
}

/**
 * The quarter to show when nobody picked one: the active quarter if it already has weekly reports, otherwise the most recent quarter
 * that does, otherwise the active/latest one. Keeps a freshly opened quarter from hiding every figure that exists.
 */
export async function defaultQuarter(): Promise<Quarter | null> {
  const all = await listQuarters();
  const sb = await userClient();
  const ordered = [...all.filter((q) => q.status === "ACTIVE"), ...all.filter((q) => q.status !== "ACTIVE")];
  for (const q of ordered) {
    const { count } = await sb.from("weekly_reports").select("id, reporting_weeks!inner(quarter_id)", { count: "exact", head: true }).eq("reporting_weeks.quarter_id", q.id);
    if ((count ?? 0) > 0) return q;
  }
  return all.find((q) => q.status === "ACTIVE") ?? all[0] ?? null;
}

export async function getAnnualTheme(year: number) {
  const sb = await userClient();
  const { data } = await sb.from("annual_themes").select("id, year, theme, updated_at").eq("year", year).maybeSingle();
  return data as { id: string; year: number; theme: string; updated_at: string } | null;
}

export async function getThemeChanges(themeId: string) {
  const sb = await userClient();
  return unwrap(await sb.from("annual_theme_changes").select("old_theme, new_theme, reason, changed_at").eq("annual_theme_id", themeId).order("changed_at", { ascending: false }), "theme changes");
}

export async function getStrategyTree(quarterId: string) {
  const sb = await userClient();
  return unwrap(await sb.rpc("read_strategy_tree", { p_quarter_id: quarterId }), "strategy tree") as StrategyTree;
}

export interface StrategyTree {
  quarter: Quarter;
  objective: { id: string; title: string; description: string | null } | null;
  key_results: {
    id: string; code: string; title: string; description: string | null; status?: "ACTIVE" | "RETIRED"; mapped_goals?: number; done_goals?: number; execution?: number | null;
    sub_key_results: { id: string; code: string; title: string; description: string | null; status?: "ACTIVE" | "RETIRED"; mapped_goals: number; done_goals: number; execution: number | null }[];
  }[];
  readiness: string[];
  pending_changes?: number;
}

export interface StrategyChangeRow {
  id: string; status: "PENDING" | "APPLIED" | "REJECTED"; change_type: "EDIT" | "RETIRE" | "ADD"; item_type: "OBJECTIVE" | "KR" | "SUBKR"; item_id: string | null; parent_id: string | null;
  new_title: string | null; new_description: string | null; reason: string; created_at: string; decided_at: string | null; decision_comment: string | null; requested_by_id: string;
  current_title: string | null; requested_by: string | null; decided_by: string | null;
}
export interface StrategyVersionRow { item_type: "OBJECTIVE" | "KR" | "SUBKR"; item_id: string; version: number; title: string; description: string | null; status: string; recorded_at: string; baseline: boolean }

export async function listStrategyChanges(quarterId: string) {
  const sb = await userClient();
  return unwrap(await sb.rpc("read_strategy_changes", { p_quarter_id: quarterId }), "strategy changes") as StrategyChangeRow[];
}
export async function getStrategyHistory(quarterId: string) {
  const sb = await userClient();
  return unwrap(await sb.rpc("read_strategy_history", { p_quarter_id: quarterId }), "strategy history") as StrategyVersionRow[];
}

/** Reporting weeks that are still live (opened, not final-locked), judged by the authoritative DATABASE clock. */
export async function activeWeeks(): Promise<ReportingWeek[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_active_weeks");
  if (error) throw dbError(error, "weeks");
  return (data as ReportingWeek[]) ?? [];
}

export async function environmentInfo(): Promise<{ environment: string; clock_overridden: boolean }> {
  const sb = await userClient();
  const { data } = await sb.rpc("read_environment");
  return (data as { environment: string; clock_overridden: boolean }) ?? { environment: "production", clock_overridden: false };
}

export async function serverNow(): Promise<string> {
  const sb = await userClient();
  const { data } = await sb.rpc("read_server_time");
  return (data as string) ?? new Date().toISOString();
}

export async function weeksOfQuarter(quarterId: string): Promise<ReportingWeek[]> {
  const sb = await userClient();
  return unwrap(await sb.from("reporting_weeks").select("*").eq("quarter_id", quarterId).order("week_start_at"), "quarter weeks");
}

export async function recentFinalWeeks(limit = 8): Promise<ReportingWeek[]> {
  const sb = await userClient();
  return unwrap(await sb.from("reporting_weeks").select("*").eq("status", "FINAL_LOCKED").order("week_start_at", { ascending: false }).limit(limit), "final weeks");
}

export async function getWeek(id: string): Promise<ReportingWeek | null> {
  const sb = await userClient();
  const { data } = await sb.from("reporting_weeks").select("*").eq("id", id).maybeSingle();
  return data as ReportingWeek | null;
}

export async function reportIdFor(buId: string, weekId: string): Promise<string | null> {
  const sb = await userClient();
  const { data } = await sb.from("weekly_reports").select("id").eq("business_unit_id", buId).eq("reporting_week_id", weekId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export interface ReportView {
  report: {
    id: string; status: string; submission_status: "NOT_SUBMITTED" | "SUBMITTED"; review_status: "NOT_REVIEWED" | "REVIEWED";
    version: number; submitted_at: string | null; skipped_session_summary_comment: string | null; comment?: string | null; reviewed_at: string | null; final_locked_at: string | null;
    review_comments: string | null; review_initiated_by: string | null; review_rejection_reason: string | null;
  };
  business_unit: { id: string; code: string; name: string };
  week: { id: string; week_number: number; week_year: number; week_start_at: string; content_lock_at: string; final_lock_at: string; reporting_state: string };
  phase: "NOT_OPEN" | "OPEN" | "CONTENT_LOCKED" | "FINAL_LOCKED" | "LATE_OPEN";
  /** The quarter is locked: statuses can no longer be corrected. */
  quarter_locked?: boolean;
  /** A submitted report in a week an administrator holds open: statuses can be set and corrected as after content lock. */
  status_changes_open?: boolean;
  late_exception: { id: string; status: string; reason: string; authorised_at: string } | null;
  session_outcome: "SCHEDULED" | "HELD" | "SKIPPED";
  summary_required: boolean | null;
  skip_reason?: string | null;
  goals: GoalView[];
  score_preview: { total_goals: number; done_goals: number; base_score: number; applied_penalty_rate: number; final_score: number };
  snapshot: { version: number; state: string; base_score: number; combined_penalty_rate: number; final_score: number; applied_penalty_rates: unknown[]; reason: string } | null;
  compliance: { status: "COMPLIANT" | "NON_COMPLIANT"; reason: string } | null;
}
export interface GoalView {
  id: string; title: string; description: string | null; goal_type: "KR_ALIGNED" | "STRETCH"; position: number;
  status: "DONE" | "NOT_DONE"; has_undefined_tasks: boolean;
  bu_goal?: { id: string; title: string } | null;
  sub_key_result: { id: string; code: string; title: string; kr_code: string; kr_title: string } | null;
  evaluation: { specific_score: number; measurable_score: number; achievable_score: number; relevant_score: number; time_bound_score: number; overall_score: number; warnings: string[]; suggestions: string[]; engine_version: string } | null;
  tasks: { id: string; description: string; status: "UNDEFINED" | "DONE" | "NOT_DONE"; position: number }[];
}

export async function getReportView(reportId: string): Promise<ReportView | null> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_report_view", { p_report_id: reportId });
  if (error) throw dbError(error, "report view");
  const view = (data as ReportView | null) ?? null;
  // The SMART rating is worked out from the goal's own wording every time it is shown, with the current rules (deterministic; nothing is saved), so a goal always
  // carries the rating the present checker would give it, whatever rules were in force when it was written.
  if (view) view.goals = view.goals.map((g) => {
    const e = evaluateSmart({ title: g.title, description: g.description, subKrTitle: g.sub_key_result?.title ?? null, goalType: g.goal_type });
    return { ...g, evaluation: { specific_score: e.specific, measurable_score: e.measurable, achievable_score: e.achievable, relevant_score: e.relevant, time_bound_score: e.timeBound, overall_score: e.overall, warnings: e.warnings, suggestions: e.suggestions, engine_version: SMART_ENGINE_VERSION } };
  });
  return view;
}

export interface WeekOverviewRow {
  business_unit: { id: string; code: string; name: string };
  report_id: string | null; submission_status: string; review_status: string | null;
  total_goals: number | null; done_goals: number | null; base_preview: number | null;
  final_score: number | null; score_state: string | null; snapshot_version: number | null; compliance: string | null;
}
export async function getWeekOverview(weekId: string): Promise<WeekOverviewRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_week_overview", { p_week_id: weekId });
  if (error) throw dbError(error, "overview");
  return (data as WeekOverviewRow[]) ?? [];
}

export interface ExecutiveDashboard {
  latest_finalised_week_id: string | null;
  ranking: { business_unit_id: string; name: string; code: string; latest_week_score: number | null; quarter_score: number | null; quarter_status: string | null; quarter_score_reason: string | null; quarter_version: number | null; missing_report_zero_count: number | null }[];
  non_compliant: { business_unit: string; week_start_at: string; reason: string }[];
  integrity: { total: number; applied: number; waived: number };
  strategy: StrategyTree;
}
export async function getExecutiveDashboard(quarterId: string): Promise<ExecutiveDashboard> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_executive_dashboard", { p_quarter_id: quarterId });
  if (error) throw dbError(error, "executive dashboard");
  return data as ExecutiveDashboard;
}

export async function recentSnapshots(buId: string, limit = 8) {
  const sb = await userClient();
  return unwrap(
    await sb.from("weekly_score_snapshots").select("final_score, base_score, score_state, version_number, reporting_week_id, reporting_weeks(week_start_at, week_number)")
      .eq("business_unit_id", buId).order("calculated_at", { ascending: false }).limit(limit * 2),
    "snapshots",
  ) as unknown as { final_score: number; base_score: number; score_state: string; version_number: number; reporting_week_id: string; reporting_weeks: { week_start_at: string; week_number: number } }[];
}

export async function latestQuarterSnapshot(quarterId: string, buId: string) {
  const sb = await userClient();
  const { data } = await sb.from("quarterly_score_snapshots").select("*").eq("quarter_id", quarterId).eq("business_unit_id", buId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  return data as { score: number | null; score_reason: string | null; calculation_status: string; denominator_count: number; missing_report_zero_count: number; excluded_holiday_count: number; version_number: number; week_contributions: { week_id: string; week_start_at: string; value: number; state: string; session_skipped: boolean }[] } | null;
}

export async function listAudit(limit = 100, entityType?: string) {
  const sb = await userClient();
  let q = sb.from("audit_logs").select("id, seq, occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, reason, outcome, old_values, new_values, correlation_id").order("occurred_at", { ascending: false }).order("seq", { ascending: false }).limit(limit);
  if (entityType) q = q.eq("entity_type", entityType);
  return unwrap(await q, "audit");
}

export async function listNotifications(limit = 50) {
  const sb = await userClient();
  const rows = unwrap(await sb.from("notifications").select("id, event_type, title, message, read_at, created_at, entity_type, entity_id").order("created_at", { ascending: false }).limit(limit), "notifications");
  // for notifications that ask for something to be done: is it still waiting? (one word each, only for the caller's own notifications)
  const { data } = await sb.rpc("read_notification_states", { p_ids: rows.map((r) => r.id) });
  const states = (data ?? {}) as Record<string, "WAITING" | "DONE">;
  return rows.map((r) => ({ ...r, state: states[r.id] ?? null }));
}

export async function unreadCount(): Promise<number> {
  const sb = await userClient();
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
}

export async function listBusinessUnits() {
  const sb = await userClient();
  return unwrap(await sb.from("business_units").select("id, code, name, status, reports_weekly, unit_type, parent_unit_id, description, location").order("name"), "business units");
}

export interface EmployeeRow { id: string; email: string; first_name: string; last_name: string; employment_status: string; on_attendance_roster: boolean; business_unit_id: string; business_units: { name: string } | null; users: { id: string } | null }
export async function listEmployees(): Promise<EmployeeRow[]> {
  const sb = await userClient();
  const out: EmployeeRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {   // paged past the 1000-row API default
    const page = unwrap(await sb.from("employees").select("id, email, first_name, last_name, employment_status, on_attendance_roster, business_unit_id, business_units(name), users(id)").order("last_name").range(from, from + 999), "employees") as unknown as EmployeeRow[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** The Super Admin account is kept out of every list for everyone except a Super Admin. */
export async function listUsers(viewerIsSuperAdmin = false) {
  const sb = await userClient();
  const rows = unwrap(
    await sb.from("users").select("id, email, status, last_login_at, employee_id, employees(first_name, last_name, business_unit_id, business_units(name)), user_roles!user_roles_user_id_fkey(roles(code))").order("email"),
    "users",
  ) as unknown as { id: string; email: string; status: string; last_login_at: string | null; employee_id: string; employees: { first_name: string; last_name: string; business_unit_id: string; business_units: { name: string } | null } | null; user_roles: { roles: { code: string } | null }[] }[];
  return viewerIsSuperAdmin ? rows : rows.filter((u) => !u.user_roles.some((r) => r.roles?.code === "SUPER_ADMIN"));
}

export async function currentPenaltyRate(): Promise<number | null> {
  const sb = await userClient();
  const { data } = await sb.from("integrity_penalty_configurations").select("rate").is("effective_to", null).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  return (data as { rate: number } | null)?.rate ?? null;
}

export interface BuGoalRow { id: string; business_unit_id: string; quarter_id: string; title: string; position: number; status: "ACTIVE" | "RETIRED"; created_at: string }
/** A unit's own goals for a quarter, read as the signed-in person (row-level security limits it to units they may see). */
export async function listBuGoals(buId: string, quarterId: string): Promise<BuGoalRow[]> {
  const sb = await userClient();
  return unwrap(await sb.from("bu_goals").select("id, business_unit_id, quarter_id, title, position, status, created_at").eq("business_unit_id", buId).eq("quarter_id", quarterId).order("position"), "business unit goals") as BuGoalRow[];
}
