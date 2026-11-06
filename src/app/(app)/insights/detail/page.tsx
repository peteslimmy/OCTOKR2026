import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NavSelect } from "@/components/ui/nav-select";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listQuarters } from "@/lib/data";
import { getManagementBrief } from "@/lib/data/intelligence";
import type { Outlook, Severity } from "@/lib/insights/bu-intelligence";
import type { BriefItem, ManagementBrief, UnitAnalysis } from "@/lib/insights/management-brief";
import { LogActionButton } from "../log-action-button";

export const metadata: Metadata = { title: "Unit working tables" };

const OUTLOOK: Record<Outlook, { label: string; tone: "done" | "warn" | "critical" | "undefined" }> = {
  ON_TRACK: { label: "On track", tone: "done" }, AT_RISK: { label: "At risk", tone: "warn" }, OFF_TRACK: { label: "Off track", tone: "critical" }, NO_DATA: { label: "Not enough data", tone: "undefined" },
};
const SEV: Record<Severity | "good", { label: string; tone: "critical" | "warn" | "info" | "done" }> = { high: { label: "Act", tone: "critical" }, medium: { label: "Watch", tone: "warn" }, low: { label: "Note", tone: "info" }, good: { label: "Good news", tone: "done" } };
const GROUPS: [BriefItem["kind"][], string][] = [
  [["summary"], "Where we stand"], [["attention"], "Units that need attention"], [["integrity"], "Scores to check"], [["capacity", "carry-over"], "Capacity and repeated goals"],
  [["coverage"], "Strategy coverage"], [["decision"], "Waiting for a decision"], [["win"], "Worth recognising"],
];
const pct = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : `${n.toFixed(d)}%`);
const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(0)}`);

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ quarter?: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "dashboard.executive.view")) return <Card><EmptyState title="The unit working tables are for executives and administrators">Each Business Unit Lead sees their own unit&apos;s outlook on the weekly page.</EmptyState></Card>;
  const sp = await searchParams;
  const quarters = await listQuarters();
  return (
    <>
      <PageHeader title="Unit working tables" description="Who needs help and why, whether the scores can be trusted, whether units are over-committed, whether the strategy is covered, and what is waiting for a decision. The tables behind the management brief, and where actions taken on a unit are logged. Fixed rules over the data captured; no AI." actions={<Link href={sp.quarter ? `/insights?quarter=${sp.quarter}` : "/insights"} className={buttonClass("primary")}>Back to the management brief</Link>} />
      <Suspense key={sp.quarter ?? "default"} fallback={<div className="space-y-4" role="status" aria-label="Loading the brief"><div className="shimmer h-48 rounded-2xl" /><div className="shimmer h-72 rounded-2xl" /></div>}>
        <Brief quarterId={sp.quarter} quarters={quarters.map((q) => ({ id: q.id, label: `Q${q.quarter_number} ${q.year} · ${q.status.toLowerCase()}`, year: q.year, n: q.quarter_number }))} />
      </Suspense>
    </>
  );
}

async function Brief({ quarterId, quarters }: { quarterId?: string; quarters: { id: string; label: string; year: number; n: number }[] }) {
  const r = await getManagementBrief(quarterId);
  if (!r) return <Card><EmptyState title="No quarter configured" /></Card>;
  const b = r.brief;
  return (
    <div className="space-y-6">
      <div role="group" aria-label="Quarter filter">
        <NavSelect id="brief-quarter" label="Quarter" value={r.quarterId} hrefBase="/insights/detail?quarter="
          options={[...quarters].sort((x, y) => y.year - x.year || y.n - x.n).map((q) => ({ value: q.id, group: String(q.year), label: q.label }))} />
      </div>
      <BriefItems items={b.items} quarterLabel={r.quarterLabel} latestWeek={b.latestWeek} />
      <Attention b={b} quarterId={r.quarterId} />
      <Integrity units={b.units} />
      <Capacity units={b.units} />
      <Coverage b={b} />
      <Governance b={b} />
      <Actions b={b} />
      <details className="rounded-xl border border-line bg-panel px-5 py-3 text-xs text-muted">
        <summary className="cursor-pointer text-sm text-brand-700 underline">How these are worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Outlook, forecast and risks: see the unit card. A unit is On track at 70% or more projected, At risk from 50%, Off track below. A week still in progress is not counted.</li>
          <li>Cause: the first of these that applies — no unit goals, weeks without a report, taking on more than it finishes (under 55% of planned tasks finished), tasks done but goals not closing, weekly goals not tied to unit goals, results falling, loosely written goals.</li>
          <li>Goal difficulty: light (about two tasks or fewer a goal, or few goals with numbers), demanding (3.5 or more tasks and most goals with numbers) or normal. A near-perfect score from light goals is flagged.</li>
          <li>Score checks: tasks marked in the last two hours before the final lock, tasks corrected after the lock, and reports submitted after the content lock. A flag is a reason to look, not a finding.</li>
          <li>Peers: units are grouped small, medium or large by how many tasks they plan a week and compared within the group.</li>
          <li>What-if: the projected quarter score if the latest week&apos;s goals had all been done, or if every remaining week scored ten points higher.</li>
        </ul>
      </details>
    </div>
  );
}

function BriefItems({ items, quarterLabel, latestWeek }: { items: BriefItem[]; quarterLabel: string; latestWeek: number | null }) {
  return (
    <Card>
      <CardHeader title={`${quarterLabel} — this week's brief`} description={latestWeek === null ? "No completed week yet." : `Based on the weeks completed up to week ${latestWeek}.`} />
      <div className="divide-y divide-line">
        {GROUPS.map(([kinds, title]) => {
          const rows = items.filter((i) => kinds.includes(i.kind));
          if (!rows.length) return null;
          return (
            <section key={title} className="px-5 py-3">
              <h3 className="mb-1 text-sm font-semibold">{title}</h3>
              <ul className="space-y-1.5 text-sm">{rows.map((i, k) => <li key={k} className="flex items-start gap-2"><Badge tone={SEV[i.severity].tone}>{SEV[i.severity].label}</Badge><span>{i.text}</span></li>)}</ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function Attention({ b, quarterId }: { b: ManagementBrief; quarterId: string }) {
  const rows = [...b.units].sort((x, y) => (x.intel.prediction.projectedQuarterScore ?? -1) - (y.intel.prediction.projectedQuarterScore ?? -1));
  return (
    <Card>
      <CardHeader title="Every unit at a glance" description="Lowest projected quarter score first. Peers are units of a similar amount of planned work." />
      <DataTable caption="Outlook, cause, peers and what-if by unit" columns={[{ label: "Unit" }, { label: "Outlook" }, { label: "Main reason" }, { label: "Projected", align: "right" }, { label: "Last week", align: "right" }, { label: "Among peers" }, { label: "If last week's goals were done", align: "right" }, { label: "If every week were +10", align: "right" }, { label: "Action", srOnly: true }]}>
        {rows.map((u) => (
          <tr key={u.businessUnitId} className="border-b border-line last:border-0">
            <td className="font-medium">{u.unitName}</td>
            <td><Badge tone={OUTLOOK[u.intel.outlook].tone}>{OUTLOOK[u.intel.outlook].label}</Badge></td>
            <td className="text-muted">{u.cause ? u.cause.label : "—"}</td>
            <td className="text-right tabular-nums">{pct(u.intel.prediction.projectedQuarterScore)}</td>
            <td className="text-right tabular-nums" title={u.change.previous === null ? undefined : `Week before: ${u.change.previous.toFixed(0)}%`}>{pct(u.change.last)} <span className="text-xs text-muted">{u.change.delta === null ? "" : `(${signed(u.change.delta)})`}</span></td>
            <td className="text-muted">{u.peer.percentile === null ? "—" : `${u.peer.group} · rank ${u.peer.rank} of ${u.peer.groupSize}`}</td>
            <td className="text-right tabular-nums">{u.whatIf.finishLatest ? `${u.whatIf.finishLatest.projected.toFixed(0)}% (${signed(u.whatIf.finishLatest.delta)})` : "—"}</td>
            <td className="text-right tabular-nums">{u.whatIf.lift10 ? `${u.whatIf.lift10.projected.toFixed(0)}% (${signed(u.whatIf.lift10.delta)})` : "—"}</td>
            <td>{u.intel.outlook === "ON_TRACK" ? null : <LogActionButton businessUnitId={u.businessUnitId} quarterId={quarterId} unitName={u.unitName} scoreBefore={u.change.last} />}</td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}

function Integrity({ units }: { units: UnitAnalysis[] }) {
  const tone = { ok: "done", watch: "warn", review: "critical" } as const, label = { ok: "Looks sound", watch: "Look closer", review: "Review" } as const;
  return (
    <Card>
      <CardHeader title="Can the scores be trusted?" description="How demanding each unit's goals are, and whether the way they were marked off looks usual." />
      <DataTable caption="Goal difficulty and score checks by unit" columns={[{ label: "Unit" }, { label: "Goal difficulty" }, { label: "Tasks per goal", align: "right" }, { label: "Goals with a number", align: "right" }, { label: "With a deadline", align: "right" }, { label: "SMART average", align: "right" }, { label: "Score check" }, { label: "Why" }]}>
        {units.map((u) => (
          <tr key={u.businessUnitId} className="border-b border-line last:border-0">
            <td className="font-medium">{u.unitName}</td>
            <td>{u.difficulty.level === null ? <span className="text-muted">Too early</span> : <Badge tone={u.difficulty.level === "demanding" ? "done" : u.difficulty.level === "light" ? "warn" : "info"}>{u.difficulty.level}</Badge>}</td>
            <td className="text-right tabular-nums">{u.difficulty.tasksPerGoal?.toFixed(1) ?? "—"}</td>
            <td className="text-right tabular-nums">{pct(u.difficulty.measurablePct)}</td>
            <td className="text-right tabular-nums">{pct(u.difficulty.deadlinePct)}</td>
            <td className="text-right tabular-nums">{u.difficulty.avgSmart?.toFixed(0) ?? "—"}</td>
            <td><Badge tone={tone[u.integrity.level]}>{label[u.integrity.level]}</Badge></td>
            <td className="text-muted">{u.integrity.flags.length ? u.integrity.flags.join("; ") : "Nothing unusual"}</td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}

function Capacity({ units }: { units: UnitAnalysis[] }) {
  return (
    <Card>
      <CardHeader title="Capacity and repeated goals" description="What each unit plans against what it finishes, and goals set again and again without being finished." />
      <DataTable caption="Planned and finished tasks a week, and carried-over goals" columns={[{ label: "Unit" }, { label: "Tasks planned a week", align: "right" }, { label: "Finished a week", align: "right" }, { label: "Finished", align: "right" }, { label: "Heaviest week" }, { label: "Set again without finishing" }]}>
        {units.map((u) => (
          <tr key={u.businessUnitId} className="border-b border-line last:border-0">
            <td className="font-medium">{u.unitName}</td>
            <td className="text-right tabular-nums">{u.capacity.plannedPerWeek?.toFixed(1) ?? "—"}</td>
            <td className="text-right tabular-nums">{u.capacity.donePerWeek?.toFixed(1) ?? "—"}</td>
            <td className="text-right tabular-nums">{u.capacity.ratio === null ? "—" : <>{pct(u.capacity.ratio)} {u.capacity.overcommitted ? <Badge tone="warn">Over-committed</Badge> : null}</>}</td>
            <td className="text-muted">{u.capacity.heaviest ? `Week ${u.capacity.heaviest.week} · ${u.capacity.heaviest.tasks} tasks` : "—"}</td>
            <td className="text-muted">{u.capacity.carryOver.length ? u.capacity.carryOver.map((c) => `“${c.title.slice(0, 50)}” (${c.weeks} wks)`).join("; ") : "None"}</td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}

function Coverage({ b }: { b: ManagementBrief }) {
  return (
    <Card>
      <CardHeader title="Is the strategy covered?" description="Which Sub-KRs the weekly goals actually serve, how many units work on each and how often those goals are finished." />
      <DataTable caption="Weekly goals by Sub-KR" columns={[{ label: "Sub-KR" }, { label: "Weekly goals", align: "right" }, { label: "Units", align: "right" }, { label: "Share of all goals", align: "right" }, { label: "Finished", align: "right" }, { label: "Coverage" }]}>
        {b.coverage.map((r) => (
          <tr key={r.code} className="border-b border-line last:border-0">
            <td><span className="font-medium">{r.code}</span> <span className="text-muted">{r.title}</span></td>
            <td className="text-right tabular-nums">{r.goals}</td><td className="text-right tabular-nums">{r.units}</td>
            <td className="text-right tabular-nums">{pct(r.sharePct)}</td><td className="text-right tabular-nums">{pct(r.doneRate)}</td>
            <td><Badge tone={r.status === "uncovered" ? "critical" : r.status === "concentrated" ? "warn" : "done"}>{r.status === "uncovered" ? "No goal supports it" : r.status === "concentrated" ? "Effort concentrated" : "Covered"}</Badge></td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}

function Governance({ b }: { b: ManagementBrief }) {
  return (
    <Card>
      <CardHeader title="Governance snapshot" description="Attendance, open violations and what is waiting for a decision." />
      {b.queues ? (
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          {([["Attendance amendments", b.queues.attendanceAmendments], ["Fund requests", b.queues.disbursements], ["Configuration changes", b.queues.configChanges]] as const).map(([label, x]) => (
            <div key={label} className="rounded-lg bg-surface px-3 py-2"><p className="text-xs text-muted">{label}</p><p className="text-lg font-semibold tabular-nums">{x.waiting} waiting</p><p className="text-xs text-muted">{x.waiting ? `oldest ${x.oldestDays} day${x.oldestDays === 1 ? "" : "s"}` : "nothing pending"}</p></div>
          ))}
        </div>
      ) : null}
      <DataTable caption="Attendance and open violations by unit" columns={[{ label: "Unit" }, { label: "Attendance", align: "right" }, { label: "Open violations", align: "right" }, { label: "Fines outstanding", align: "right" }]}>
        {b.units.map((u) => (
          <tr key={u.businessUnitId} className="border-b border-line last:border-0">
            <td className="font-medium">{u.unitName}</td>
            <td className="text-right tabular-nums">{pct(u.governance.attendanceRate)}</td>
            <td className="text-right tabular-nums">{u.governance.openViolations}</td>
            <td className="text-right tabular-nums">{new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(u.governance.openFines)}</td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}

function Actions({ b }: { b: ManagementBrief }) {
  return (
    <Card>
      <CardHeader title="What was done, and did it help?" description="Actions logged for a unit, with its weekly average then and since." />
      {b.actions.length === 0 ? <EmptyState title="No actions logged yet">Use “Log action” beside a unit above after you act on it. The brief then shows how its weeks went afterwards.</EmptyState> : (
        <ul className="divide-y divide-line">
          {b.actions.map((a) => (
            <li key={a.id} className="space-y-0.5 px-5 py-3 text-sm">
              <p className="font-medium">{a.unitName} <span className="font-normal text-muted">· {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(new Date(a.createdAt))}</span></p>
              <p>{a.note}</p>
              <p className="text-xs text-muted">{a.weeksAfter === 0 ? "No completed week since." : `Weekly average ${pct(a.scoreBefore)} then, ${pct(a.scoreAfter)} over the ${a.weeksAfter} completed ${a.weeksAfter === 1 ? "week" : "weeks"} since${a.change === null ? "" : ` (${signed(a.change)} points)`}.`}</p>
            </li>
          ))}
        </ul>
      )}
      {b.recognition.mostImproved.length || b.recognition.mostConsistent.length ? (
        <div className="grid gap-4 border-t border-line px-5 py-3 text-sm sm:grid-cols-2">
          <div><h3 className="font-semibold">Most improved</h3>{b.recognition.mostImproved.length ? <ul className="text-muted">{b.recognition.mostImproved.map((m) => <li key={m.unitName}>{m.unitName}: {signed(m.delta)} points last week</li>)}</ul> : <p className="text-muted">None this week.</p>}</div>
          <div><h3 className="font-semibold">Most consistent</h3>{b.recognition.mostConsistent.length ? <ul className="text-muted">{b.recognition.mostConsistent.map((m) => <li key={m.unitName}>{m.unitName}: averages {m.average.toFixed(0)}% (swing {m.spread.toFixed(0)})</li>)}</ul> : <p className="text-muted">None yet.</p>}</div>
        </div>
      ) : null}
    </Card>
  );
}
