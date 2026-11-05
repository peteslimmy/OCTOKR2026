import { buildPredictions } from "./predictions";
import { isOrgWide } from "./tools";
import type { Asker, Quarter, Source, ToolData, Unit } from "./tools/types";
import type { CoverageRow } from "@/lib/insights/management-brief";

/**
 * The AI report set (docs/38 section 13). Every figure is read from the application's own records and engines and set out in tables; the commentary is a fixed rule
 * that states what changed in words, from those same figures. Nothing is written by a model here, so a report can be exported and relied on. (An optional model-written
 * explanation is a separate step that is checked against the report's figures before it is shown: see commentary.ts.)
 */
export interface CaseRow { reference: string; title: string; category: string; severity: string; status: string; unit: string | null; detectedAt: string; respondedAt: string | null; responseDueAt: string | null }
export interface PlanRow { caseReference: string; unit: string | null; status: string; effectiveness: string | null; baseline: number | null; review: number | null; reviewDate: string | null; actionsDone: number; actionsTotal: number }
export interface RemarkReasonRow { unit: string; reason: string; n: number }
export interface Counts { cases: Record<string, number>; remarkRequests: Record<string, number>; closureRequests: Record<string, number>; approvalsPending: number; awaitingClosureConfirmation: number; plans: Record<string, number>; unresolvedTasks: number; newFindings: number; communications: Record<string, number> }
export interface ReportData extends ToolData {
  cases(): Promise<CaseRow[]>;
  plans(): Promise<PlanRow[]>;
  remarkReasons(): Promise<RemarkReasonRow[]>;
  coverage(quarterId: string): Promise<CoverageRow[]>;
  counts(): Promise<Counts>;
}

export type Cell = string | number | null;
export interface ReportTable { caption: string; columns: string[]; rows: Cell[][] }
export interface ReportSection { heading: string; paragraphs: string[]; table?: ReportTable }
export interface Report { id: string; title: string; subtitle: string; period: string; scopeLabel: string; generatedAt: string; sections: ReportSection[]; sources: Source[]; limitations: string[] }
export interface ReportArgs { quarter?: string; unit?: string }
export interface ReportContext { asker: Asker; data: ReportData; now: () => Date }
export type ReportResult = { report: Report } | { error: string };
export interface ReportDef { id: string; title: string; description: string; scope: "organisation" | "unit" | "either"; build(ctx: ReportContext, args: ReportArgs): Promise<ReportResult> }

