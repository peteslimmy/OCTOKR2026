import { describe, expect, it, vi } from "vitest";
import { explainReport } from "../commentary";
import { availableReports, REPORTS, reportById, reportCsv, type ReportContext, type ReportData } from "../reports";
import type { Asker, TaskRow } from "../tools/types";

const A = { id: "u-a", code: "ALPHA", name: "Alpha Unit" }, B = { id: "u-b", code: "BRAVO", name: "Bravo Unit" };
const exec: Asker = { id: "e", buId: A.id, permissions: new Set(["ai.insights.org", "dashboard.executive.view", "ai.report.export"]) };
const lead: Asker = { id: "l", buId: A.id, permissions: new Set(["ai.insights.bu", "ai.report.export"]) };
const uv = (u: typeof A, o: Record<string, unknown> = {}) => ({ id: u.id, name: u.name, outlook: "AT_RISK", elapsed: 6, filed: 5, missed: 1, series: [70, 60, 55], scoreToDate: 48.3, projected: 52.4, variance: -17.6, last: 50, previous: 60, delta: -10,
  direction: "deteriorating", slope: -4, volatility: 8, maxSwing: 10, recentAvg: 55, needed: 86.1, stepUp: 31, remaining: 7, reachable: true, confidence: "medium", forecast: "unlikely", cause: { code: "X", label: "Takes on more than it finishes", detail: "d" },
  analysis: { capacity: { plannedPerWeek: 6, donePerWeek: 3, ratio: 50, overcommitted: true, carryOver: [] } }, ...o });
const orgReport = () => ({ quarterLabel: "Q4 2026", report: { quarterLabel: "Q4 2026", units: [uv(A), uv(B, { delta: 8, last: 68, previous: 60, forecast: "achieve", projected: 72, direction: "improving", outlook: "ON_TRACK" })],
  org: { units: 2, counts: { ON_TRACK: 1, AT_RISK: 1, OFF_TRACK: 0 }, target: 70, actualToDate: 55.2, reported: 61.4, projectedUnweighted: 62.2, projectedWeighted: 60, belowTarget: 1, materiallyBelow: 0, thisWeek: 59, lastWeek: 60, weekDelta: -1, latestWeek: 44, previousWeek: 43,
    weeksRemaining: 8, neededWeekly: 80.5, recentWeekly: 59.5, improving: [B.name], deteriorating: [A.name], needsIntervention: [A.name], verdict: "Below target." },
  repeated: [{ unit: A.name, unitId: A.id, title: "Publish the pricing sheets", weeksSet: 4, weeksUnfinished: 4, first: 40, last: 43, progressPct: 25, classification: "Stagnant goal", why: "no progress" }], themes: [],
  topRisks: [{ title: "Reporting gaps", band: "High", residual: 12, units: [A.name] }], decisions: [{ decision: "Does Alpha need a recovery plan?", why: "Forecast well below target" }] } });
