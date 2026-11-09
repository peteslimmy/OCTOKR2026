import "server-only";
import { defaultQuarter, getStrategyTree, listBusinessUnits, listQuarters, serverNow, weeksOfQuarter } from "@/lib/data";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";
import {
  buildBuIntelligence, buildOrgIntelligence, type BuGoalInput, type BuIntelligence, type GoalFact, type OrgIntelligence, type QuarterFrame,
} from "@/lib/insights/bu-intelligence";
import { buildExecutiveReport, type ExecutiveReport } from "@/lib/insights/executive-report";
import { evaluateSmart } from "@/lib/domain/smart";
import { analyseUnit, buildManagementBrief, type BriefQueues, type BriefUnitFacts, type ManagementBrief, type UnitAnalysis } from "@/lib/insights/management-brief";

interface Inputs { quarterId: string; quarterLabel: string; frame: QuarterFrame; now: string; facts: GoalFact[]; buGoals: BuGoalInput[] }

/** Everything the intelligence needs for one quarter, read as the signed-in person (so only the units they may see). */
async function load(quarterId?: string): Promise<Inputs | null> {
  const quarter = (quarterId ? (await listQuarters()).find((q) => q.id === quarterId) : null) ?? (await defaultQuarter());
  if (!quarter) return null;
  const sb = await userClient();
  const [weeks, now, factsRes, goalsRes] = await Promise.all([
    weeksOfQuarter(quarter.id), serverNow(), sb.rpc("read_goal_facts", { p_quarter_id: quarter.id }),
    sb.from("bu_goals").select("id, code, business_unit_id, title, status").eq("quarter_id", quarter.id),
  ]);
  if (factsRes.error) throw dbError(factsRes.error, "goal facts");
  if (goalsRes.error) throw dbError(goalsRes.error, "business unit goals");
  // the SMART rating is recomputed from the goal's wording with the current rules, like everywhere else it is shown, not read back from what was stored
  const tree = await getStrategyTree(quarter.id);
  const subTitle = new Map(tree.key_results.flatMap((k) => k.sub_key_results.map((s) => [s.code, s.title] as const)));
  const facts = ((factsRes.data ?? []) as Record<string, unknown>[]).map((r): GoalFact => ({
    goalId: String(r.goal_id), businessUnitId: String(r.business_unit_id), weekId: String(r.week_id), weekNumber: Number(r.week_number), weekStart: String(r.week_start_at),
    submitted: r.submitted === true, buGoalId: (r.bu_goal_id as string | null) ?? null, subKrCode: (r.sub_kr_code as string | null) ?? null, krCode: (r.kr_code as string | null) ?? null,
    title: String(r.title), done: r.done === true, tasksTotal: Number(r.tasks_total ?? 0), tasksDone: Number(r.tasks_done ?? 0), tasksUndefined: Number(r.tasks_undefined ?? 0),
    smart: evaluateSmart({ title: String(r.title), subKrTitle: r.sub_kr_code ? subTitle.get(String(r.sub_kr_code)) ?? null : null, goalType: r.sub_kr_code ? "KR_ALIGNED" : "STRETCH" }).overall,
  }));
  const buGoals = ((goalsRes.data ?? []) as { id: string; code: string; business_unit_id: string; title: string; status: "ACTIVE" | "RETIRED" }[]).map((g): BuGoalInput => ({ id: g.id, code: g.code, businessUnitId: g.business_unit_id, title: g.title, status: g.status }));
  return {
    quarterId: quarter.id, quarterLabel: `Q${quarter.quarter_number} ${quarter.year}`, now, facts, buGoals,
    frame: { startsOn: quarter.starts_on, endsOn: quarter.ends_on, weeks: weeks.map((w) => ({ id: w.id, number: w.week_number, start: w.week_start_at, holiday: w.reporting_state === "ORGANIZATION_HOLIDAY" })) },
  };
}

export async function getBuIntelligence(buId: string, buName: string, quarterId?: string): Promise<{ quarterLabel: string; data: BuIntelligence; analysis: UnitAnalysis } | null> {
  const i = await load(quarterId);
  if (!i) return null;
  const unit = { id: buId, name: buName };
  return { quarterLabel: i.quarterLabel, data: buildBuIntelligence({ unit, frame: i.frame, now: i.now, buGoals: i.buGoals, facts: i.facts }),
    analysis: analyseUnit({ unit, frame: i.frame, now: i.now, buGoals: i.buGoals, facts: i.facts }) };
}

