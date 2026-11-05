import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { NavSelect } from "@/components/ui/nav-select";
import { Badge, Banner, buttonClass, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { can, requireActor } from "@/lib/auth/actor";
import { listQuarters } from "@/lib/data";
import { getExecutiveReport } from "@/lib/data/intelligence";
import type { Outlook } from "@/lib/insights/bu-intelligence";
import { THRESHOLDS, type Basis, type ExecutiveReport, type ForecastClass, type RiskBand, type RiskRow, type UnitView } from "@/lib/insights/executive-report";

export const metadata: Metadata = { title: "Management brief" };

type Tone = "done" | "warn" | "critical" | "info" | "undefined" | "brand";
const OUTLOOK: Record<Outlook, { label: string; tone: Tone }> = { ON_TRACK: { label: "On track", tone: "done" }, AT_RISK: { label: "At risk", tone: "warn" }, OFF_TRACK: { label: "Off track", tone: "critical" }, NO_DATA: { label: "Not enough data", tone: "undefined" } };
const BAND: Record<RiskBand, Tone> = { Low: "done", Moderate: "info", High: "warn", "Very High": "critical", Critical: "critical" };
const BASIS: Record<Basis, { label: string; tone: Tone }> = {
  FACT: { label: "Fact", tone: "done" }, CALCULATED: { label: "Calculated", tone: "info" }, INTERPRETATION: { label: "Interpretation", tone: "brand" },
  FORECAST: { label: "Forecast", tone: "warn" }, HYPOTHESIS: { label: "Hypothesis", tone: "undefined" }, RECOMMENDATION: { label: "Recommendation", tone: "brand" },
};
const FORECAST: Record<ForecastClass, { label: string; tone: Tone }> = {
  exceed: { label: "Likely to exceed", tone: "done" }, achieve: { label: "Likely to achieve", tone: "done" }, intervention: { label: "Achievable with intervention", tone: "warn" },
  unlikely: { label: "Unlikely", tone: "critical" }, none: { label: "Cannot forecast yet", tone: "undefined" },
};
const DIR: Record<UnitView["direction"], { label: string; tone: Tone }> = { improving: { label: "Improving", tone: "done" }, deteriorating: { label: "Deteriorating", tone: "critical" }, stagnant: { label: "Flat", tone: "warn" }, insufficient: { label: "Too few weeks", tone: "undefined" } };
const SECTIONS = ["Executive intelligence summary", "Organisational performance snapshot", "Performance trend and quarterly forecast", "Business units requiring immediate attention", "Detailed business unit analysis",
  "Root cause and organisational patterns", "Repeated, stagnant and unfinished goals", "Enterprise risk matrix", "Top five organisational risks", "Early warning indicators", "Cross-business unit intelligence",
  "Positive performance and recognition", "Management intervention plan", "Executive decisions required", "Data quality, assumptions and limitations"];

const pc = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : `${n.toFixed(d)}%`);
const sg = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(0)}`);

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ quarter?: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "dashboard.executive.view")) return <Card><EmptyState title="The management brief is for executives and administrators" /></Card>;
  const sp = await searchParams;
  const quarters = await listQuarters();
  return (
    <>
      <PageHeader title="Management brief" description="Where the organisation stands, why, what it means for the quarter, what to do and what to decide. Every finding is a fixed rule over recorded data, labelled as fact, calculation, interpretation, forecast, hypothesis or recommendation."
        actions={<><ExecutiveCommentary module="DASHBOARD" subjectLabel="Management brief" /><Link href={sp.quarter ? `/insights/detail?quarter=${sp.quarter}` : "/insights/detail"} className={buttonClass("secondary")}>Unit working tables and action log</Link></>} />
      <Suspense key={sp.quarter ?? "default"} fallback={<div className="space-y-4" role="status" aria-label="Preparing the report"><div className="shimmer h-40 rounded-2xl" /><div className="shimmer h-96 rounded-2xl" /></div>}>
        <Report quarterId={sp.quarter} quarters={quarters.map((q) => ({ id: q.id, label: `Q${q.quarter_number} ${q.year} · ${q.status.toLowerCase()}`, year: q.year, n: q.quarter_number }))} />
      </Suspense>
    </>
  );
}

function Tag({ b }: { b: Basis }) { return <Badge tone={BASIS[b].tone}>{BASIS[b].label}</Badge>; }
function Section({ n, children, description }: { n: number; children: ReactNode; description?: string }) {
  return (
    <section id={`s${n}`} aria-labelledby={`s${n}-h`} className="scroll-mt-20">
      <Card>
        <CardHeader title={<span id={`s${n}-h`}>{n}. {SECTIONS[n - 1]}</span>} description={description} />
        {children}
      </Card>
    </section>
  );
}

async function Report({ quarterId, quarters }: { quarterId?: string; quarters: { id: string; label: string; year: number; n: number }[] }) {
  const r = await getExecutiveReport(quarterId);
  if (!r) return <Card><EmptyState title="No quarter configured" /></Card>;
  const x = r.report;
  if (x.units.length === 0) return <Card><EmptyState title="No reporting units yet">The report appears once units file weekly goals.</EmptyState></Card>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4" role="group" aria-label="Quarter filter">
        <NavSelect id="rep-quarter" label="Quarter" value={r.quarterId} hrefBase="/insights?quarter="
          options={[...quarters].sort((a, b) => b.year - a.year || b.n - a.n).map((q) => ({ value: q.id, group: String(q.year), label: q.label }))} />
        <p className="pb-2 text-sm text-muted">{r.quarterLabel}{x.latestWeek ? ` · based on the weeks settled up to week ${x.latestWeek}` : ""}</p>
      </div>
      <nav aria-label="Report sections" className="rounded-xl border border-line bg-panel px-5 py-3 text-sm">
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">{SECTIONS.map((s, i) => <li key={s}><a href={`#s${i + 1}`} className="text-brand-700 underline">{i + 1}. {s}</a></li>)}</ol>
      </nav>
      <S1 x={x} /><S2 x={x} /><S3 x={x} /><S4 x={x} /><S5 x={x} /><S6 x={x} /><S7 x={x} /><S8 x={x} /><S9 x={x} /><S10 x={x} /><S11 x={x} /><S12 x={x} /><S13 x={x} /><S14 x={x} /><S15 x={x} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- 1
