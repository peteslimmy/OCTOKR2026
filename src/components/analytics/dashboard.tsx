"use client";

import clsx from "clsx";
import { AlertTriangle, Building2, CalendarRange, CheckCircle2, Clock, Download, FileCheck2, Gauge, ListChecks, Search, SlidersHorizontal, XCircle } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RangeSlider } from "@/components/motion/range-slider";
import { Reveal, Stagger } from "@/components/motion/reveal";
import { Segmented } from "@/components/motion/segmented";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced";
import { byUnit, byWeek, elapsed, totals, trendOf, unitsCsv, type Cell } from "@/lib/analytics";
import { formatPercent } from "@/lib/format";
import { csvEscape } from "@/lib/reports/sanitize";
import { ChartTooltip, HEAT_METRICS, IntensityHeatmap, Panel, PopoverButton, ProgressList, StatCard, type HeatMetric } from "./widgets";

// The 3D scenes load only when asked for (and only in the browser), so the dashboard stays quick to open.
const Columns3D = dynamic(() => import("./three/columns3d"), { ssr: false, loading: () => <div className="shimmer h-[420px] w-full rounded-xl" aria-hidden /> });
const Donut3D = dynamic(() => import("./three/donut3d"), { ssr: false, loading: () => <div className="shimmer h-[300px] w-full rounded-xl" aria-hidden /> });

const DONE = "#15803d", NOT_DONE = "#c2410c", UNMARKED = "#64748b";
const PRIMARY = "var(--brand-600)", SLATE = "#475569";
const LINES = ["var(--brand-600)", "#475569", "#2563eb", "#b45309", "#0f766e", "#7c3aed", "#be185d", "#0891b2"];
const num = (v: number | null, digits = 0) => (v === null ? "—" : v.toLocaleString("en-NG", { maximumFractionDigits: digits }));
const p1 = (v: number | null) => (v === null ? "—" : formatPercent(v));

type Kind = "ALL" | "BU" | "DEPT";
type ActivityTab = "tasks" | "scores" | "reporting";
type SortKey = "rank" | "name" | "tasksTotal" | "completion" | "avgScore" | "onTimeRate" | "missingWeeks";

/** Red through amber to green by weekly score; grey when there is no score yet. Never the only signal: the tooltip and tables carry the number. */
function scoreColour(score: number | null): string {
  if (score === null) return "#cbd5e1";
  const t = Math.max(0, Math.min(100, score)) / 100;
  const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
  const [r, g, b] = t < 0.5 ? [lerp(185, 217, t * 2), lerp(28, 119, t * 2), lerp(28, 6, t * 2)] : [lerp(217, 21, (t - 0.5) * 2), lerp(119, 128, (t - 0.5) * 2), lerp(6, 61, (t - 0.5) * 2)];
  return `rgb(${r}, ${g}, ${b})`;
}

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 12, fill: "#6b7280" } } as const;
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