export async function getOrgIntelligence(quarterId?: string): Promise<{ quarterLabel: string; data: OrgIntelligence } | null> {
  const i = await load(quarterId);
  if (!i) return null;
  const units = (await listBusinessUnits()).filter((b) => b.reports_weekly && b.status === "ACTIVE").sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ id: b.id, name: b.name }));
  return { quarterLabel: i.quarterLabel, data: buildOrgIntelligence({ units, frame: i.frame, now: i.now, buGoals: i.buGoals, facts: i.facts }) };
}

const q = (v: unknown) => { const o = (v ?? {}) as { waiting?: number; oldest_days?: number }; return { waiting: Number(o.waiting ?? 0), oldestDays: Number(o.oldest_days ?? 0) }; };

/** The weekly management brief: everything in the organisation view plus integrity, capacity, coverage, governance and what was done about a unit. */
export async function getManagementBrief(quarterId?: string): Promise<{ quarterId: string; quarterLabel: string; brief: ManagementBrief } | null> {
  const i = await load(quarterId);
  return i ? { quarterId: i.quarterId, quarterLabel: i.quarterLabel, brief: await briefFrom(i) } : null;
}

/** The executive report: the brief plus the weekly goal facts it is built on, so repeated and stalled goals can be traced to their records. */
export async function getExecutiveReport(quarterId?: string): Promise<{ quarterId: string; quarterLabel: string; report: ExecutiveReport } | null> {
  const i = await load(quarterId);
  if (!i) return null;
  const brief = await briefFrom(i);
  return { quarterId: i.quarterId, quarterLabel: i.quarterLabel, report: buildExecutiveReport({ brief, facts: i.facts, frame: i.frame, quarterLabel: i.quarterLabel, now: i.now }) };
}

async function briefFrom(i: Inputs): Promise<ManagementBrief> {
  const sb = await userClient();
  const [units, tree, briefRes, actionsRes] = await Promise.all([
    listBusinessUnits(), getStrategyTree(i.quarterId), sb.rpc("read_brief_facts", { p_quarter_id: i.quarterId }),
    sb.from("insight_actions").select("id, business_unit_id, note, score_before, created_at, created_by").eq("quarter_id", i.quarterId).order("created_at", { ascending: false }).limit(40),
  ]);
  if (briefRes.error) throw dbError(briefRes.error, "brief facts");
  const raw = (briefRes.data ?? {}) as { units?: Record<string, unknown>[]; queues?: Record<string, unknown> };
  const brief = (raw.units ?? []).map((u): BriefUnitFacts => ({
    businessUnitId: String(u.business_unit_id), decidedTasks: Number(u.decided_tasks ?? 0), lateDecidedTasks: Number(u.late_decided_tasks ?? 0), corrections: Number(u.corrections ?? 0),
    submissions: Number(u.submissions ?? 0), lateSubmissions: Number(u.late_submissions ?? 0), attendancePresent: Number(u.attendance_present ?? 0), attendanceTotal: Number(u.attendance_total ?? 0),
    openViolations: Number(u.open_violations ?? 0), openFines: Number(u.open_fines ?? 0),
  }));
  const queues: BriefQueues | null = raw.queues && Object.keys(raw.queues).length
    ? { attendanceAmendments: q(raw.queues.attendance_amendments), disbursements: q(raw.queues.disbursements), configChanges: q(raw.queues.config_changes), lateReportExceptions: q(raw.queues.late_report_exceptions) } : null;
  const reporting = units.filter((b) => b.reports_weekly && b.status === "ACTIVE").sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ id: b.id, name: b.name }));
  const subKrs = tree.key_results.filter((k) => k.status !== "RETIRED").flatMap((k) => k.sub_key_results.filter((s) => s.status !== "RETIRED").map((s) => ({ krCode: k.code, code: s.code, title: s.title })));
  const actions = ((actionsRes.data ?? []) as { id: string; business_unit_id: string; note: string; score_before: number | null; created_at: string; created_by: string }[])
    .map((a) => ({ id: a.id, businessUnitId: a.business_unit_id, note: a.note, scoreBefore: a.score_before === null ? null : Number(a.score_before), createdAt: a.created_at, createdBy: a.created_by }));
  return buildManagementBrief({ units: reporting, frame: i.frame, now: i.now, buGoals: i.buGoals, facts: i.facts, subKrs, brief, queues, actions });
}