const data = (over: Partial<ReportData> = {}): ReportData & { spies: Record<string, ReturnType<typeof vi.fn>> } => {
  const spies = { orgReport: vi.fn(async () => orgReport() as never), buAnalysis: vi.fn(async () => ({ quarterLabel: "Q4 2026", analysis: { change: { last: 50, previous: 60 }, cause: null, intel: { outlook: "AT_RISK", headline: "Behind", prediction: { target: 70, projectedQuarterScore: 52.4 }, goals: [] }, capacity: { plannedPerWeek: 6, donePerWeek: 3, ratio: 50, carryOver: [] } } as never })) };
  return {
    quarter: async () => ({ id: "q4", label: "Q4 2026" }), units: async () => [A, B], buAnalysis: spies.buAnalysis as never, orgReport: spies.orgReport as never, trend: async () => [], cells: async () => [],
    unresolvedTasks: async (): Promise<TaskRow[]> => [{ id: "t1", description: "Ship it", status: "NOT_DONE", goalTitle: "G", reportId: "r", weekNumber: 43, weekStart: "2026-10-19T00:00:00Z", dueAt: "2026-10-25T00:00:00Z", buId: A.id, buCode: "ALPHA" },
      { id: "t2", description: "SECRET OTHER UNIT TASK", status: "NOT_DONE", goalTitle: "G2", reportId: "r2", weekNumber: 43, weekStart: "2026-10-19T00:00:00Z", dueAt: "2026-10-25T00:00:00Z", buId: B.id, buCode: "BRAVO" }],
    taskHistory: async () => null, cases: async () => [], plans: async () => [], remarkReasons: async () => [], coverage: async () => [],
    counts: async () => ({ cases: { open: 3, highOpen: 1, escalated: 1 }, remarkRequests: { open: 2, overdue: 1 }, closureRequests: { open: 1 }, approvalsPending: 2, awaitingClosureConfirmation: 0, plans: {}, unresolvedTasks: 9, newFindings: 4, communications: {} }), ...over, spies,
  };
};
const ctx = (asker: Asker, d: ReportData): ReportContext => ({ asker, data: d, now: () => new Date("2026-11-04T08:00:00Z") });
const build = async (id: string, asker: Asker, d: ReportData, args = {}) => { const r = await reportById(id)!.build(ctx(asker, d), args); if ("error" in r) throw new Error(r.error); return r.report; };

describe("the report set", () => {
  it("offers the organisation-wide reports only to people with organisation-wide access", () => {
    expect(availableReports(exec).length).toBe(REPORTS.length);
    expect(availableReports(lead).map((r) => r.scope)).not.toContain("organisation");
    expect(availableReports(lead).map((r) => r.id)).toEqual(expect.arrayContaining(["bu-performance", "outstanding-activities", "unresolved-cases", "reporting-compliance"]));
  });

  it("refuses an organisation-wide report to a BU Lead, without reading the data", async () => {
    for (const r of REPORTS.filter((x) => x.scope === "organisation")) {
      const d = data();
      const res = await r.build(ctx(lead, d), {});
      expect(res, r.id).toHaveProperty("error");
      expect(d.spies.orgReport, r.id).not.toHaveBeenCalled();
    }
  });

  it("the weekly report states the change in words from the same figures that are in its table", async () => {
    const r = await build("weekly-org", exec, data());
    expect(r.sections[0].paragraphs.join(" ")).toContain("59%");
    expect(r.sections[0].paragraphs.join(" ")).toContain("-1 points");
    expect(r.sections[0].paragraphs.join(" ")).toContain("Improved most: Bravo Unit (+8)");
    expect(r.sections[0].paragraphs.join(" ")).toContain("Fell most: Alpha Unit (-10)");
    const t = r.sections[1].table!;
    expect(t.columns).toContain("Forecast");
    expect(t.rows.find((x) => x[0] === "Alpha Unit")).toContain("52%");
  });

  it("the daily brief counts what is open and who needs attention", async () => {
    const r = await build("daily-brief", exec, data());
    const text = r.sections[0].paragraphs.join(" ");
    expect(text).toContain("3 cases are open, 1 of them high or critical");
    expect(text).toContain("2 proposals are waiting");
    expect(r.sections[1].table!.rows).toEqual([["Alpha Unit"]]);
  });

  it("the quarterly assessment gives each unit's forecast with its expected outcome and confidence", async () => {
    const r = await build("quarterly-assessment", exec, data());
    const row = r.sections[1].table!.rows.find((x) => x[0] === "Alpha Unit")!;
    expect(row[2]).toBe("52%");
    expect(String(row[5])).toContain("Unlikely to reach the target");
    expect(row[4]).toBe("medium");
    expect(r.limitations.join(" ")).toContain("Confidence is low under three settled weeks");
  });

  it("a BU Lead's outstanding-activities report holds only their own unit's tasks, even if the data layer leaked another's", async () => {
    const r = await build("outstanding-activities", lead, data());
    const rows = r.sections[1].table!.rows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("SECRET OTHER UNIT TASK");
  });

  it("a BU Lead cannot ask for another unit's report; an executive can", async () => {
    const d = data();
    const denied = await reportById("bu-performance")!.build(ctx(lead, d), { unit: "BRAVO" });
    expect(denied).toHaveProperty("error");
    expect(d.spies.buAnalysis).not.toHaveBeenCalled();
    const ok = await reportById("bu-performance")!.build(ctx(exec, d), { unit: "Bravo Unit" });
    expect(ok).toHaveProperty("report");
  });

  it("says plainly what the data cannot tell, in every report that has a limit", async () => {
    expect((await build("kr-risk", exec, data())).limitations.join(" ")).toContain("no numeric target");
    expect((await build("carried-forward", exec, data())).limitations.join(" ")).toContain("does not record who owns a goal");
    expect((await build("corrective-tracking", exec, data())).limitations.join(" ")).toContain("never on its actions being marked done");
  });

  it("every report builds for an executive from this data without error", async () => {
    for (const def of REPORTS) {
      const res = await def.build(ctx(exec, data()), def.id === "bu-performance" ? { unit: "ALPHA" } : {});
      expect("report" in res, `${def.id}: ${"error" in res ? res.error : ""}`).toBe(true);
    }
  });
});