export function AnalyticsDashboard({ cells, nowIso, quarterLabel }: { cells: Cell[]; nowIso: string; quarterLabel: string }) {
  const started = useMemo(() => elapsed(cells, nowIso), [cells, nowIso]);
  const weekList = useMemo(() => byWeek(started), [started]);
  const units = useMemo(() => byUnit(cells), [cells]);
  const reduce = usePrefersReducedMotion();

  const [kind, setKind] = useState<Kind>("ALL");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.max(0, weekList.length - 1));
  const [drill, setDrill] = useState<string | null>(null);
  const [heat, setHeat] = useState<HeatMetric>("score");
  const [tab, setTab] = useState<ActivityTab>("tasks");
  const [hiddenLines, setHiddenLines] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const [showTable, setShowTable] = useState(false);

  const lo = Math.min(from, to), hi = Math.max(from, to);
  const range = weekList.slice(lo, hi + 1).map((w) => w.weekId);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => started.filter((c) =>
    range.includes(c.weekId) && (kind === "ALL" || (kind === "BU" ? c.reportsWeekly : !c.reportsWeekly)) && (picked.length === 0 || picked.includes(c.businessUnitId))
    && (!q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [started, kind, picked, from, to, weekList, q]);

  const t = useMemo(() => totals(filtered), [filtered]);
  const perUnit = useMemo(() => byUnit(filtered), [filtered]);
  const perWeek = useMemo(() => byWeek(filtered), [filtered]);
  const pickable = units.filter((u) => kind === "ALL" || (kind === "BU" ? u.reportsWeekly : !u.reportsWeekly));
  const drillUnit = drill ? perUnit.find((u) => u.id === drill) ?? null : null;
  const drillCells = drill ? filtered.filter((c) => c.businessUnitId === drill).sort((a, b) => a.weekStart.localeCompare(b.weekStart)) : [];

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
  const weeksLabel = (i: number) => weekList[i]?.label ?? "";

  // trends: the last week in view against the one before it
  // a week that has produced nothing yet (still open, or empty) is left out, so a quiet current week never reads as a collapse
  const hasData = (w: (typeof perWeek)[number]) => w.tasksTotal > 0 || w.scoredWeeks > 0;
  const series = (pick: (w: (typeof perWeek)[number]) => number | null) => perWeek.map((w) => (hasData(w) ? pick(w) : null));
  const trends = {
    total: trendOf(series((w) => w.tasksTotal), "relative"), done: trendOf(series((w) => w.tasksDone), "relative"), notDone: trendOf(series((w) => w.tasksNotDone), "relative"),
    score: trendOf(series((w) => w.avgScore), "points"), onTime: trendOf(series((w) => w.onTimeRate), "points"), missing: trendOf(series((w) => w.missingWeeks), "relative"),
  };

  const statusData = [{ name: "Done", value: t.tasksDone, color: DONE }, { name: "Not done", value: t.tasksNotDone, color: NOT_DONE }, { name: "Not yet marked", value: t.tasksUndefined, color: UNMARKED }];
  const reportingUnits = perUnit.filter((u) => u.reportsWeekly);
  const activity = perWeek.map((w) => ({ week: w.label, start: w.weekStart, "Tasks done": hasData(w) ? w.tasksDone : null, "Tasks not done": hasData(w) ? w.tasksNotDone : null, "Completion": w.completion === null ? null : Number(w.completion.toFixed(1)), "Average score": w.avgScore === null ? null : Number(w.avgScore.toFixed(1)), "On-time reports": w.onTimeRate === null ? null : Number(w.onTimeRate.toFixed(1)) }));
  const scoreRows = perWeek.map((w) => {
    const row: Record<string, string | number | null> = { week: w.label, start: w.weekStart };
    for (const u of reportingUnits.slice(0, 8)) row[u.name] = filtered.find((x) => x.weekId === w.weekId && x.businessUnitId === u.id)?.score ?? null;
    return row;
  });
  const weekTitle = (label: string) => { const w = perWeek.find((x) => x.label === label); return w ? `Week ${label.slice(1)} · ${shortDate(w.weekStart)}` : label; };

  const sorted = [...perUnit].map((u, i) => ({ ...u, rank: i + 1 })).sort((a, b) => {
    const av = sort.key === "name" ? a.name.toLowerCase() : (a[sort.key] ?? -1), bv = sort.key === "name" ? b.name.toLowerCase() : (b[sort.key] ?? -1);
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" || key === "rank" ? 1 : -1 }));

  const download = () => {
    const blob = new Blob([unitsCsv(perUnit, csvEscape)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `units-${quarterLabel.replace(" ", "-")}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- 3D scenes: the same rows, laid out as columns
  const tasks3d = perUnit.map((u, i) => ({
    key: u.id, unitId: u.id, label: u.name, col: 0, row: i, detail: `${u.tasksDone} done · ${u.tasksNotDone} not done · ${u.tasksUndefined} not yet marked`,
    segments: [{ name: "Done", value: u.tasksDone, color: DONE }, { name: "Not done", value: u.tasksNotDone, color: NOT_DONE }, { name: "Not yet marked", value: u.tasksUndefined, color: UNMARKED }],
  }));
  const maxTasks = Math.max(1, ...perUnit.map((u) => u.tasksTotal));
  const landscape = reportingUnits.flatMap((u, row) => perWeek.map((w, col) => {
    const score = filtered.find((x) => x.weekId === w.weekId && x.businessUnitId === u.id)?.score ?? null;
    return { key: `${u.id}|${w.weekId}`, unitId: u.id, label: `${u.name} · ${w.label}`, col, row, detail: score === null ? "Not scored yet" : `Score ${score.toFixed(1)}%`, segments: [{ name: "Score", value: score ?? 0, color: scoreColour(score) }] };
  }));

  const toggleUnit = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const filtersActive = picked.length > 0 || kind !== "ALL" || !!q || lo !== 0 || hi !== weekList.length - 1;
  const reset = () => { setKind("ALL"); setPicked([]); setQuery(""); setDrill(null); setFrom(0); setTo(Math.max(0, weekList.length - 1)); };

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
          <PopoverButton label={`${periodFrom?.label ?? ""} – ${periodTo?.label ?? ""}`} icon={<CalendarRange className="h-4 w-4" aria-hidden />}>
            <p className="mb-3 text-sm font-semibold">Weeks in {quarterLabel}</p>
            <RangeSlider label="Weeks" min={0} max={Math.max(0, weekList.length - 1)} from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} format={weeksLabel} />
            <p className="mt-3 text-xs text-muted">{periodText}</p>
          </PopoverButton>
          <button type="button" onClick={download} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line bg-panel px-3.5 text-sm font-medium shadow-sm hover:bg-surface"><Download className="h-4 w-4" aria-hidden />Export</button>
          <PopoverButton label="Filters" active={filtersActive} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />}>
            <p className="mb-2 text-sm font-semibold">Show</p>
            <Segmented label="Show" size="sm" value={kind} onChange={(k) => { setKind(k); setPicked([]); setDrill(null); }} options={[{ value: "ALL", label: "All units" }, { value: "BU", label: "Business Units" }, { value: "DEPT", label: "Departments" }]} />
            <p className="mt-4 mb-2 text-sm font-semibold">Units</p>
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
      <Stagger className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ListChecks} label="Total tasks" value={t.tasksTotal} trend={trends.total} footer={`${periodText} · ${num(t.goalsTotal)} goals`} />
        <StatCard icon={CheckCircle2} label="Tasks done" value={t.tasksDone} trend={trends.done} footer={`${p1(t.completion)} of all tasks · ${periodText}`} />
        <StatCard icon={XCircle} label="Tasks not done" value={t.tasksNotDone} trend={trends.notDone} footer={`${num(t.tasksUndefined)} not yet marked`} />
        <StatCard icon={Gauge} label="Average weekly score" value={t.avgScore} kind="percent" trend={trends.score} trendMode="points" footer={`${t.scoredWeeks} scored unit-weeks`} />
        <StatCard icon={FileCheck2} label="Reports submitted" value={`${num(t.submittedWeeks)} / ${num(t.reportableWeeks)}`} footer="unit-weeks that required a report" />
        <StatCard icon={Clock} label="Submitted on time" value={t.onTimeRate} kind="percent" trend={trends.onTime} trendMode="points" footer="before the content lock" />
        <StatCard icon={AlertTriangle} label="Missing reports" value={t.missingWeeks} trend={trends.missing} footer="recorded non-compliant" />
        <StatCard icon={Building2} label="Units shown" value={perUnit.length} footer={`${perUnit.filter((u) => u.reportsWeekly).length} Business Units · ${perUnit.filter((u) => !u.reportsWeekly).length} Departments`} />
      </Stagger>

      {/* ---------------------------------------------------------------- heat map and activity */}
      <div className="grid gap-4 [&>*]:min-w-0 xl:grid-cols-5">
        <Reveal className="xl:col-span-2">
          <Panel title="Units by week" subtitle="Each square is one unit in one week." labelledBy="hm-h" className="h-full"
            action={<Segmented size="sm" label="Measure" value={heat} onChange={setHeat} options={HEAT_METRICS} />}>
            <IntensityHeatmap cells={filtered} weeks={perWeek} units={perUnit} metric={heat} onUnit={setDrill} />
          </Panel>
        </Reveal>

        <Reveal className="xl:col-span-3" delay={0.05}>
          <Panel title="Activity" subtitle="Organisation-wide, week by week." labelledBy="act-h" className="h-full"
            action={<Segmented size="sm" label="Chart" value={tab} onChange={setTab} options={[{ value: "tasks", label: "Tasks" }, { value: "scores", label: "Scores" }, { value: "reporting", label: "Reporting" }]} />}
            menu={[{ label: "Download CSV", onClick: download }, { label: showTable ? "Hide table" : "View as table", onClick: () => setShowTable((v) => !v) }]}>
            {tab === "tasks" ? (
              activity.every((r) => !r["Tasks done"] && !r["Tasks not done"]) ? <p className="py-16 text-center text-sm text-muted">No tasks recorded for this selection yet.</p> : (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={activity} margin={{ left: -12, right: 12, top: 8 }} role="img" aria-label="Area chart of tasks done and not done each week">
                    <CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="week" {...axis} /><YAxis allowDecimals={false} {...axis} />
                    <Tooltip content={<ChartTooltip title={weekTitle} />} cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }} />
                    <Legend iconType="circle" iconSize={10} align="right" verticalAlign="top" height={32} />
                    <Area type="monotone" dataKey="Tasks not done" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.14} strokeWidth={2} dot={{ r: 3.5, fill: "#94a3b8", strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }} />
                    <Area type="monotone" dataKey="Tasks done" stroke={PRIMARY} fill={PRIMARY} fillOpacity={0.12} strokeWidth={2.5} dot={{ r: 4.5, fill: PRIMARY, strokeWidth: 0 }} activeDot={{ r: 7, strokeWidth: 2, stroke: "#fff" }} />
                  </AreaChart>
                </ResponsiveContainer>
              )
            ) : tab === "scores" ? (
              reportingUnits.length === 0 || scoreRows.every((r) => reportingUnits.slice(0, 8).every((u) => r[u.name] === null)) ? <p className="py-16 text-center text-sm text-muted">No scored weeks in this selection yet.</p> : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={scoreRows} margin={{ left: -12, right: 12, top: 8 }} role="img" aria-label="Line chart of weekly score for each Business Unit">
                    <CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="week" {...axis} /><YAxis domain={[0, 100]} unit="%" {...axis} />
                    <Tooltip content={<ChartTooltip title={weekTitle} format={(v) => `${v.toFixed(1)}%`} />} cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }} />
                    <Legend iconType="circle" iconSize={8} onClick={(e) => { const k = String(e.dataKey); setHiddenLines((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k])); }} />
                    {reportingUnits.slice(0, 8).map((u, i) => <Line key={u.id} type="monotone" dataKey={u.name} stroke={LINES[i % LINES.length]} strokeWidth={2.25} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} hide={hiddenLines.includes(u.name)} connectNulls />)}
                  </LineChart>
                </ResponsiveContainer>
              )
            ) : (
              activity.every((r) => r.Completion === null && r["Average score"] === null) ? <p className="py-16 text-center text-sm text-muted">Nothing to compare yet.</p> : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={activity} margin={{ left: -12, right: 12, top: 8 }} role="img" aria-label="Weekly completion rate, average score and on-time reports">
                    <CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="week" {...axis} /><YAxis domain={[0, 100]} unit="%" {...axis} />
                    <Tooltip content={<ChartTooltip title={weekTitle} format={(v) => `${v.toFixed(1)}%`} />} cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }} />
                    <Legend iconType="circle" iconSize={8} />
                    <Area type="monotone" dataKey="Completion" stroke={DONE} fill={DONE} fillOpacity={0.12} strokeWidth={2.25} dot={false} />
                    <Line type="monotone" dataKey="Average score" stroke={PRIMARY} strokeWidth={2.25} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
                    <Line type="monotone" dataKey="On-time reports" stroke={SLATE} strokeWidth={2.25} strokeDasharray="5 4" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            )}
            {showTable ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs"><caption className="sr-only">Weekly figures behind the chart</caption>
                  <thead><tr className="text-muted"><th scope="col" className="py-1 pr-3 font-medium">Week</th>{["Tasks done", "Tasks not done", "Completion", "Average score", "On-time reports"].map((h) => <th key={h} scope="col" className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
                  <tbody>{activity.map((r) => <tr key={r.week} className="border-t border-line"><th scope="row" className="py-1 pr-3 font-medium">{r.week}</th><td className="pr-3 tabular-nums">{r["Tasks done"]}</td><td className="pr-3 tabular-nums">{r["Tasks not done"]}</td><td className="pr-3 tabular-nums">{r.Completion ?? "—"}</td><td className="pr-3 tabular-nums">{r["Average score"] ?? "—"}</td><td className="tabular-nums">{r["On-time reports"] ?? "—"}</td></tr>)}</tbody>
                </table>
              </div>
            ) : null}
          </Panel>
        </Reveal>
      </div>

      {/* ---------------------------------------------------------------- ranking table and completion list */}
      <div className="grid gap-4 [&>*]:min-w-0 xl:grid-cols-3">
        <Reveal className="xl:col-span-2">
          <Panel title="Top units" subtitle="Ranked by average weekly score. Tick units to focus the whole dashboard on them." labelledBy="tu-h" className="h-full"
            menu={[{ label: "Download CSV", onClick: download }]}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <caption className="sr-only">Business Units and Departments compared on tasks, completion, score and reporting</caption>
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="w-8 pb-2"><span className="sr-only">Focus on this unit</span></th>
                    {([["name", "Unit"], [null, "Type"], ["tasksTotal", "Tasks"], [null, "Done"], ["completion", "Completion"], ["avgScore", "Avg score"], ["onTimeRate", "On time"], ["missingWeeks", "Missing"]] as [SortKey | null, string][]).map(([k, h]) => (
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
                      <td className="pr-3 tabular-nums">{u.reportsWeekly ? p1(u.avgScore) : "n/a"}</td>
                      <td className="pr-3 tabular-nums">{u.reportsWeekly ? p1(u.onTimeRate) : "n/a"}</td>
                      <td className="tabular-nums">{u.reportsWeekly ? num(u.missingWeeks) : "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </Reveal>

        <Reveal delay={0.05}>
          <Panel title="Completion by unit" subtitle="Share of tasks marked done." labelledBy="cu-h" className="h-full">
            <div className="mb-5 flex items-end justify-between gap-3">
              <p className="text-4xl font-semibold tracking-tight tabular-nums">{t.completion === null ? "—" : <>{t.completion.toFixed(1).split(".")[0]}<span className="text-muted">.{t.completion.toFixed(1).split(".")[1]}%</span></>}</p>
              <p className="pb-1 text-xs text-muted">{num(t.tasksDone)} of {num(t.tasksTotal)} tasks</p>
            </div>
            {perUnit.length === 0 ? <p className="py-8 text-center text-sm text-muted">No units match.</p> : (
              <ProgressList onPick={setDrill} rows={perUnit.map((u) => ({ id: u.id, code: u.code, name: u.name, value: u.completion, sub: u.reportsWeekly ? `${num(u.tasksDone)} of ${num(u.tasksTotal)} tasks · score ${p1(u.avgScore)}` : "Department · no weekly report" }))} />
            )}
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

      {/* ---------------------------------------------------------------- 3D explorer */}
      <Reveal>
        <Panel title="Explore in 3D" subtitle="Drag to rotate, scroll to zoom, hover for detail, click a column to open that unit. The tables above hold the same figures." labelledBy="3d-h">
          {t.tasksTotal === 0 && landscape.length === 0 ? <p className="py-10 text-center text-sm text-muted">Nothing to draw yet.</p> : (
            <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="mb-2 text-sm font-medium">Tasks by unit</p>
                {t.tasksTotal === 0 ? <p className="py-10 text-center text-sm text-muted">No tasks recorded for this selection yet.</p> : (
                  <Columns3D bars={tasks3d} cols={[""]} rows={perUnit.map((u) => u.code)} max={maxTasks} barSize={1.1} gap={1.7} onSelect={setDrill} reduceMotion={reduce}
                    ariaLabel="3D stacked columns of done, not done and unmarked tasks for each unit. The table of units above lists the same figures." />
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Task status</p>
                {t.tasksTotal === 0 ? <p className="py-10 text-center text-sm text-muted">No tasks yet.</p> : (
                  <Donut3D slices={statusData} centre={p1(t.completion)} reduceMotion={reduce} ariaLabel={`3D ring of task status: ${t.tasksDone} done, ${t.tasksNotDone} not done, ${t.tasksUndefined} not yet marked`} />
                )}
              </div>
              {landscape.length > 0 ? (
                <div className="lg:col-span-3">
                  <p className="mb-2 text-sm font-medium">Score landscape <span className="font-normal text-muted">— one column per Business Unit per week; height is the weekly score</span></p>
                  <Columns3D bars={landscape} cols={perWeek.map((w) => w.label)} rows={reportingUnits.map((u) => u.name)} max={100} barSize={0.8} gap={1.25} onSelect={setDrill} reduceMotion={reduce}
                    ariaLabel="3D landscape of weekly scores: one column per Business Unit per week. The units by week grid above lists the same scores." />
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </Reveal>
    </section>
  );
}