function S1({ x }: { x: ExecutiveReport }) {
  const worst = x.summary.findings.length ? (x.org.counts.OFF_TRACK >= 3 ? "critical" : x.org.masking || x.org.counts.OFF_TRACK + x.org.counts.AT_RISK > 0 ? "warn" : "done") : "info";
  return (
    <Section n={1}>
      <div className="space-y-4 px-6 py-4">
        <Banner tone={worst} title={x.summary.headline} />
        <ul className="space-y-2.5 text-sm">
          {x.summary.findings.map((f, i) => <li key={i} className="flex items-start gap-3"><span className="mt-0.5 w-28 shrink-0"><Tag b={f.basis} /></span><span>{f.text}</span></li>)}
        </ul>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 2
function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}</div>;
}
function S2({ x }: { x: ExecutiveReport }) {
  const o = x.org;
  return (
    <Section n={2} description={o.verdict}>
      <div className="space-y-5 px-6 py-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Actual to date" value={pc(o.actualToDate)} note="Average of units' quarter scores so far; a missed week counts as zero" />
          <Tile label="Reported" value={pc(o.reported)} note="Average of weekly scores on filed weeks only" />
          <Tile label="Forecast at quarter end" value={pc(o.projectedUnweighted)} note={`Unweighted: each unit counts once. Weighted by goals: ${pc(o.projectedWeighted)}. Target ${o.target}%`} />
          <Tile label="Units below target" value={`${o.belowTarget} of ${o.withForecast}`} note={`${o.materiallyBelow} materially below (more than ${THRESHOLDS.materiallyBelow} points under target)`} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="On track" value={`${o.counts.ON_TRACK}`} note={pc(o.units ? (o.counts.ON_TRACK / o.units) * 100 : null) + " of units"} />
          <Tile label="At risk" value={`${o.counts.AT_RISK}`} note={pc(o.units ? (o.counts.AT_RISK / o.units) * 100 : null) + " of units"} />
          <Tile label="Off track" value={`${o.counts.OFF_TRACK}`} note={pc(o.units ? (o.counts.OFF_TRACK / o.units) * 100 : null) + " of units"} />
          <Tile label="Week on week" value={o.weekDelta === null ? "—" : `${sg(o.weekDelta)} pts`} note={o.latestWeek ? `Week ${o.latestWeek} ${pc(o.thisWeek)} against week ${o.previousWeek} ${pc(o.lastWeek)}` : undefined} />
        </div>
        <DataTable caption="How the average is made up" columns={[{ label: "Question" }, { label: "Answer" }, { label: "Kind" }]} maxHeight={null}>
          <tr><td>Is the average weighted?</td><td>Not by default: each unit counts once. The goal-weighted figure is {pc(o.projectedWeighted, 1)}.</td><td><Tag b="CALCULATED" /></td></tr>
          <tr><td>Spread between units</td><td>Median {pc(o.median)}, lowest {o.min ? `${o.min.name} ${o.min.value.toFixed(0)}%` : "—"}, highest {o.max ? `${o.max.name} ${o.max.value.toFixed(0)}%` : "—"}, standard deviation {o.spread === null ? "—" : o.spread.toFixed(0)} points.</td><td><Tag b="CALCULATED" /></td></tr>
          <tr><td>Are strong units masking weak ones?</td><td>{o.masking ? `Yes: the average meets ${o.target}% but ${o.belowTarget} units are below it.` : o.belowTarget ? "The average is below target as well, so weak units are not hidden." : "No unit is below target."}</td><td><Tag b="INTERPRETATION" /></td></tr>
          <tr><td>Improvement still needed</td><td>{o.neededWeekly === null ? "No weeks remain or no forecast." : `About ${pc(o.neededWeekly)} a week for the remaining ${o.weeksRemaining} weeks against a recent ${pc(o.recentWeekly)}${o.stepUp !== null ? ` (${o.stepUp > 0 ? `a step-up of ${o.stepUp.toFixed(0)} points` : "already above what is needed"})` : ""}.`}</td><td><Tag b="FORECAST" /></td></tr>
          <tr><td>Is the target realistically achievable?</td><td>{o.reachable === false ? "No: even 100% in every remaining week would not reach it." : o.stepUp !== null && o.stepUp > 20 ? "Only with a large step-up from recent weeks: unlikely without intervention." : o.stepUp !== null && o.stepUp > 0 ? "Yes, with a moderate step-up from recent weeks." : "Yes, at the recent pace."}</td><td><Tag b="INTERPRETATION" /></td></tr>
        </DataTable>
        <div className="grid gap-4 md:grid-cols-4">
          {([["Improving", o.improving], ["Deteriorating", o.deteriorating], ["Flat", o.stagnant], ["Need executive intervention", o.needsIntervention]] as const).map(([t, l]) => (
            <div key={t}><p className="text-xs font-medium text-muted">{t} ({l.length})</p><p className="mt-1">{l.length ? l.join(", ") : "None"}</p></div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 3
function Chart({ series, target }: { series: { week: number; value: number }[]; target: number }) {
  if (series.length < 2) return <p className="px-6 py-4 text-sm text-muted">At least two settled weeks are needed to draw a trend.</p>;
  const W = 640, H = 170, P = 28;
  const xs = (i: number) => P + (i / (series.length - 1)) * (W - 2 * P), ys = (v: number) => H - P - (v / 100) * (H - 2 * P);
  const pts = series.map((s, i) => `${xs(i).toFixed(1)},${ys(s.value).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Average weekly score by week: ${series.map((s) => `week ${s.week} ${s.value.toFixed(0)}%`).join(", ")}`}>
      {[0, 50, 100].map((v) => <g key={v}><line x1={P} x2={W - P} y1={ys(v)} y2={ys(v)} stroke="var(--line, #e5e7eb)" /><text x={4} y={ys(v) + 4} fontSize="10" fill="currentColor" opacity=".6">{v}</text></g>)}
      <line x1={P} x2={W - P} y1={ys(target)} y2={ys(target)} stroke="var(--done-fg, #166534)" strokeDasharray="5 4" /><text x={W - P} y={ys(target) - 4} fontSize="10" textAnchor="end" fill="var(--done-fg, #166534)">target {target}%</text>
      <polyline points={pts} fill="none" stroke="var(--brand-700, #7a1420)" strokeWidth="2.5" strokeLinejoin="round" />
      {series.map((s, i) => <g key={s.week}><circle cx={xs(i)} cy={ys(s.value)} r="3.5" fill="var(--brand-700, #7a1420)" /><text x={xs(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="currentColor" opacity=".7">W{s.week}</text></g>)}
    </svg>
  );
}
function S3({ x }: { x: ExecutiveReport }) {
  const rows = [...x.units].sort((a, b) => (a.projected ?? 999) - (b.projected ?? 999));
  return (
    <Section n={3} description="Projection method: each unit's recent weeks, weighted towards the latest, plus a damped continuation of its trend, scaled down where weeks are missing. Remaining weeks are filled with that projected level. It is an estimate, not a promise.">
      <div className="space-y-4 pb-2">
        <div className="px-6 pt-2"><p className="mb-1 text-xs font-medium text-muted">Organisation average weekly score (units that filed that week)</p><Chart series={x.org.series} target={x.org.target} /></div>
        <DataTable caption="Quarterly forecast by unit" columns={[{ label: "Unit" }, { label: "To date", align: "right" }, { label: "Target", align: "right" }, { label: "Projected", align: "right" }, { label: "Variance", align: "right" }, { label: "Pts/week", align: "right" }, { label: "Needed/week", align: "right" }, { label: "Step-up", align: "right" }, { label: "Forecast" }, { label: "Confidence" }]} maxHeight="30rem">
          {rows.map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.name}</td><td className="text-right tabular-nums">{pc(u.scoreToDate)}</td><td className="text-right tabular-nums">{u.analysis.intel.prediction.target}%</td>
              <td className="text-right font-medium tabular-nums">{pc(u.projected)}</td><td className="text-right tabular-nums">{sg(u.variance)}</td><td className="text-right tabular-nums">{u.slope === null ? "—" : sg(u.slope)}</td>
              <td className="text-right tabular-nums">{pc(u.needed)}</td><td className="text-right tabular-nums">{u.stepUp === null ? "—" : sg(u.stepUp)}</td>
              <td><Badge tone={FORECAST[u.forecast].tone}>{FORECAST[u.forecast].label}</Badge></td>
              <td className="text-xs text-muted">{u.confidence}{u.confidence === "low" ? " (provisional)" : ""}</td>
            </tr>
          ))}
        </DataTable>
        <p className="px-6 text-xs text-muted">Needed/week is the average weekly score the remaining weeks must reach to land on target; step-up is that minus the unit&apos;s last three weeks. Confidence is low under three settled weeks, medium to five, high from six. Where a unit&apos;s weeks are missing or few, the figure is marked provisional and should not be read as precise.</p>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 4
function S4({ x }: { x: ExecutiveReport }) {
  const hot = x.units.filter((u) => u.outlook === "OFF_TRACK" || u.outlook === "AT_RISK").sort((a, b) => (a.projected ?? 0) - (b.projected ?? 0));
  return (
    <Section n={4}>
      {hot.length === 0 ? <EmptyState title="No unit is at risk or off track" /> : (
        <DataTable caption="Units requiring immediate attention" columns={[{ label: "Unit" }, { label: "Status" }, { label: "Projected", align: "right" }, { label: "Direction" }, { label: "Main cause" }, { label: "What to do first" }]} maxHeight="28rem">
          {hot.map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.name}</td><td><Badge tone={OUTLOOK[u.outlook].tone}>{OUTLOOK[u.outlook].label}</Badge></td><td className="text-right tabular-nums">{pc(u.projected)}</td>
              <td><Badge tone={DIR[u.direction].tone}>{DIR[u.direction].label}</Badge></td>
              <td>{u.cause ? <><span className="font-medium">{u.cause.label}.</span> <span className="text-muted">{u.cause.detail}</span></> : <span className="text-muted">No single cause found</span>}</td>
              <td className="text-muted">{u.stepUp !== null && u.stepUp > 0 ? `Lift the weekly score by about ${u.stepUp.toFixed(0)} points to about ${pc(u.needed)}.` : "Hold the current pace."}{u.analysis.capacity.carryOver[0] ? ` Close or retire “${u.analysis.capacity.carryOver[0].title.slice(0, 50)}”.` : ""}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 5
function strengths(u: UnitView): string[] {
  const out: string[] = [];
  const g = u.analysis.intel.goals.filter((x) => x.outlook === "ON_TRACK");
  if (g.length) out.push(`${plural(g.length, "unit goal")} on track (${g.map((x) => `“${x.title.slice(0, 40)}”`).slice(0, 2).join(", ")}).`);
  if (u.direction === "improving") out.push("Weekly score is rising.");
  if (u.missed === 0 && u.elapsed > 0) out.push("Has filed every settled week.");
  if (u.volatility <= 10 && u.filed >= 4) out.push("Results are steady week to week.");
  if (u.analysis.difficulty.level === "demanding") out.push("Goals are demanding: several tasks and measurable wording.");
  return out;
}
function weaknesses(u: UnitView): string[] {
  const out: string[] = [];
  const g = u.analysis.intel.goals.filter((x) => x.outlook === "OFF_TRACK" || x.outlook === "NO_DATA");
  if (g.length) out.push(`${plural(g.length, "unit goal")} off track or unsupported (${g.map((x) => `“${x.title.slice(0, 40)}”`).slice(0, 2).join(", ")}).`);
  if (u.taskCompletion !== null && u.goalCompletion !== null && u.taskCompletion - u.goalCompletion >= THRESHOLDS.tasksOverGoals && u.goalsTotal >= 6) out.push(`Activity without outcome: ${pc(u.taskCompletion)} of tasks done but ${pc(u.goalCompletion)} of goals.`);
  if (u.analysis.capacity.carryOver.length) out.push(`${plural(u.analysis.capacity.carryOver.length, "goal")} set repeatedly without closing.`);
  if (u.missed > 0) out.push(`${plural(u.missed, "week")} with no report, each scored zero.`);
  if (u.analysis.capacity.overcommitted) out.push("Plans far more than it finishes.");
  if (u.analysis.difficulty.level === "light") out.push("Goals are light or loosely measured.");
  if (u.volatility >= THRESHOLDS.volatilitySd) out.push(`Volatile results (${u.volatility.toFixed(0)}-point spread).`);
  return out;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-xs text-muted">too few weeks</span>;
  const W = 120, H = 28, step = W / (values.length - 1);
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-32" role="img" aria-label={`Weekly scores: ${values.map((v) => `${v.toFixed(0)}%`).join(", ")}`}><polyline fill="none" stroke="var(--brand-700, #7a1420)" strokeWidth="2" points={values.map((v, i) => `${(i * step).toFixed(1)},${(H - 3 - (v / 100) * (H - 6)).toFixed(1)}`).join(" ")} /></svg>;
}
function S5({ x }: { x: ExecutiveReport }) {
  const sorted = [...x.units].sort((a, b) => (a.projected ?? 999) - (b.projected ?? 999));
  return (
    <Section n={5} description="Every unit, not only those at risk. The weakest are open first.">
      <div className="divide-y divide-line">
        {sorted.map((u, i) => {
          const s = strengths(u), w = weaknesses(u), repeated = x.repeated.filter((r) => r.unitId === u.id);
          return (
            <details key={u.id} open={i < 3 && u.outlook !== "ON_TRACK"} className="group px-6 py-3 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                <span className="font-semibold">{u.name}</span><Badge tone={OUTLOOK[u.outlook].tone}>{OUTLOOK[u.outlook].label}</Badge><Badge tone={DIR[u.direction].tone}>{DIR[u.direction].label}</Badge>
                <span className="tabular-nums text-muted">projected {pc(u.projected)} · last week {pc(u.last)} ({sg(u.delta)})</span><Spark values={u.series} />
              </summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">A. Position <Tag b="CALCULATED" /></p>
                  <p>Score to date {pc(u.scoreToDate)}; target {u.analysis.intel.prediction.target}%; projected {pc(u.projected)} ({sg(u.variance)} points). Previous week {pc(u.previous)}, last week {pc(u.last)}. {plural(u.filed, "week")} filed of {u.elapsed} settled{u.missed ? `, ${u.missed} missed` : ""}. Confidence {u.confidence}.</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">C. Trend and trajectory <Tag b="INTERPRETATION" /></p>
                  <p>{u.direction === "insufficient" ? "Fewer than three weeks: no trend can be stated." : `${DIR[u.direction].label}. ${u.slope === null ? "" : `Slope ${sg(u.slope)} points a week. `}Weekly spread ${u.volatility.toFixed(0)} points; largest one-week swing ${u.maxSwing.toFixed(0)}.${u.stagnationRun >= 2 ? ` Flat for ${u.stagnationRun} weeks below target.` : ""} `}
                    {u.projected !== null && u.projected < THRESHOLDS.target ? (u.stepUp !== null && u.stepUp > 0 ? `If the pace holds the unit ends near ${pc(u.projected)}; it needs about ${pc(u.needed)} a week, ${u.stepUp.toFixed(0)} points above its recent ${pc(u.recentAvg)}.` : `If the pace holds the unit ends near ${pc(u.projected)}.`) : "If the pace holds the unit meets target."}</p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">B. Diagnosis <Tag b="INTERPRETATION" /></p>
                  <p>Activity against outcome: {pc(u.taskCompletion)} of tasks done, {pc(u.goalCompletion)} of goals closed over {u.goalsTotal} goals. {u.taskCompletion !== null && u.goalCompletion !== null && u.taskCompletion - u.goalCompletion >= THRESHOLDS.tasksOverGoals ? "Tasks are being completed without the goals closing: effort is not turning into outcomes." : "Tasks and goals move together."}</p>
                  {u.analysis.intel.goals.length ? <ul className="list-disc pl-5 text-xs text-muted">{u.analysis.intel.goals.slice(0, 4).map((g) => <li key={g.id}>“{g.title.slice(0, 60)}”: {OUTLOOK[g.outlook].label.toLowerCase()}, projected {pc(g.projected)}, {g.weeklyGoals} weekly goals.</li>)}</ul> : <p className="text-xs text-muted">No unit goals set for this quarter.</p>}
                  {repeated.length ? <p className="text-xs">Repeated: {repeated.slice(0, 2).map((r) => `“${r.title.slice(0, 45)}” (${r.classification.toLowerCase()}, ${r.weeksUnfinished} weeks)`).join("; ")}.</p> : null}
                </div>
                <div className="lg:col-span-2 grid gap-3 sm:grid-cols-4">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">D. Does well</p>{s.length ? <ul className="mt-1 list-disc pl-5">{s.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="mt-1 text-muted">Nothing stands out yet.</p>}</div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Does poorly</p>{w.length ? <ul className="mt-1 list-disc pl-5">{w.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="mt-1 text-muted">Nothing serious found.</p>}</div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Main weakness and risk</p><p className="mt-1">{u.cause ? `${u.cause.label}. ${u.cause.detail}` : "No single main weakness."}</p>{u.analysis.integrity.level !== "ok" ? <p className="mt-1 text-xs">Score reliability: {u.analysis.integrity.flags.join("; ")}.</p> : null}</div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Attention and action <Tag b="RECOMMENDATION" /></p><p className="mt-1">{u.outlook === "ON_TRACK" ? "Routine monitoring." : u.outlook === "OFF_TRACK" ? "Executive attention this week." : "BU Lead recovery plan this cycle."} {u.cause ? `Start with ${u.cause.label.toLowerCase()}.` : ""}</p></div>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 6
function S6({ x }: { x: ExecutiveReport }) {
  return (
    <Section n={6} description="Patterns across units, with what the data confirms kept apart from what only seems plausible.">
      <div className="divide-y divide-line">
        {x.patterns.map((p) => (
          <details key={p.id} open={p.scope === "Organisation-wide"} className="px-6 py-3 text-sm">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="font-semibold">{p.id} · {p.title}</span>
              <Badge tone={p.scope === "Organisation-wide" ? "critical" : p.scope === "Unit-level" ? "warn" : "undefined"}>{p.scope}</Badge><span className="text-muted">{p.frequency}</span>
            </summary>
            {p.units.length === 0 ? <p className="mt-2 text-muted">Not detected in this quarter: {p.description.toLowerCase()}</p> : (
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="space-y-2"><p>{p.description}</p><p className="text-xs font-semibold uppercase tracking-wide text-muted">Evidence <Tag b="FACT" /></p>
                  <ul className="list-disc pl-5">{p.evidence.map((e) => <li key={e.unit}><span className="font-medium">{e.unit}:</span> {e.text}</li>)}</ul></div>
                <div className="space-y-2">
                  <p><span className="text-xs font-semibold uppercase tracking-wide text-muted">Root cause </span><Badge tone={p.rootCause.status === "Confirmed from the data" ? "done" : "undefined"}>{p.rootCause.status}</Badge><br />{p.rootCause.text}</p>
                  <p><span className="text-xs font-semibold uppercase tracking-wide text-muted">If unresolved </span><Tag b="INTERPRETATION" /><br />{p.consequence}</p>
                  <p><span className="text-xs font-semibold uppercase tracking-wide text-muted">Intervention </span><Tag b="RECOMMENDATION" /><br />{p.intervention}</p>
                </div>
              </div>
            )}
          </details>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 7
function S7({ x }: { x: ExecutiveReport }) {
  const tone: Record<string, Tone> = { "Potentially abandoned": "critical", "Stagnant goal": "critical", "Repeatedly rolled-over goal": "warn", "Poorly defined goal": "warn", "Delayed execution": "info" };
  return (
    <Section n={7} description="Goals matched by wording across weeks. A goal that runs longer is not automatically a failure: the classification weighs recorded task progress and how the goal is written. Goal owner, creation date and original due date are not recorded by the application.">
      {x.repeated.length === 0 ? <EmptyState title="No goal has been left unfinished in two or more weeks" /> : (
        <DataTable caption="Repeated, stagnant and unfinished goals" columns={[{ label: "Unit" }, { label: "Goal" }, { label: "Weeks set" }, { label: "Unfinished", align: "right" }, { label: "Task progress", align: "right" }, { label: "Classification" }, { label: "Why" }, { label: "Refs" }]} maxHeight="34rem">
          {x.repeated.map((r) => (
            <tr key={r.unitId + r.title}>
              <td className="font-medium whitespace-nowrap">{r.unit}</td><td className="max-w-xs">“{r.title.slice(0, 110)}”</td><td className="whitespace-nowrap">wk {r.first}–{r.last}</td>
              <td className="text-right tabular-nums">{r.weeksUnfinished} of {r.weeksSet}</td><td className="text-right tabular-nums">{pc(r.progressPct)}</td>
              <td><Badge tone={tone[r.classification]}>{r.classification}</Badge></td><td className="text-muted">{r.why}</td><td className="font-mono text-xs text-muted">{r.refs.join(" ")}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <div className="px-6 py-4 text-sm">
        <p className="mb-1 font-medium">Themes across units <Tag b="INTERPRETATION" /></p>
        {x.themes.length === 0 ? <p className="text-muted">No wording theme recurs in the unfinished goals of three or more units.</p> : (
          <ul className="space-y-1.5">{x.themes.map((t) => <li key={t.theme}><span className="font-medium">“{t.theme}”</span> appears in unfinished goals of {t.units.length} units ({list(t.units)}), for example “{t.examples[0]}”. Several units repeatedly setting goals on the same subject without finishing may point to a shared capability or governance problem: <Badge tone="undefined">Hypothesis, needs validation</Badge></li>)}</ul>
        )}
      </div>
    </Section>
  );
}
const list = (a: string[], max = 4) => (a.length <= max ? a.join(", ") : `${a.slice(0, max).join(", ")} and ${a.length - max} more`);

// ---------------------------------------------------------------------------------------------- 8
function Matrix({ risks }: { risks: RiskRow[] }) {
  const cell = (l: number, i: number) => risks.filter((r) => r.residualLikelihood === l && r.impact === i);
  const colour = (s: number) => (s >= 20 ? "bg-[var(--critical-bg)]" : s >= 15 ? "bg-[var(--critical-bg)]" : s >= 10 ? "bg-[var(--warn-bg)]" : s >= 5 ? "bg-[var(--info-bg)]" : "bg-[var(--done-bg)]");
  return (
    <div className="overflow-x-auto px-6 py-4">
      <div className="inline-grid grid-cols-[auto_repeat(5,minmax(4.5rem,1fr))] gap-1 text-xs" role="table" aria-label="Residual risk matrix: likelihood against impact">
        {[5, 4, 3, 2, 1].map((l) => (
          <div key={l} className="contents" role="row">
            <div className="flex items-center pr-2 text-muted" role="rowheader">L{l} {["Rare", "Unlikely", "Possible", "Likely", "Almost certain"][l - 1]}</div>
            {[1, 2, 3, 4, 5].map((i) => <div key={i} role="cell" className={`min-h-12 rounded-md border border-line p-1 ${colour(l * i)}`}><span className="text-[10px] text-ink">{l * i}</span><div className="flex flex-wrap gap-0.5">{cell(l, i).map((r) => <span key={r.id} className="rounded bg-panel px-1 font-mono text-[10px]" title={r.title}>{r.id}</span>)}</div></div>)}
          </div>
        ))}
        <div />{[1, 2, 3, 4, 5].map((i) => <div key={i} className="pt-1 text-center text-muted">I{i} {["Insignificant", "Minor", "Moderate", "Major", "Severe"][i - 1]}</div>)}
      </div>
      <p className="mt-2 text-xs text-muted">Residual risk placed by likelihood and impact. Bands (proposed, not an approved policy): 1–4 Low, 5–9 Moderate, 10–14 High, 15–19 Very High, 20–25 Critical.</p>
    </div>
  );
}
function RiskDetail({ r }: { r: RiskRow }) {
  const f = (k: string, v: ReactNode) => <div><dt className="text-xs text-muted">{k}</dt><dd>{v}</dd></div>;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {f("Description", r.description)}{f("Evidence", r.evidence)}{f("Business consequence", r.consequence)}
      {f("Likelihood × impact", `${r.likelihood} × ${r.impact} = ${r.inherent} inherent`)}{f("Existing controls", r.controls)}{f("Control effectiveness", r.effectiveness)}
      {f("Residual", `${r.residualLikelihood} × ${r.impact} = ${r.residual} (${r.band})`)}{f("Velocity", r.velocity)}{f("Affected units", r.units.join(", ") || "—")}
      {f("Risk owner", r.owner)}{f("Mitigation", r.mitigation)}{f("Escalation trigger", r.trigger)}{f("Target resolution", r.resolution)}{f("Status", r.status)}{f("Basis of rating", `${r.basis}${r.provisional ? " Provisional: needs management validation." : ""}`)}
    </dl>
  );
}
function S8({ x }: { x: ExecutiveReport }) {
  return (
    <Section n={8} description="Likelihood and impact use the 1 to 5 scales you set out. Each rating shows the rule behind it. Owners and resolution dates are not recorded in the application, so none is invented.">
      {x.risks.length === 0 ? <EmptyState title="No significant risk identified" /> : (
        <>
          <Matrix risks={x.risks} />
          <div className="divide-y divide-line border-t border-line">
            {x.risks.map((r) => (
              <details key={r.id} className="px-6 py-3 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                  <span className="font-mono text-xs">{r.id}</span><span className="font-medium">{r.title}</span><Badge tone={BAND[r.band]}>{r.band} {r.residual}</Badge><Badge tone="undefined">{r.category}</Badge>
                  <span className="text-muted">{r.velocity} · {r.status}{r.provisional ? " · provisional" : ""}</span>
                </summary>
                <div className="mt-3"><RiskDetail r={r} /></div>
              </details>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 9
function S9({ x }: { x: ExecutiveReport }) {
  return (
    <Section n={9}>
      <ol className="divide-y divide-line">
        {x.topRisks.map((r, i) => (
          <li key={r.id} className="space-y-1 px-6 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{i + 1}. {r.title}</span><Badge tone={BAND[r.band]}>{r.band} {r.residual}</Badge><span className="font-mono text-xs text-muted">{r.id}</span></p>
            <p><span className="text-muted">Why it matters: </span>{r.description} {r.evidence}</p>
            <p><span className="text-muted">If management does nothing: </span>{r.consequence}</p>
            <p><span className="text-muted">Decision or intervention: </span>{r.mitigation}</p>
          </li>
        ))}
      </ol>
      {x.collective.length ? (
        <div className="border-t border-line px-6 py-3 text-sm"><p className="mb-1 font-medium">Individually moderate, collectively serious <Tag b="INTERPRETATION" /></p>
          <ul className="list-disc pl-5">{x.collective.map((c) => <li key={c.category}>{c.note} Units: {list(c.units)}.</li>)}</ul></div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 10
function S10({ x }: { x: ExecutiveReport }) {
  return (
    <Section n={10} description="Thresholds are proposed. The application has no approved early-warning policy, so they need management approval.">
      <DataTable caption="Early warning indicators" columns={[{ label: "Indicator" }, { label: "Warning" }, { label: "Escalation" }, { label: "Currently" }, { label: "Affected units" }, { label: "Response" }]} maxHeight="36rem">
        {x.indicators.map((i) => (
          <tr key={i.id}>
            <td><p className="font-medium">{i.id} · {i.title}</p><p className="text-xs text-muted">{i.description}</p></td><td className="whitespace-nowrap">{i.warning}</td><td className="whitespace-nowrap">{i.escalation}</td><td className="text-muted">{i.observed}</td>
            <td>{i.affected.length ? <ul className="space-y-0.5">{i.affected.map((a) => <li key={a.unit}><Badge tone={a.level === "escalate" ? "critical" : "warn"}>{a.level === "escalate" ? "Escalate" : "Warning"}</Badge> {a.unit}: {a.value}</li>)}</ul> : <span className="text-muted">None</span>}</td>
            <td className="text-muted">{i.response}</td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 11
function S11({ x }: { x: ExecutiveReport }) {
  const c = x.cross;
  return (
    <Section n={11}>
      <div className="grid gap-5 px-6 py-4 text-sm lg:grid-cols-2">
        <div className="space-y-1.5"><p className="font-medium">Common challenges <Tag b="CALCULATED" /></p>
          {c.causes.length ? <ul className="list-disc pl-5">{c.causes.map((k) => <li key={k.label}><span className="font-medium">{k.label}</span>: {k.units.length} {k.units.length === 1 ? "unit" : "units"} ({list(k.units)}).</li>)}</ul> : <p className="text-muted">No unit has a single main cause.</p>}</div>
        <div className="space-y-1.5"><p className="font-medium">Where action belongs <Tag b="INTERPRETATION" /></p>
          <p className="text-xs text-muted">Organisation-wide action (a third or more of units):</p>{c.systemic.length ? <ul className="list-disc pl-5">{c.systemic.map((s) => <li key={s}>{s}</li>)}</ul> : <p>None.</p>}
          <p className="text-xs text-muted">Individual unit action:</p>{c.individual.length ? <ul className="list-disc pl-5">{c.individual.map((s) => <li key={s}>{s}</li>)}</ul> : <p>None.</p>}</div>
        <div className="space-y-1.5"><p className="font-medium">Consistent underperformers <Tag b="FACT" /></p><p>{c.underperformers.length ? `${list(c.underperformers)}: projected below ${THRESHOLDS.intervention}% after four or more filed weeks and not improving.` : "No unit meets that description."}</p>
          <p className="font-medium">Fastest improving <Tag b="CALCULATED" /></p><p>{c.fastest.length ? c.fastest.map((f) => `${f.name} (+${f.delta.toFixed(0)} points)`).join(", ") : "No unit has improved by more than 8 points."}</p></div>
        <div className="space-y-1.5"><p className="font-medium">What stronger units do differently <Tag b="CALCULATED" /></p>
          {c.practices.length ? <DataTable caption="Practices of units at target compared with others" columns={[{ label: "Measure" }, { label: "At target", align: "right" }, { label: "Others", align: "right" }]} maxHeight={null}>
            {c.practices.map((p) => <tr key={p.measure}><td>{p.measure}</td><td className="text-right tabular-nums">{p.top}</td><td className="text-right tabular-nums">{p.others}</td></tr>)}</DataTable> : null}
          <p className="text-xs text-muted">{c.practicesNote}</p></div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 12
function S12({ x }: { x: ExecutiveReport }) {
  return (
    <Section n={12}>
      {x.positives.length === 0 ? <EmptyState title="No sustained improvement to report yet">One strong week is not counted as improvement; a unit needs at least three settled weeks and two rises in a row.</EmptyState> : (
        <ul className="divide-y divide-line">
          {x.positives.map((p) => (
            <li key={p.unit + p.kind} className="space-y-0.5 px-6 py-3 text-sm">
              <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.unit}</span><Badge tone={p.kind === "One-week movement" ? "warn" : "done"}>{p.kind}</Badge></p>
              <p>{p.text}</p><p className="text-muted"><Tag b="INTERPRETATION" /> {p.sustainable}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 13
function S13({ x }: { x: ExecutiveReport }) {
  const tiers: [ExecutiveReport["actions"][number]["tier"], string][] = [["Immediate", "Executive attention required"], ["Short-term", "Corrective intervention in this reporting cycle"], ["Medium-term", "Structural improvement"]];
  const tone = { Critical: "critical", High: "warn", Medium: "info", Low: "undefined" } as const;
  return (
    <Section n={13} description="Recommendations only: none of them has been approved. Owners and deadlines are suggestions; the application records neither.">
      {tiers.map(([t, label]) => {
        const rows = x.actions.filter((a) => a.tier === t);
        if (!rows.length) return null;
        return (
          <div key={t} className="border-b border-line last:border-0">
            <p className="bg-surface px-6 py-2 text-sm font-semibold">{t}: {label}</p>
            <DataTable caption={`${t} actions`} columns={[{ label: "Priority" }, { label: "Finding and evidence" }, { label: "Action" }, { label: "Outcome and measure" }, { label: "Owner and deadline" }, { label: "Escalate when" }]} maxHeight={null}>
              {rows.map((a, i) => (
                <tr key={i}>
                  <td><Badge tone={tone[a.priority]}>{a.priority}</Badge></td><td><p className="font-medium">{a.finding}</p><p className="text-xs text-muted">{a.evidence}</p></td><td>{a.action}</td>
                  <td><p>{a.outcome}</p><p className="text-xs text-muted">Measure: {a.measure}</p></td><td><p>{a.owner}</p><p className="text-xs text-muted">{a.deadline}</p></td><td className="text-muted">{a.escalation}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        );
      })}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 14
function S14({ x }: { x: ExecutiveReport }) {
  return (
    <Section n={14} description="Proposed for decision. None of these has been decided; recommendations are marked as such.">
      {x.decisions.length === 0 ? <EmptyState title="No decision beyond routine monitoring is needed" /> : (
        <ol className="divide-y divide-line">
          {x.decisions.map((d, i) => (
            <li key={i} className="space-y-1 px-6 py-3 text-sm">
              <p className="font-semibold">{i + 1}. {d.decision}</p>
              <p><span className="text-muted">Why: </span>{d.why}</p><p><span className="text-muted">Evidence: </span>{d.evidence}</p>
              <p><span className="text-muted">If not decided: </span>{d.ifNot}</p><p><Tag b="RECOMMENDATION" /> {d.position}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------- 15
function S15({ x }: { x: ExecutiveReport }) {
  const tone = { Agrees: "done", Differs: "warn", "Not checkable": "undefined" } as const;
  return (
    <Section n={15}>
      <div className="space-y-4 px-6 py-4 text-sm">
        <div><p className="mb-1 font-medium">Checks on the numbers <Tag b="CALCULATED" /></p>
          <ul className="space-y-1.5">{x.quality.checks.map((c) => <li key={c.check} className="flex items-start gap-3"><span className="w-28 shrink-0"><Badge tone={tone[c.result]}>{c.result}</Badge></span><span><span className="font-medium">{c.check}.</span> {c.detail}</span></li>)}</ul></div>
        <div><p className="mb-1 font-medium">Limits of the data</p><ul className="list-disc space-y-1 pl-5">{x.quality.limitations.map((l) => <li key={l}>{l}</li>)}</ul></div>
        <div><p className="mb-1 font-medium">Assumptions and methods</p><ul className="list-disc space-y-1 pl-5">{x.quality.assumptions.map((l) => <li key={l}>{l}</li>)}</ul></div>
      </div>
    </Section>
  );
}