const pc = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "n/a" : `${n.toFixed(d)}%`);
const sg = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(0)}`);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const label = (s: string) => s.toLowerCase().replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const orgOnly = (ctx: ReportContext): ReportResult | null => (isOrgWide(ctx.asker) ? null : { error: "This report covers the whole organisation. It is available to executives and administrators." });
async function unitFor(ctx: ReportContext, spec?: string): Promise<{ unit: Unit } | { error: string }> {
  const visible = await ctx.data.units();
  const allowed = isOrgWide(ctx.asker) ? visible : visible.filter((u) => u.id === ctx.asker.buId);
  const want = (spec ?? "").trim().toLowerCase();
  const hit = !want || want === "mine" ? allowed.find((u) => u.id === ctx.asker.buId) : allowed.find((u) => u.code.toLowerCase() === want || u.name.toLowerCase() === want);
  return hit ? { unit: hit } : { error: want ? "That unit is outside what you are allowed to see, or it does not exist." : "Choose a unit." };
}
function make(ctx: ReportContext, def: Pick<ReportDef, "id" | "title">, period: string, scopeLabel: string, subtitle: string, sections: ReportSection[], sources: Source[] = [], limitations: string[] = []): ReportResult {
  return { report: { id: def.id, title: def.title, subtitle, period, scopeLabel, generatedAt: ctx.now().toISOString(), sections, sources, limitations } };
}
const link = (path: string, quarterId: string, label: string, period: string): Source => ({ label, href: `${path}?quarter=${quarterId}`, period, kind: "organisation" });
const T = (caption: string, columns: string[], rows: Cell[][]): ReportTable => ({ caption, columns, rows });

type OrgData = NonNullable<Awaited<ReturnType<ReportData["orgReport"]>>>;
async function orgBase(ctx: ReportContext, args: ReportArgs): Promise<{ error: string } | { q: Quarter; r: OrgData }> {
  const q = await ctx.data.quarter(args.quarter);
  if (!q) return { error: "No such quarter." };
  const r = await ctx.data.orgReport(q.id);
  if (!r) return { error: "There is no data for that quarter yet." };
  return { q, r };
}
const unitRows = (r: NonNullable<Awaited<ReturnType<ReportData["orgReport"]>>>) => r.report.units.map((u) => [u.name, pc(u.scoreToDate), pc(u.last), pc(u.previous), sg(u.delta), pc(u.projected), label(u.direction), label(u.outlook.replace("_", " "))] as Cell[]);
const UNIT_COLS = ["Unit", "Score to date", "Last week", "Week before", "Change (points)", "Forecast", "Direction", "Outlook"];

const dailyBrief: ReportDef = {
  id: "daily-brief", title: "Daily organisational intelligence brief", description: "What needs attention today: open cases, requests waiting, proposals to decide and the units to look at.", scope: "organisation",
  async build(ctx, args) {
    const no = orgOnly(ctx); if (no) return no;
    const b = await orgBase(ctx, args); if ("error" in b) return b;
    const [n, o] = [await ctx.data.counts(), b.r.report.org];
    const sections: ReportSection[] = [
      { heading: "Today", paragraphs: [
        `${plural(n.cases.open ?? 0, "case")} ${n.cases.open === 1 ? "is" : "are"} open, ${n.cases.highOpen ?? 0} of them high or critical, and ${n.cases.escalated ?? 0} ${n.cases.escalated === 1 ? "has" : "have"} been escalated to executives.`,
        `${plural(n.remarkRequests.open ?? 0, "request")} for task remarks ${n.remarkRequests.open === 1 ? "is" : "are"} waiting (${n.remarkRequests.overdue ?? 0} overdue); ${plural(n.closureRequests.open ?? 0, "monthly review")} ${n.closureRequests.open === 1 ? "is" : "are"} waiting.`,
        `${plural(n.approvalsPending, "proposal")} ${n.approvalsPending === 1 ? "is" : "are"} waiting for a decision. ${plural(n.newFindings, "new finding")} from the daily review.`] },
      { heading: "Where the quarter stands", paragraphs: [o.verdict, o.weekDelta === null ? "There is no earlier week to compare with." : `Week ${o.latestWeek} scored ${pc(o.thisWeek)} on average against ${pc(o.lastWeek)} in week ${o.previousWeek}, a change of ${sg(o.weekDelta)} points.`],
        table: T("Units needing executive attention", ["Unit"], o.needsIntervention.map((u) => [u])) },
    ];
    return make(ctx, this, b.q.label, "Organisation", `Prepared ${ctx.now().toISOString().slice(0, 10)}`, sections, [link("/insights", b.q.id, `Management brief, ${b.q.label}`, b.q.label)]);
  },
};

const weeklyOrg: ReportDef = {
  id: "weekly-org", title: "Weekly organisational performance report", description: "This week against last week for every unit, with who improved and who slipped.", scope: "organisation",
  async build(ctx, args) {
    const no = orgOnly(ctx); if (no) return no;
    const b = await orgBase(ctx, args); if ("error" in b) return b;
    const { r } = b, o = r.report.org;
    const up = r.report.units.filter((u) => u.delta !== null && u.delta > 0).sort((a, c) => (c.delta ?? 0) - (a.delta ?? 0)), down = r.report.units.filter((u) => u.delta !== null && u.delta < 0).sort((a, c) => (a.delta ?? 0) - (c.delta ?? 0));
    return make(ctx, this, `${b.q.label}, week ${o.latestWeek ?? "n/a"}`, "Organisation", "Week on week", [
      { heading: "What changed", paragraphs: [
        o.weekDelta === null ? "There is no earlier week to compare with." : `The average weekly score was ${pc(o.thisWeek)} in week ${o.latestWeek}, against ${pc(o.lastWeek)} in week ${o.previousWeek} (${sg(o.weekDelta)} points).`,
        up.length ? `Improved most: ${up.slice(0, 3).map((u) => `${u.name} (${sg(u.delta)})`).join(", ")}.` : "No unit improved on the week before.",
        down.length ? `Fell most: ${down.slice(0, 3).map((u) => `${u.name} (${sg(u.delta)})`).join(", ")}.` : "No unit fell on the week before."] },
      { heading: "Every unit", paragraphs: [], table: T("Units, week on week", UNIT_COLS, unitRows(r)) },
    ], [link("/insights", b.q.id, `Management brief, ${b.q.label}`, b.q.label)], ["A unit that filed nothing in a week scores zero for it."]);
  },
};

const monthlyExec: ReportDef = {
  id: "monthly-executive", title: "Monthly executive performance report", description: "The quarter to date: standing, forecast, the biggest risks, repeated goals and what to decide.", scope: "organisation",
  async build(ctx, args) {
    const no = orgOnly(ctx); if (no) return no;
    const b = await orgBase(ctx, args); if ("error" in b) return b;
    const { r } = b, x = r.report, o = x.org;
    return make(ctx, this, b.q.label, "Organisation", "Quarter to date", [
      { heading: "Where we stand", paragraphs: [o.verdict, `Actual to date ${pc(o.actualToDate)}; reported ${pc(o.reported)}; forecast ${pc(o.projectedUnweighted)} against a target of ${o.target}%. ${plural(o.belowTarget, "unit")} ${o.belowTarget === 1 ? "is" : "are"} below target.`], table: T("Units", UNIT_COLS, unitRows(r)) },
      { heading: "The five risks that matter most", paragraphs: [], table: T("Top risks", ["Risk", "Band", "Residual score", "Units"], x.topRisks.map((k) => [k.title, k.band, k.residual, k.units.join(", ")])) },
      { heading: "Goals set again and again", paragraphs: [x.repeated.length ? `${plural(x.repeated.length, "goal")} ${x.repeated.length === 1 ? "has" : "have"} been set repeatedly without being finished.` : "No goal has been left unfinished in two or more weeks."],
        table: T("Repeated goals", ["Unit", "Goal", "Weeks set", "Unfinished", "Classification"], x.repeated.slice(0, 15).map((g) => [g.unit, g.title, g.weeksSet, g.weeksUnfinished, g.classification])) },
      { heading: "Decisions for management", paragraphs: x.decisions.length ? [] : ["No decision beyond routine monitoring is needed."], table: x.decisions.length ? T("Decisions", ["Decision", "Why"], x.decisions.map((d) => [d.decision, d.why])) : undefined },
    ], [link("/insights", b.q.id, `Management brief, ${b.q.label}`, b.q.label)], ["Risk ratings use a proposed scale; owners and deadlines are not recorded by the application."]);
  },
};

const quarterly: ReportDef = {
  id: "quarterly-assessment", title: "Quarterly organisational performance assessment", description: "Each unit's forecast against the target, how sure it is, and what the rest of the quarter must deliver.", scope: "organisation",
  async build(ctx, args) {
    const no = orgOnly(ctx); if (no) return no;
    const b = await orgBase(ctx, args); if ("error" in b) return b;
    const { r } = b, o = r.report.org;
    const preds = buildPredictions(r.report).filter((p) => p.kind === "UNIT_QUARTER");
    return make(ctx, this, b.q.label, "Organisation", "Forecast and assessment", [
      { heading: "The quarter", paragraphs: [o.verdict, o.neededWeekly === null ? "No weeks remain, or no forecast can be made yet." : `The remaining ${o.weeksRemaining} weeks must average about ${pc(o.neededWeekly)} to land on target, against a recent ${pc(o.recentWeekly)}.`] },
      { heading: "Forecast by unit", paragraphs: ["Each forecast weights recent weeks towards the latest and continues the trend only partly. It is an estimate, not a promise."],
        table: T("Quarter forecast", ["Unit", "To date", "Forecast", "Variance (points)", "Confidence", "Expected outcome"], r.report.units.map((u) => [u.name, pc(u.scoreToDate), pc(u.projected), sg(u.variance), u.confidence, preds.find((p) => p.id === `unit:${u.id}`)?.outcome ?? ""])) },
    ], [link("/insights", b.q.id, `Management brief, ${b.q.label}`, b.q.label)], ["Confidence is low under three settled weeks, medium to five, high from six."]);
  },
};

const buPerformance: ReportDef = {
  id: "bu-performance", title: "Business unit performance report", description: "One unit's quarter: standing, weekly trend, goals, capacity, repeated goals, cases and the reasons it gave.", scope: "either",
  async build(ctx, args) {
    const q = await ctx.data.quarter(args.quarter); if (!q) return { error: "No such quarter." };
    const res = await unitFor(ctx, args.unit); if ("error" in res) return res;
    const a = await ctx.data.buAnalysis(res.unit, q.id); if (!a) return { error: "There is no data for that quarter yet." };
    const [trend, cases, plans, reasons] = await Promise.all([ctx.data.trend(res.unit.id, q.id), ctx.data.cases(), ctx.data.plans(), ctx.data.remarkReasons()]);
    const x = a.analysis, i = x.intel, mine = cases.filter((c) => c.unit === res.unit.name);
    return make(ctx, this, a.quarterLabel, res.unit.name, "Business unit", [
      { heading: "Position", paragraphs: [`${res.unit.name} is ${label(i.outlook.replace("_", " "))}: ${i.headline}`, `Forecast quarter score ${pc(i.prediction.projectedQuarterScore)} against a target of ${i.prediction.target}%. Last week ${pc(x.change.last)}, the week before ${pc(x.change.previous)}.`,
        x.cause ? `The main reason found: ${x.cause.label}. ${x.cause.detail}` : "No single main reason was found."] },
      { heading: "Weekly trend", paragraphs: [], table: T("Weeks so far", ["Week", "Goals done", "Tasks done", "Score"], trend.map((w) => [w.week, pc(w.goals), pc(w.tasks), pc(w.score)])) },
      { heading: "Unit goals", paragraphs: [], table: T("Unit goals", ["Goal", "Outlook", "Forecast", "Weekly goals"], i.goals.map((g) => [g.title, label(g.outlook.replace("_", " ")), pc(g.projected), g.weeklyGoals])) },
      { heading: "Capacity and repeated goals", paragraphs: [x.capacity.ratio === null ? "Not enough weeks to judge capacity." : `The unit plans ${x.capacity.plannedPerWeek?.toFixed(1)} tasks a week and finishes ${x.capacity.donePerWeek?.toFixed(1)} (${pc(x.capacity.ratio)}).`],
        table: T("Set again without finishing", ["Goal", "Weeks"], x.capacity.carryOver.map((c) => [c.title, c.weeks])) },
      { heading: "Cases and corrective plans", paragraphs: [mine.length ? `${plural(mine.length, "case")} concern this unit.` : "No case concerns this unit."],
        table: T("Cases", ["Reference", "Case", "Severity", "Status"], mine.map((c) => [c.reference, c.title, label(c.severity), label(c.status)])) },
      { heading: "The unit's own reasons for tasks not done", paragraphs: ["These are the unit's account in its remarks. They have not been verified."], table: T("Reasons given", ["Reason", "Tasks"], reasons.filter((e) => e.unit === res.unit.name).map((e) => [label(e.reason), e.n])) },
    ].concat(plans.filter((p) => p.unit === res.unit.name).length ? [{ heading: "Corrective plans", paragraphs: [], table: T("Plans", ["Case", "Status", "Effect", "Actions done"], plans.filter((p) => p.unit === res.unit.name).map((p) => [p.caseReference, label(p.status), p.effectiveness ? label(p.effectiveness) : "not yet reviewed", `${p.actionsDone} of ${p.actionsTotal}`])) }] : []),
      [{ label: `${res.unit.name}: dashboard, ${a.quarterLabel}`, href: `/dashboard?quarter=${q.id}`, period: a.quarterLabel, kind: "unit" }]);
  },
};

const outstanding: ReportDef = {
  id: "outstanding-activities", title: "Outstanding activities report", description: "Tasks not done in finished weeks, each due at the end of its week.", scope: "either",
  async build(ctx, args) {
    const org = isOrgWide(ctx.asker) && !args.unit;
    let buId: string | null = null, scope = "Organisation";
    if (!org) { const res = await unitFor(ctx, args.unit); if ("error" in res) return res; buId = res.unit.id; scope = res.unit.name; }
    const rows = (await ctx.data.unresolvedTasks(buId, 200)).filter((t) => isOrgWide(ctx.asker) || t.buId === ctx.asker.buId);
    const by = new Map<string, number>(); rows.forEach((t) => by.set(t.buCode, (by.get(t.buCode) ?? 0) + 1));
    return make(ctx, this, "Finished weeks", scope, `${plural(rows.length, "task")} not done`, [
      { heading: "Summary", paragraphs: [rows.length ? `${plural(rows.length, "task")} ${rows.length === 1 ? "was" : "were"} not done in finished weeks${by.size > 1 ? `, across ${plural(by.size, "unit")}` : ""}. Each was due at the end of the week it was set for.` : "No task was left undone in a finished week."] },
      { heading: "Tasks", paragraphs: [], table: T("Tasks not done", ["Unit", "Week", "Due", "Task", "Goal", "Status"], rows.map((t) => [t.buCode, `Week ${t.weekNumber}`, day(t.dueAt), t.description, t.goalTitle, label(t.status)])) },
    ], [], rows.length >= 200 ? ["Only the first 200 are listed."] : ["No per-task remark means the reason is not known; remarks are requested after each week closes."]);
  },
};

const carried: ReportDef = {
  id: "carried-forward", title: "Repeatedly carried-forward activities report", description: "Goals set again and again without being finished, with how each is classified.", scope: "either",
  async build(ctx, args) {
    const q = await ctx.data.quarter(args.quarter); if (!q) return { error: "No such quarter." };
    if (isOrgWide(ctx.asker) && !args.unit) {
      const r = await ctx.data.orgReport(q.id); if (!r) return { error: "There is no data for that quarter yet." };
      return make(ctx, this, r.quarterLabel, "Organisation", "Matched by similar wording", [
        { heading: "Goals", paragraphs: [r.report.repeated.length ? `${plural(r.report.repeated.length, "goal")} set repeatedly without being finished.` : "No goal has been left unfinished in two or more weeks."],
          table: T("Repeated goals", ["Unit", "Goal", "Weeks set", "Unfinished", "Weeks", "Task progress", "Classification", "Why"], r.report.repeated.map((g) => [g.unit, g.title, g.weeksSet, g.weeksUnfinished, `${g.first} to ${g.last}`, pc(g.progressPct), g.classification, g.why])) },
        { heading: "Themes across units", paragraphs: r.report.themes.length ? [] : ["No wording theme recurs in the unfinished goals of three or more units."], table: r.report.themes.length ? T("Themes", ["Theme", "Units"], r.report.themes.map((t) => [t.theme, t.units.join(", ")])) : undefined },
      ], [link("/insights", q.id, `Management brief, ${q.label}`, r.quarterLabel)], ["The application does not record who owns a goal, when it was created or its original due date: a goal belongs to its unit and its due date is the end of the week it was set for."]);
    }
    const res = await unitFor(ctx, args.unit); if ("error" in res) return res;
    const a = await ctx.data.buAnalysis(res.unit, q.id); if (!a) return { error: "There is no data for that quarter yet." };
    return make(ctx, this, a.quarterLabel, res.unit.name, "Matched by similar wording", [{ heading: "Goals", paragraphs: [], table: T("Set again without finishing", ["Goal", "Weeks set without finishing"], a.analysis.capacity.carryOver.map((c) => [c.title, c.weeks])) }]);
  },
};

const unresolvedCases: ReportDef = {
  id: "unresolved-cases", title: "Unresolved performance cases report", description: "Every case that is not yet resolved, how old it is and whether the unit has answered.", scope: "either",
  async build(ctx) {
    const open = (await ctx.data.cases()).filter((c) => c.status !== "RESOLVED" && c.status !== "CLOSED");
    const now = ctx.now().getTime();
    return make(ctx, this, "Now", isOrgWide(ctx.asker) ? "Organisation" : "Your unit", plural(open.length, "open case"), [
      { heading: "Summary", paragraphs: [open.length ? `${plural(open.length, "case")} ${open.length === 1 ? "is" : "are"} open: ${open.filter((c) => c.severity === "HIGH" || c.severity === "CRITICAL").length} high or critical, ${open.filter((c) => !c.respondedAt).length} without a response from the unit.` : "No case is open."] },
      { heading: "Cases", paragraphs: [], table: T("Open cases", ["Reference", "Case", "Unit", "Severity", "Status", "Days open", "Responded"], open.map((c) => [c.reference, c.title, c.unit ?? "Organisation", label(c.severity), label(c.status), Math.floor((now - new Date(c.detectedAt).getTime()) / 864e5), c.respondedAt ? "yes" : "no"])) },
    ]);
  },
};

const corrective: ReportDef = {
  id: "corrective-tracking", title: "Corrective action tracking report", description: "Every corrective plan, its actions, and what the unit's scores did after it started.", scope: "either",
  async build(ctx) {
    const plans = await ctx.data.plans();
    return make(ctx, this, "Now", isOrgWide(ctx.asker) ? "Organisation" : "Your unit", plural(plans.length, "plan"), [
      { heading: "Plans", paragraphs: [plans.length ? `${plans.filter((p) => p.status === "IN_PROGRESS").length} in progress, ${plans.filter((p) => p.status === "COMPLETED").length} reviewed.` : "No corrective plan exists yet."],
        table: T("Corrective plans", ["Case", "Unit", "Status", "Actions done", "Baseline score", "Score at review", "Review date", "Effect on scores"], plans.map((p) => [p.caseReference, p.unit ?? "", label(p.status), `${p.actionsDone} of ${p.actionsTotal}`, pc(p.baseline, 1), pc(p.review, 1), day(p.reviewDate), p.effectiveness ? label(p.effectiveness) : "not yet reviewed"])) },
    ], [], ["A plan is judged on the unit's final scores after it started, never on its actions being marked done."]);
  },
};

const krRisk: ReportDef = {
  id: "kr-risk", title: "KR and Sub-KR risk report", description: "Sub-KRs nobody supports or whose weekly goals are mostly unfinished, and the unit forecasts behind them.", scope: "organisation",
  async build(ctx, args) {
    const no = orgOnly(ctx); if (no) return no;
    const b = await orgBase(ctx, args); if ("error" in b) return b;
    const cov = await ctx.data.coverage(b.q.id);
    const preds = buildPredictions(b.r.report, cov).filter((p) => p.kind === "SUB_KR");
    return make(ctx, this, b.q.label, "Organisation", "Coverage-based", [
      { heading: "At risk", paragraphs: [preds.length ? `${plural(preds.length, "Sub-KR")} at risk.` : "Every Sub-KR has weekly goals behind it and most of them are being finished."], table: T("Sub-KRs at risk", ["Sub-KR", "Expected outcome", "Confidence"], preds.map((p) => [p.subject, p.outcome, p.confidence])) },
      { heading: "Every Sub-KR", paragraphs: [], table: T("Coverage", ["Sub-KR", "Weekly goals", "Units", "Share of goals", "Finished", "Coverage"], cov.map((k) => [`${k.code} ${k.title}`, k.goals, k.units, pc(k.sharePct), pc(k.doneRate), label(k.status)])) },
    ], [link("/insights", b.q.id, `Management brief, ${b.q.label}`, b.q.label)], ["The application records no numeric target for a Key Result or Sub-KR, so risk here is judged from the weekly goals that support it, not from a score."]);
  },
};

const complianceReport: ReportDef = {
  id: "reporting-compliance", title: "Reporting compliance report", description: "Weekly reports filed, filed late and missed, by unit.", scope: "either",
  async build(ctx, args) {
    const q = await ctx.data.quarter(args.quarter); if (!q) return { error: "No such quarter." };
    const now = ctx.now().getTime();
    const cells = (await ctx.data.cells(q.id)).filter((c) => c.reportsWeekly && !c.holiday && new Date(c.weekStart).getTime() <= now && (isOrgWide(ctx.asker) || c.businessUnitId === ctx.asker.buId));
    const by = new Map<string, { name: string; due: number; filed: number; late: number; missed: number }>();
    for (const c of cells) { const e = by.get(c.businessUnitId) ?? { name: c.name, due: 0, filed: 0, late: 0, missed: 0 }; e.due++; if (c.submitted) { e.filed++; if (!c.onTime) e.late++; } else if (c.compliance === "NON_COMPLIANT") e.missed++; by.set(c.businessUnitId, e); }
    const rows = [...by.values()].sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));
    return make(ctx, this, q.label, isOrgWide(ctx.asker) ? "Organisation" : "Your unit", "Filed, late and missed", [
      { heading: "Compliance", paragraphs: [rows.length ? `${rows.reduce((n, r) => n + r.missed, 0)} reports missed and ${rows.reduce((n, r) => n + r.late, 0)} filed late across ${plural(rows.length, "unit")}.` : "No week is due yet."],
        table: T("By unit", ["Unit", "Weeks due", "Filed", "Filed late", "Missed"], rows.map((r) => [r.name, r.due, r.filed, r.late, r.missed])) },
    ], [{ label: `Dashboard, ${q.label}`, href: `/dashboard?quarter=${q.id}`, period: q.label, kind: "organisation" }], ["A week still open is counted as due but not as missed until the final lock."]);
  },
};

const dependencies: ReportDef = {
  id: "dependencies-bottlenecks", title: "Cross-unit dependency and bottleneck report", description: "Where units say they are waiting on others or short of resources, with the cases it led to.", scope: "organisation",
  async build(ctx) {
    const no = orgOnly(ctx); if (no) return no;
    const [reasons, cases] = await Promise.all([ctx.data.remarkReasons(), ctx.data.cases()]);
    const related = cases.filter((c) => c.category === "CROSS_BU_DEPENDENCY" || c.category === "RESOURCE_CONSTRAINT");
    const tot = (r: string) => reasons.filter((e) => e.reason === r).reduce((n, e) => n + e.n, 0);
    return make(ctx, this, "All remarks to date", "Organisation", "From the units' own remarks", [
      { heading: "What the units say", paragraphs: [`Units recorded dependency on another unit for ${plural(tot("DEPENDENCY"), "task")} and a shortage of resources for ${plural(tot("RESOURCES"), "task")}. These are the units' own accounts and have not been verified.`],
        table: T("Reasons by unit", ["Unit", "Reason", "Tasks"], reasons.filter((e) => e.reason === "DEPENDENCY" || e.reason === "RESOURCES").map((e) => [e.unit, label(e.reason), e.n])) },
      { heading: "Cases it led to", paragraphs: [], table: T("Cases", ["Reference", "Case", "Unit", "Status"], related.map((c) => [c.reference, c.title, c.unit ?? "", label(c.status)])) },
    ], [], ["Which unit is depended on is not recorded: only that the unit says it is waiting."]);
  },
};

