"use client";

import clsx from "clsx";
import { CalendarRange, Clock, Download, FileCheck2, ListChecks, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Reveal, Stagger } from "@/components/motion/reveal";
import { byUnit, byWeek, elapsed, totals, trendOf, trendSeries, unitsCsv, type Cell, type TrendBy, type TrendCell } from "@/lib/analytics";
import { formatPercent } from "@/lib/format";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { csvEscape } from "@/lib/reports/sanitize";
import { ChartTooltip, Panel, PerformanceCard, PopoverButton, SummaryCard } from "./widgets";

const DONE = "#15803d", NOT_DONE = "#c2410c", UNMARKED = "#64748b";
const PRIMARY = "var(--brand-600)";
const num = (v: number | null, digits = 0) => (v === null ? "—" : v.toLocaleString("en-NG", { maximumFractionDigits: digits }));
const p1 = (v: number | null) => (v === null ? "—" : formatPercent(v));

type Kind = "ALL" | "BU" | "DEPT";
type SortKey = "name" | "tasksTotal" | "completion" | "goalsTotal" | "goalCompletion" | "avgScoreToDate";

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 12, fill: "#6b7280" } } as const;
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

export function AnalyticsDashboard({ cells, history, quarterKey, nowIso, quarterLabel }: { cells: Cell[]; history: TrendCell[]; quarterKey: string; nowIso: string; quarterLabel: string }) {
  const started = useMemo(() => elapsed(cells, nowIso), [cells, nowIso]);
  const weekList = useMemo(() => byWeek(started), [started]);
  const units = useMemo(() => byUnit(cells), [cells]);

  const [kind, setKind] = useState<Kind>("ALL");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  // the figures are for one week: the latest that has any, or the whole quarter
  const latestWithData = (() => { for (let i = weekList.length - 1; i >= 0; i--) if (weekList[i].tasksTotal > 0 || weekList[i].scoredWeeks > 0) return i; return Math.max(0, weekList.length - 1); })();
  const [pickedWeek, setPickedWeek] = useState<number | "all">(latestWithData);
  const [drill, setDrill] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const lo = pickedWeek === "all" ? 0 : Math.min(pickedWeek, Math.max(0, weekList.length - 1)), hi = pickedWeek === "all" ? Math.max(0, weekList.length - 1) : lo;
  const range = weekList.slice(lo, hi + 1).map((w) => w.weekId);
  const q = query.trim().toLowerCase();
  // every week, for the charts that show weeks side by side; `filtered` is the chosen week (or the whole quarter) for the figures and the unit table
  const filteredAll = useMemo(() => started.filter((c) =>
    (kind === "ALL" || (kind === "BU" ? c.reportsWeekly : !c.reportsWeekly)) && (picked.length === 0 || picked.includes(c.businessUnitId))
    && (!q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)),
  ), [started, kind, picked, q]);
  const filtered = useMemo(() => filteredAll.filter((c) => range.includes(c.weekId)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [filteredAll, lo, hi]);

  const t = useMemo(() => totals(filtered), [filtered]);
  const perUnit = useMemo(() => byUnit(filtered), [filtered]);
  const perWeek = useMemo(() => byWeek(filteredAll), [filteredAll]);
  const pickable = units.filter((u) => kind === "ALL" || (kind === "BU" ? u.reportsWeekly : !u.reportsWeekly));
  const drillUnit = drill ? perUnit.find((u) => u.id === drill) ?? null : null;
  const drillCells = drill ? filteredAll.filter((c) => c.businessUnitId === drill).sort((a, b) => a.weekStart.localeCompare(b.weekStart)) : [];

  if (cells.length === 0) {
    return (
      <section aria-labelledby="an-h" className="rounded-2xl border border-line bg-panel p-6">
        <h2 id="an-h" className="text-lg font-semibold">Execution analytics</h2>
        <p className="mt-2 text-sm text-muted">No reporting weeks exist for {quarterLabel} yet. Once a quarter is active, every unit&apos;s tasks, scores and compliance appear here.</p>
      </section>
    );
  }

  const periodFrom = weekList[lo], periodTo = weekList[hi];
  const periodText = periodFrom && periodTo ? `From ${shortDate(periodFrom.weekStart)} – ${shortDate(new Date(new Date(periodTo.weekStart).getTime() + 6 * 864e5).toISOString())}` : quarterLabel;
  // the full wording of a week, the same everywhere: "Week 44, 26 Oct – 1 Nov 2026"
  const scopeText = pickedWeek === "all" ? `Whole quarter, ${quarterLabel}` : "The chosen week";
  const fullWeek = (i: number) => (weekList[i] ? formatWeekLabel({ week_number: Number(weekList[i].label.slice(1)), week_start_at: weekList[i].weekStart }) : "");


  // trends: the last week in view against the one before it
  // a week that has produced nothing yet (still open, or empty) is left out, so a quiet current week never reads as a collapse
  const hasData = (w: (typeof perWeek)[number]) => w.tasksTotal > 0 || w.scoredWeeks > 0;
  const series = (pick: (w: (typeof perWeek)[number]) => number | null) => perWeek.slice(0, hi + 1).map((w) => (hasData(w) ? pick(w) : null));
  const trends = {
    goals: trendOf(series((w) => w.goalsTotal), "relative"), total: trendOf(series((w) => w.tasksTotal), "relative"), done: trendOf(series((w) => w.tasksDone), "relative"), notDone: trendOf(series((w) => w.tasksNotDone), "relative"),
    score: trendOf(series((w) => w.avgScore), "points"), onTime: trendOf(series((w) => w.onTimeRate), "points"), missing: trendOf(series((w) => w.missingWeeks), "relative"),
  };

  const weekTitle = (label: string) => { const w = perWeek.find((x) => x.label === label); return w ? `Week ${label.slice(1)} · ${shortDate(w.weekStart)}` : label; };

  const sorted = [...perUnit].map((u) => ({ ...u, goalCompletion: u.goalsTotal ? (u.goalsDone / u.goalsTotal) * 100 : null })).sort((a, b) => {
    const av = sort.key === "name" ? a.name.toLowerCase() : (a[sort.key] ?? -1), bv = sort.key === "name" ? b.name.toLowerCase() : (b[sort.key] ?? -1);
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }));

  const download = () => {
    const blob = new Blob([unitsCsv(perUnit, csvEscape)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `units-${quarterLabel.replace(" ", "-")}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  const toggleUnit = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const filtersActive = picked.length > 0 || kind !== "ALL" || !!q;
  const reset = () => { setKind("ALL"); setPicked([]); setQuery(""); setDrill(null); };

  return (
    <section aria-labelledby="an-h" className="space-y-5">
      <h2 id="an-h" className="sr-only">Execution analytics — {quarterLabel}</h2>

      {/* ---------------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Dashboard controls">
        <label className="relative min-w-52 flex-1 sm:max-w-sm">
          <span className="sr-only">Search units</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search units…" className="min-h-10 w-full rounded-xl border border-line bg-panel pr-3 pl-10 text-sm shadow-sm placeholder:text-muted" />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative inline-flex items-center">
            <span className="sr-only">Week</span>
            <CalendarRange className="pointer-events-none absolute left-3.5 h-4 w-4" aria-hidden />
            <select value={pickedWeek === "all" ? "all" : String(lo)} onChange={(e) => setPickedWeek(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="min-h-10 max-w-[22rem] rounded-xl border border-line bg-panel pr-3 pl-10 text-sm font-medium shadow-sm hover:bg-surface">
              {weekList.map((_, i) => <option key={i} value={i}>{fullWeek(i)}</option>)}
              <option value="all">All weeks · {quarterLabel}</option>
            </select>
          </label>
          <button type="button" onClick={download} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line bg-panel px-3.5 text-sm font-medium shadow-sm hover:bg-surface"><Download className="h-4 w-4" aria-hidden />Export</button>
          <PopoverButton label="Filters" active={filtersActive} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />}>
            <p className="mb-2 text-sm font-semibold">Units</p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label="Units">
              {pickable.map((u) => (
                <button key={u.id} type="button" aria-pressed={picked.includes(u.id)} onClick={() => toggleUnit(u.id)}
                  className={clsx("rounded-full border px-3 py-1 text-xs", picked.includes(u.id) ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel hover:bg-surface")}>{u.name}{!u.reportsWeekly ? " · Dept" : ""}</button>
              ))}
            </div>
            {filtersActive ? <button type="button" onClick={reset} className="mt-4 text-sm text-brand-700 underline">Reset filters</button> : null}
          </PopoverButton>
        </div>
      </div>

      {/* ---------------------------------------------------------------- figures */}
      <Stagger className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-3">
        <SummaryCard icon={ListChecks} kicker="Total tasks" subtitle={scopeText} value={t.tasksTotal} unit="tasks" trend={trends.total} periodIcon={Clock} period={periodText} periodStrong={`${num(t.goalsTotal)} goals`}
          tiles={[{ label: "Tasks done", value: t.tasksDone, note: `${p1(t.completion)} of all tasks`, dot: "good" }, { label: "Tasks not done", value: t.tasksNotDone, note: `${num(t.tasksUndefined)} not yet marked`, dot: "warn" }]} />
        <SummaryCard icon={FileCheck2} kicker="Total goals" subtitle={scopeText} value={t.goalsTotal} unit="goals" trend={trends.goals} periodIcon={CalendarRange} period={periodText} periodStrong={`${num(t.tasksTotal)} tasks`}
          tiles={[{ label: "Goals done", value: t.goalsDone, note: `${p1(t.goalsTotal ? (t.goalsDone / t.goalsTotal) * 100 : null)} of all goals`, dot: "muted", emphasis: t.goalsDone === 0 ? "muted" : undefined },
            { label: "Goals not done", value: t.goalsNotDone, note: `${num(Math.max(0, t.goalsTotal - t.goalsDone - t.goalsNotDone))} still open`, dot: "bad", emphasis: t.goalsNotDone > 0 ? "bad" : "muted" }]} />
        <PerformanceCard tasks={t.completion} goals={t.goalsTotal ? (t.goalsDone / t.goalsTotal) * 100 : null} units={perUnit.filter((u) => u.tasksTotal > 0 || u.goalsTotal > 0).length} target={70} subtitle={scopeText}
          tasksOf={[t.tasksDone, t.tasksTotal]} goalsOf={[t.goalsDone, t.goalsTotal]} />
      </Stagger>

      {/* ---------------------------------------------------------------- organisation performance, week on week */}
      <Reveal>
        <OrgTrend history={history} quarterKey={quarterKey} nowIso={nowIso} units={perUnit} weekTitle={weekTitle} />
      </Reveal>

      {/* ---------------------------------------------------------------- units table */}
      <div className="grid gap-4 [&>*]:min-w-0">
        <Reveal>
          <Panel title="Units" subtitle="Tasks, weekly goals and average score for each unit in the period shown. Tick units to focus the whole dashboard on them." labelledBy="tu-h" className="h-full"
            menu={[{ label: "Download CSV", onClick: download }]}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <caption className="sr-only">Business Units and Departments compared on tasks, weekly goals and average score</caption>
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="w-8 pb-2"><span className="sr-only">Focus on this unit</span></th>
                    {([["name", "Unit"], [null, "Type"], ["tasksTotal", "Tasks"], [null, "Done"], ["completion", "Task completion"], ["goalsTotal", "Goals"], [null, "Goals done"], ["goalCompletion", "Goal completion"], ["avgScoreToDate", "Avg score"]] as [SortKey | null, string][]).map(([k, h]) => (
                      <th key={h} scope="col" aria-sort={k && sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined} className="pb-2 pr-3 font-medium">
                        {k ? <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 hover:text-ink">{h}<span aria-hidden>{sort.key === k ? (sort.dir === 1 ? "↑" : "↓") : ""}</span></button> : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((u) => (
                    <tr key={u.id} className={clsx("border-t border-line hover:bg-surface/70", drill === u.id && "bg-brand-50")}>
                      <td className="py-3"><input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggleUnit(u.id)} aria-label={`Focus on ${u.name}`} className="h-4 w-4 rounded border-line accent-[var(--brand-700)]" /></td>
                      <th scope="row" className="py-3 pr-3 font-medium"><button type="button" onClick={() => setDrill(drill === u.id ? null : u.id)} aria-pressed={drill === u.id} className="text-left hover:underline">{u.name}</button></th>
                      <td className="pr-3 text-muted">{u.reportsWeekly ? "Business Unit" : "Department"}</td>
                      <td className="pr-3 tabular-nums">{num(u.tasksTotal)}</td>
                      <td className="pr-3 tabular-nums text-[var(--done-fg)]">{num(u.tasksDone)}</td>
                      <td className="pr-3 tabular-nums">{p1(u.completion)}</td>
                      <td className="pr-3 tabular-nums">{num(u.goalsTotal)}</td>
                      <td className="pr-3 tabular-nums text-[var(--done-fg)]">{num(u.goalsDone)}</td>
                      <td className="pr-3 tabular-nums">{p1(u.goalCompletion)}</td>
                      <td className="tabular-nums">{u.reportsWeekly ? p1(u.avgScoreToDate) : "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </Reveal>

      </div>

      {/* ---------------------------------------------------------------- drill-down */}
      {drillUnit ? (
        <Panel title={`${drillUnit.name} — week by week`} subtitle={drillUnit.reportsWeekly ? "Tasks and score for each week." : "This Department is not required to file weekly reports."} labelledBy="dr-h"
          action={<button type="button" className="text-sm text-brand-700 underline" onClick={() => setDrill(null)}>Close</button>}>
          <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={drillCells.map((c) => ({ week: `W${c.weekNumber}`, Done: c.tasksDone, "Not done": c.tasksNotDone, "Not yet marked": c.tasksUndefined, Score: c.score }))} role="img" aria-label={`Tasks and score by week for ${drillUnit.name}`}>
                <CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="week" {...axis} /><YAxis yAxisId="l" allowDecimals={false} {...axis} /><YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" {...axis} />
                <Tooltip content={<ChartTooltip />} /><Legend iconType="circle" iconSize={8} />
                <Bar yAxisId="l" dataKey="Done" stackId="a" fill={DONE} /><Bar yAxisId="l" dataKey="Not done" stackId="a" fill={NOT_DONE} /><Bar yAxisId="l" dataKey="Not yet marked" stackId="a" fill={UNMARKED} />
                <Line yAxisId="r" type="monotone" dataKey="Score" stroke={PRIMARY} strokeWidth={2.25} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <ul className="divide-y divide-line text-sm" aria-label={`Weeks for ${drillUnit.name}`}>
              {drillCells.map((c) => (
                <li key={c.weekId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium">Week {c.weekNumber}</span>
                  <span className="text-muted">{c.holiday ? "Organisation holiday" : !c.reportsWeekly ? "Not required" : `${c.tasksDone}/${c.tasksTotal} tasks · ${c.score === null ? "not scored yet" : p1(c.score)}`}</span>
                  {c.reportId ? <Link href={`/weekly/${c.reportId}`} className="text-brand-700 underline">Open report</Link> : null}
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      ) : null}
    </section>
  );
}


/** The whole organisation's performance week on week, with a filter that narrows it to one Business Unit or Department. */
const TREND_BY: { value: TrendBy; label: string }[] = [{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }];
function OrgTrend({ history, quarterKey, nowIso, units, weekTitle }: { history: TrendCell[]; quarterKey: string; nowIso: string; units: { id: string; name: string }[]; weekTitle: (label: string) => string }) {
  const [unitId, setUnitId] = useState("all");
  const [by, setBy] = useState<TrendBy>("week");
  const points = useMemo(() => trendSeries(history, by, nowIso, unitId, quarterKey), [history, by, nowIso, unitId, quarterKey]);
  const rows = points.map((p) => ({ week: p.label, "Task completion": p.tasks === null ? null : Number(p.tasks.toFixed(1)), "Goals completion": p.goals === null ? null : Number(p.goals.toFixed(1)) }));
  const name = unitId === "all" ? "the whole organisation" : units.find((u) => u.id === unitId)?.name ?? "";
  const per = by === "week" ? "week" : by;
  return (
    <Panel title="Performance week on week" subtitle={`Average ${per === "week" ? "weekly" : per === "month" ? "monthly" : per === "quarter" ? "quarterly" : "yearly"} task completion against goals completion for ${name}: the average of each unit's completion rate. ${by === "week" ? "Weeks of this quarter." : "Across every quarter so far."}`} labelledBy="ot-h"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Group the weeks by" className="inline-flex overflow-hidden rounded-lg border border-line">
            {TREND_BY.map((o) => (
              <button key={o.value} type="button" aria-pressed={by === o.value} onClick={() => setBy(o.value)}
                className={clsx("px-3 py-1.5 text-sm", by === o.value ? "bg-brand-700 font-medium text-white" : "bg-panel text-ink hover:bg-surface")}>{o.label}</button>
            ))}
          </div>
          <label htmlFor="ot-unit" className="sr-only">Show</label>
          <select id="ot-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} className="min-w-44 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-ink focus:border-brand-700">
            <option value="all">Whole organisation</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      }>
      {rows.length === 0 ? <p className="py-16 text-center text-sm text-muted">No weeks with tasks or goals for this selection yet.</p> : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={rows} margin={{ left: -12, right: 12, top: 8 }} role="img" aria-label={`Line chart of task completion against goals completion by ${by} for ${name}`}>
            <CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="week" {...axis} /><YAxis domain={[0, 100]} unit="%" {...axis} />
            <Tooltip content={<ChartTooltip title={(l) => (by === "week" ? weekTitle(l) : l)} format={(v) => `${v.toFixed(1)}%`} />} cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }} />
            <Legend iconType="circle" iconSize={8} />
            <Line type="monotone" dataKey="Task completion" stroke={DONE} strokeWidth={2.75} dot={{ r: 3, strokeWidth: 0, fill: DONE }} activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }} connectNulls={false} />
            <Line type="monotone" dataKey="Goals completion" stroke={PRIMARY} strokeWidth={2.75} dot={{ r: 3, strokeWidth: 0, fill: PRIMARY }} activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
