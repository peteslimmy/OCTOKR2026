import { Suspense } from "react";
import { Badge, Card, CardHeader, DataTable } from "@/components/ui/primitives";
import { getBuIntelligence, getOrgIntelligence } from "@/lib/data/intelligence";
import type { BuIntelligence, GoalOutlook, Outlook, OrgIntelligence, Risk } from "@/lib/insights/bu-intelligence";
import type { UnitAnalysis } from "@/lib/insights/management-brief";

const OUTLOOK: Record<Outlook, { label: string; tone: "done" | "warn" | "critical" | "undefined" }> = {
  ON_TRACK: { label: "On track", tone: "done" }, AT_RISK: { label: "At risk", tone: "warn" }, OFF_TRACK: { label: "Off track", tone: "critical" }, NO_DATA: { label: "Not enough data", tone: "undefined" },
};
const SEVERITY: Record<Risk["severity"], { label: string; tone: "critical" | "warn" | "info" }> = { high: { label: "High", tone: "critical" }, medium: { label: "Medium", tone: "warn" }, low: { label: "Low", tone: "info" } };
const pct = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : `${n.toFixed(d)}%`);

function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => (v === null ? null : [values.length > 1 ? (i / (values.length - 1)) * 76 + 2 : 40, 22 - (v / 100) * 20] as const));
  const path = pts.reduce((d, p, i) => (p ? `${d}${pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : d), "");
  return (
    <svg viewBox="0 0 80 24" className="h-6 w-20 shrink-0" role="img" aria-label={`Weekly completion: ${values.map((v) => (v === null ? "no goals" : `${v.toFixed(0)}%`)).join(", ")}`}>
      <line x1="2" y1="22" x2="78" y2="22" stroke="var(--line)" />
      {path ? <path d={path} fill="none" stroke="var(--brand-700)" strokeWidth="1.75" strokeLinejoin="round" /> : null}
      {pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r="1.8" fill="var(--brand-700)" /> : null))}
    </svg>
  );
}

function Bar({ value, tone }: { value: number | null; tone: "done" | "warn" | "critical" | "undefined" }) {
  const colour = tone === "done" ? "var(--done-fg)" : tone === "warn" ? "#b45309" : tone === "critical" ? "var(--notdone-fg)" : "var(--muted)";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface" role="img" aria-label={`Projected ${pct(value)}`}>
      <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, background: colour }} />
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-lg bg-surface px-3 py-2"><p className="text-xs text-muted">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p>{note ? <p className="text-xs text-muted">{note}</p> : null}</div>;
}

function GoalRow({ g, index }: { g: GoalOutlook; index: number }) {
  const o = OUTLOOK[g.outlook];
  return (
    <li className="space-y-1.5 px-5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 font-medium"><span className="mr-2 font-mono text-xs text-muted">{g.code ?? `BU Goal ${index + 1}`}</span>{g.title}</p>
        <Badge tone={o.tone}>{o.label}</Badge>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1"><Bar value={g.projected} tone={o.tone} /></div>
        <span className="w-24 shrink-0 text-right tabular-nums" title="Where this goal is projected to stand at quarter end">{g.projected === null ? "no forecast" : `${g.projected.toFixed(0)}% by end`}</span>
        <Sparkline values={g.series} />
      </div>
      <p className="text-xs text-muted">{g.note}{g.projected !== null ? ` Confidence: ${g.confidence}.` : ""}</p>
    </li>
  );
}

function RiskList({ risks, limit }: { risks: Risk[]; limit?: number }) {
  const shown = limit ? risks.slice(0, limit) : risks;
  if (!shown.length) return <p className="px-5 py-4 text-sm text-muted">No risks found in the data captured so far.</p>;
  return (
    <ul className="divide-y divide-line">
      {shown.map((r) => (
        <li key={r.id} className="space-y-1 px-5 py-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-medium"><Badge tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Badge>{r.title}</p>
          <p className="text-muted">{r.detail}</p>
          <p className="text-xs"><span className="font-medium">Suggested:</span> {r.action}</p>
        </li>
      ))}
    </ul>
  );
}

const METHOD = [
  "Each unit goal is projected from the share of its weekly goals that were done, week by week. Recent weeks count more, a rising or falling trend is carried forward in part, and a goal with weeks of no activity is held down.",
  "A unit goal is On track at 70% or more projected, At risk from 50%, and Off track below that. The unit is On track only if no goal is Off track.",
  "The quarter score forecast uses the weekly score (the share of goals done), counts a week with no report as zero and shows a range that narrows as weeks pass.",
  "Alignment compares each weekly goal with the unit goal it supports, by the words they share. Risks come from fixed rules over these figures.",
  "These are estimates from the data captured so far, not predictions of outcomes. They improve with more weeks, and no AI model is used.",
];

/** The reason behind the outlook, how the last week moved, how much the unit takes on, how demanding its goals are, and what would change the result. */
function WhyStrip({ a, compact }: { a: UnitAnalysis; compact: boolean }) {
  const lines: { label: string; text: string }[] = [];
  if (a.cause) lines.push({ label: "Main reason", text: `${a.cause.label}. ${a.cause.detail}` });
  if (a.change.last !== null) lines.push({ label: "Last week", text: `${a.change.last.toFixed(0)}% of goals done${a.change.delta === null ? "" : a.change.delta === 0 ? " (unchanged on the week before)" : ` (${a.change.delta > 0 ? "up" : "down"} ${Math.abs(a.change.delta).toFixed(0)} points on the week before)`}.` });
  if (a.capacity.plannedPerWeek !== null) lines.push({ label: "Workload", text: `Plans about ${a.capacity.plannedPerWeek.toFixed(0)} tasks a week and finishes ${a.capacity.donePerWeek?.toFixed(0)} (${pct(a.capacity.ratio)})${a.capacity.overcommitted ? ", which is more than it can finish" : ""}.` });
  if (!compact && a.difficulty.level) lines.push({ label: "Goal difficulty", text: `${a.difficulty.level[0].toUpperCase()}${a.difficulty.level.slice(1)}: ${a.difficulty.tasksPerGoal?.toFixed(1)} tasks a goal, ${pct(a.difficulty.measurablePct)} of goals carry a number${a.difficulty.sandbagging ? ". A near-perfect score from goals this light needs a closer look" : ""}.` });
  if (a.capacity.carryOver.length) lines.push({ label: "Set again, not finished", text: a.capacity.carryOver.slice(0, compact ? 1 : 2).map((c) => `“${c.title.slice(0, 60)}” (${c.weeks} weeks)`).join("; ") });
  if (a.whatIf.finishLatest && a.whatIf.finishLatest.delta > 0) lines.push({ label: "What would help", text: `Finishing last week's open goals adds ${a.whatIf.finishLatest.delta.toFixed(0)} points to the quarter score straight away; every remaining week ten points higher would add ${a.whatIf.lift10?.delta.toFixed(0) ?? "—"}.` });
  if (!lines.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-1.5 border-t border-line px-5 py-3 text-sm sm:grid-cols-[9rem_1fr]">
      {lines.map((l) => (<div key={l.label} className="contents"><dt className="text-muted">{l.label}</dt><dd>{l.text}</dd></div>))}
    </dl>
  );
}

/** Will the unit's quarterly goals be met? Built from the unit's goals, the weekly goals aligned to them and their tasks. */
export function BuIntelligenceCard({ d, quarterLabel, compact = false, analysis }: { d: BuIntelligence; quarterLabel: string; compact?: boolean; analysis?: UnitAnalysis }) {
  const o = OUTLOOK[d.outlook], p = d.prediction, a = d.alignment;
  return (
    <Card>
      <CardHeader title={`${d.unitName} — will the ${quarterLabel} goals be met?`} description={d.headline}
        action={<span className="flex items-center gap-2"><Badge tone={o.tone}>{o.label}</Badge><span className="text-xs text-muted">Quarter {pct(d.progressPct)} elapsed · {d.evidenceWeeks} {d.evidenceWeeks === 1 ? "week" : "weeks"} of evidence</span></span>} />
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Projected quarter score" value={pct(p.projectedQuarterScore)} note={p.range ? `Likely ${p.range[0].toFixed(0)}–${p.range[1].toFixed(0)}% · target ${p.target}%` : `Target ${p.target}%`} />
        <Stat label="Needed each remaining week" value={p.weeksRemaining === 0 ? "—" : p.reachable === false ? "Out of reach" : p.neededWeeklyAverage === null ? "—" : p.neededWeeklyAverage <= 0 ? "Target met" : pct(p.neededWeeklyAverage)}
          note={p.weeksRemaining === 0 ? "Quarter complete" : `${p.weeksRemaining} ${p.weeksRemaining === 1 ? "week" : "weeks"} left to reach ${p.target}%`} />
        <Stat label="Weekly goals aligned to a unit goal" value={pct(a.alignedPct)} note={`${a.aligned} of ${a.weeklyGoals} weekly goals`} />
        <Stat label="Direction" value={p.direction === null ? "Too early" : p.direction === "improving" ? "Improving" : p.direction === "declining" ? "Declining" : "Steady"}
          note={p.expectedGoalsDone === null ? undefined : `About ${p.expectedGoalsDone} weekly goals done by quarter end`} />
      </div>

      {analysis ? <WhyStrip a={analysis} compact={compact} /> : null}

      {d.goals.length ? <ul className="divide-y divide-line border-t border-line">{d.goals.map((g, i) => <GoalRow key={g.id} g={g} index={i} />)}</ul> : null}

      <div className="grid gap-0 border-t border-line lg:grid-cols-2 lg:divide-x lg:divide-line">
        <div>
          <h3 className="px-5 pt-3 text-sm font-semibold">Risks</h3>
          <RiskList risks={d.risks} limit={compact ? 3 : undefined} />
        </div>
        <div className="space-y-2 px-5 py-3 text-sm">
          <h3 className="font-semibold">Do the weekly goals align with the quarterly goals?</h3>
          <p className="text-muted">{a.weeklyGoals === 0 ? "No weekly goals this quarter yet." : `${a.aligned} of ${a.weeklyGoals} weekly goals support a unit goal${a.unaligned ? `; ${a.unaligned} do not.` : "."}`}</p>
          {a.orphaned.length ? <p><span className="font-medium">Unit goals with no weekly goal:</span> <span className="text-muted">{a.orphaned.join("; ")}</span></p> : null}
          {a.concentration ? <p><span className="font-medium">Concentration:</span> <span className="text-muted">{pct(a.concentration.pct)} of aligned effort goes to “{a.concentration.title}”.</span></p> : null}
          {a.weakWording.length ? (
            <div><p className="font-medium">Wording that does not match its unit goal</p>
              <ul className="list-disc pl-5 text-muted">{a.weakWording.slice(0, compact ? 2 : 4).map((w) => <li key={w.goal}>“{w.goal.slice(0, 70)}” → “{w.buGoal.slice(0, 60)}”</li>)}</ul></div>
          ) : null}
          {!compact && a.krCoverage.length ? <p className="flex flex-wrap items-center gap-1.5"><span className="font-medium">Organisation KRs touched:</span>{a.krCoverage.map((k) => <Badge key={k.kr} tone="brand">{k.kr} · {k.goals}</Badge>)}</p> : null}
        </div>
      </div>
      <details className="border-t border-line px-5 py-3 text-xs text-muted">
        <summary className="cursor-pointer text-brand-700 underline">How this is worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{METHOD.map((m) => <li key={m}>{m}</li>)}</ul>
      </details>
    </Card>
  );
}

/** Across the organisation: how many units are on track, where the risk sits and which units have no goals set. */
export function OrgIntelligenceCard({ d, quarterLabel }: { d: OrgIntelligence; quarterLabel: string }) {
  const tile = (label: string, n: number, tone: "done" | "warn" | "critical" | "undefined") => (
    <div className="rounded-lg bg-surface px-3 py-2"><p className="text-xs text-muted">{label}</p><p className="flex items-center gap-2 text-2xl font-semibold tabular-nums">{n}<Badge tone={tone}>{label}</Badge></p></div>
  );
  return (
    <Card>
      <CardHeader title={`Intelligence — will each unit's ${quarterLabel} goals be met?`}
        description={`${d.counts.ON_TRACK} on track, ${d.counts.AT_RISK} at risk, ${d.counts.OFF_TRACK} off track${d.counts.NO_DATA ? `, ${d.counts.NO_DATA} without enough data` : ""}.`}
        action={<a href="/insights" className="text-sm text-brand-700 underline">Open the management brief</a>} />
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
        {tile("On track", d.counts.ON_TRACK, "done")}{tile("At risk", d.counts.AT_RISK, "warn")}{tile("Off track", d.counts.OFF_TRACK, "critical")}{tile("No forecast", d.counts.NO_DATA, "undefined")}
        <Stat label="Average projected quarter score" value={pct(d.averageProjectedQuarter)} note={d.alignedPct === null ? undefined : `${pct(d.alignedPct)} of weekly goals aligned to a unit goal`} />
      </div>
      {d.withoutGoals.length ? <p className="border-t border-line px-5 py-3 text-sm"><span className="font-medium">Units with no goals set for the quarter:</span> <span className="text-muted">{d.withoutGoals.join(", ")}</span></p> : null}
      <div className="border-t border-line">
        <DataTable caption="Outlook by unit" columns={[{ label: "Unit" }, { label: "Outlook" }, { label: "Projected quarter score", align: "right" }, { label: "Aligned", align: "right" }, { label: "Biggest risk" }]}>
          {d.units.map((u) => (
            <tr key={u.businessUnitId} className="border-b border-line last:border-0">
              <td className="font-medium">{u.unitName}</td>
              <td><Badge tone={OUTLOOK[u.outlook].tone}>{OUTLOOK[u.outlook].label}</Badge></td>
              <td className="text-right tabular-nums">{pct(u.prediction.projectedQuarterScore)}</td>
              <td className="text-right tabular-nums">{pct(u.alignment.alignedPct)}</td>
              <td className="text-muted">{u.risks[0]?.title ?? "None found"}</td>
            </tr>
          ))}
        </DataTable>
      </div>
      {d.topRisks.length ? <div className="border-t border-line"><h3 className="px-5 pt-3 text-sm font-semibold">Where the risk is</h3>
        <ul className="divide-y divide-line">{d.topRisks.slice(0, 5).map((r) => (
          <li key={`${r.businessUnitId}-${r.id}`} className="px-5 py-2.5 text-sm"><p className="flex flex-wrap items-center gap-2 font-medium"><Badge tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Badge>{r.unitName}: {r.title}</p><p className="text-muted">{r.detail}</p></li>))}</ul></div> : null}
      <details className="border-t border-line px-5 py-3 text-xs text-muted">
        <summary className="cursor-pointer text-brand-700 underline">How this is worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{METHOD.map((m) => <li key={m}>{m}</li>)}</ul>
      </details>
    </Card>
  );
}

const Skeleton = () => <div className="shimmer h-72 w-full rounded-2xl" role="status" aria-label="Loading intelligence" />;

/** Loads and shows one unit's intelligence in its own loading boundary. */
export function BuIntelligenceSection({ buId, buName, quarterId, compact }: { buId: string; buName: string; quarterId?: string; compact?: boolean }) {
  return <Suspense fallback={<Skeleton />}><BuIntelligenceLoaded buId={buId} buName={buName} quarterId={quarterId} compact={compact} /></Suspense>;
}
async function BuIntelligenceLoaded({ buId, buName, quarterId, compact }: { buId: string; buName: string; quarterId?: string; compact?: boolean }) {
  const r = await getBuIntelligence(buId, buName, quarterId).catch(() => null);
  if (!r) return null;
  return <BuIntelligenceCard d={r.data} quarterLabel={r.quarterLabel} compact={compact} analysis={r.analysis} />;
}
export function OrgIntelligenceSection({ quarterId }: { quarterId?: string }) {
  return <Suspense fallback={<Skeleton />}><OrgIntelligenceLoaded quarterId={quarterId} /></Suspense>;
}
async function OrgIntelligenceLoaded({ quarterId }: { quarterId?: string }) {
  const r = await getOrgIntelligence(quarterId).catch(() => null);
  if (!r) return null;
  return <OrgIntelligenceCard d={r.data} quarterLabel={r.quarterLabel} />;
}