const effectiveness: ReportDef = {
  id: "intervention-effectiveness", title: "AI intervention effectiveness report", description: "Whether corrective plans worked, judged on the units' later scores.", scope: "organisation",
  async build(ctx) {
    const no = orgOnly(ctx); if (no) return no;
    const plans = await ctx.data.plans();
    const reviewed = plans.filter((p) => p.effectiveness);
    const n = (e: string) => reviewed.filter((p) => p.effectiveness === e).length;
    return make(ctx, this, "All plans", "Organisation", "Judged on scores", [
      { heading: "Result", paragraphs: [reviewed.length ? `${plural(reviewed.length, "plan")} reviewed: ${n("IMPROVED")} improved, ${n("NO_CHANGE")} no change, ${n("WORSE")} worse, ${n("INSUFFICIENT_DATA")} without enough data to say.` : "No plan has reached its review date yet."],
        table: T("Reviewed plans", ["Case", "Unit", "Baseline", "At review", "Effect"], reviewed.map((p) => [p.caseReference, p.unit ?? "", pc(p.baseline, 1), pc(p.review, 1), label(p.effectiveness ?? "")])) },
    ], [], ["Improved means the unit's average final score rose by 5 points or more over its baseline after the plan started; worse means it fell by 5 or more. Marking actions done does not count."]);
  },
};