describe("export", () => {
  it("writes each table with its caption, quotes what needs it, and defuses text a spreadsheet would run as a formula", async () => {
    const r = await build("weekly-org", exec, data());
    r.sections[1].table!.rows.push(["=HYPERLINK(\"http://evil\")", "a,b", "-8", "+5%", null, "", "", ""]);
    const csv = reportCsv(r);
    expect(csv).toContain("Units, week on week");
    expect(csv).toContain("Unit,Score to date,Last week");
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csv).toContain("\"a,b\",-8,+5%");
    expect(csv.split("\r\n")[0]).toBe("Weekly organisational performance report");
  });
});

describe("the optional explanation", () => {
  const report = async () => build("weekly-org", exec, data());
  const units = [A, B];
  const model = (text: string) => vi.fn(async (): Promise<import("../provider").AiResult> => ({ ok: true, text, model: "m", inputTokens: 1, outputTokens: 1, ms: 1, attempts: 1, costUsd: 0 }));

  it("is used when every figure in it is in the report, with names restored", async () => {
    const c = await explainReport({ complete: model("[[BU:ALPHA]] fell by 10 points to 50%, while [[BU:BRAVO]] rose."), units, pseudonymise: true, userId: "e" }, await report());
    expect(c).toMatchObject({ ok: true });
    expect(c.ok && c.text).toContain("Alpha Unit fell by 10 points to 50%");
  });

  it("is dropped when it contains a figure that is not in the report", async () => {
    const c = await explainReport({ complete: model("[[BU:ALPHA]] will recover to 85% next month."), units, pseudonymise: true, userId: "e" }, await report());
    expect(c).toMatchObject({ ok: false, reason: "UNGROUNDED" });
  });

  it("never sends a unit name to the provider when pseudonymising", async () => {
    const complete = model("Nothing notable.");
    await explainReport({ complete, units, pseudonymise: true, userId: "e" }, await report());
    const sent = JSON.stringify((complete.mock.calls[0] as unknown[])[0]);
    expect(sent).not.toMatch(/Alpha Unit|Bravo Unit/);
    expect(sent).toContain("[[BU:ALPHA]]");
  });

  it("reports a provider failure as no commentary, not as an error", async () => {
    const c = await explainReport({ complete: async () => ({ ok: false, reason: "TIMEOUT", message: "The AI provider did not answer in time." }), units, pseudonymise: true, userId: "e" }, await report());
    expect(c).toEqual({ ok: false, reason: "TIMEOUT", message: "The AI provider did not answer in time." });
  });
});