export const REPORTS: readonly ReportDef[] = [dailyBrief, weeklyOrg, monthlyExec, quarterly, buPerformance, outstanding, carried, unresolvedCases, corrective, krRisk, complianceReport, dependencies, effectiveness];
export const reportById = (id: string) => REPORTS.find((r) => r.id === id);
export const availableReports = (a: Asker) => REPORTS.filter((r) => r.scope !== "organisation" || isOrgWide(a));

/** The report's tables as CSV: one block per table with its caption, so a spreadsheet can be built from it. */
export function reportCsv(r: Report): string {
  // text that a spreadsheet would run as a formula is defused; plain numbers (including signed ones such as -8 or +5%) are left alone
  const esc = (v: Cell) => {
    const s = v === null ? "" : String(v);
    const risky = typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?%?$/.test(s);
    const t = risky ? `'${s}` : s;
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const out: string[] = [esc(r.title), esc(`${r.scopeLabel} · ${r.period}`), esc(`Generated ${r.generatedAt}`), ""];
  for (const s of r.sections) {
    out.push(esc(s.heading));
    for (const p of s.paragraphs) out.push(esc(p));
    if (s.table) { out.push(esc(s.table.caption), s.table.columns.map(esc).join(",")); for (const row of s.table.rows) out.push(row.map(esc).join(",")); }
    out.push("");
  }
  if (r.limitations.length) { out.push(esc("Limitations")); r.limitations.forEach((l) => out.push(esc(l))); }
  return out.join("\r\n");
}
void cap;
