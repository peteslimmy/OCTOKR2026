import Link from "next/link";
import { ComplianceBadge, PhaseBadge, ScoreText, SubmissionBadge, wat } from "@/components/status";
import { Countdown } from "@/components/ui/client";
import { Badge, Banner, buttonClass, Card, CardHeader } from "@/components/ui/primitives";
import type { ReportView, ReportingWeek } from "@/lib/data";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { formatPercent } from "@/lib/format";

/** What the week's report holds, counted from its goals and their tasks. */
export function weekFigures(view: ReportView) {
  const tasks = view.goals.flatMap((g) => g.tasks);
  const done = view.goals.filter((g) => g.status === "DONE").length;
  const open = view.phase === "FINAL_LOCKED" ? 0 : view.goals.filter((g) => g.status !== "DONE" && g.has_undefined_tasks).length;
  return {
    goals: { total: view.goals.length, done, open, notDone: Math.max(0, view.goals.length - done - open) },
    tasks: { total: tasks.length, done: tasks.filter((t) => t.status === "DONE").length, notDone: tasks.filter((t) => t.status === "NOT_DONE").length, undefined: tasks.filter((t) => t.status === "UNDEFINED").length },
    score: view.snapshot?.final_score ?? view.score_preview.final_score,
  };
}

/** Whether the week did better than the one before it, in score points. */
export function movement(now: number | null, before: number | null): { tone: "good" | "bad" | "flat" | "none"; text: string } {
  if (now === null || before === null) return { tone: "none", text: "No earlier week to compare" };
  const d = Math.round((now - before) * 10) / 10;
  if (Math.abs(d) < 0.05) return { tone: "flat", text: `Unchanged on the week before (${formatPercent(before)})` };
  return d > 0 ? { tone: "good", text: `Improved: up ${d.toFixed(1)} points on the week before (${formatPercent(before)})` } : { tone: "bad", text: `Not improved: down ${Math.abs(d).toFixed(1)} points on the week before (${formatPercent(before)})` };
}

function Fig({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" | "muted" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone === "good" ? "text-[var(--done-fg)]" : tone === "bad" ? "text-[var(--critical-fg)]" : tone === "muted" ? "text-muted" : ""}`}>{value}</dd>
    </div>
  );
}

export function WeekCard({ week, id, view, previousScore, attendance, contentLockPhrase }: {
  week: ReportingWeek & { phase?: string }; id: string | null; view: ReportView | null; previousScore: number | null; attendance: { present: number; total: number } | null; contentLockPhrase: string;
}) {
  const holiday = week.reporting_state === "ORGANIZATION_HOLIDAY";
  const phase = view?.phase ?? week.phase;
  const final = phase === "FINAL_LOCKED";
  const f = view ? weekFigures(view) : null;
  const mv = f ? movement(f.score, previousScore) : null;
  return (
    <Card>
      <CardHeader title={formatWeekLabel(week)} description={`${wat(week.week_start_at, { day: "numeric", month: "short" })} → final lock ${wat(week.final_lock_at)}`} action={phase ? <PhaseBadge phase={phase} /> : undefined} />
      <div className="space-y-4 px-6 py-4 text-sm">
        {holiday ? (
          <Banner tone="info" title="ORGANIZATION HOLIDAY · REPORT NOT REQUIRED">No weekly report is due for this week and it is excluded from your quarterly score.</Banner>
        ) : view && f ? (
          <>
            {view.session_outcome === "SKIPPED" ? <Badge tone="warn">OKR session skipped — performance summary required</Badge> : null}
            <div className="flex flex-wrap items-center gap-2"><SubmissionBadge status={view.report.submission_status} /><ComplianceBadge status={view.compliance?.status} />{final ? <Badge tone="locked">Immutable record</Badge> : null}</div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Goals</p>
                <dl className="grid grid-cols-2 gap-2">
                  <Fig label="Total" value={f.goals.total} /><Fig label="Done" value={f.goals.done} tone="good" />
                  <Fig label="Not done" value={f.goals.notDone} tone={f.goals.notDone ? "bad" : "muted"} />{final ? null : <Fig label="Still open" value={f.goals.open} tone="muted" />}
                </dl>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Tasks</p>
                <dl className="grid grid-cols-2 gap-2">
                  <Fig label="Total" value={f.tasks.total} /><Fig label="Done" value={f.tasks.done} tone="good" />
                  <Fig label="Not done" value={f.tasks.notDone} tone={f.tasks.notDone ? "bad" : "muted"} />{final ? null : <Fig label="Not yet marked" value={f.tasks.undefined} tone="muted" />}
                </dl>
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line px-3 py-2">
                <dt className="text-xs text-muted">{view.snapshot ? "Final score" : "Score preview"}</dt>
                <dd className="text-2xl font-semibold tabular-nums"><ScoreText value={f.score} /></dd>
                {mv ? <dd className={`mt-0.5 text-xs ${mv.tone === "good" ? "text-[var(--done-fg)]" : mv.tone === "bad" ? "text-[var(--critical-fg)]" : "text-muted"}`}>{mv.tone === "good" ? "▲ " : mv.tone === "bad" ? "▼ " : ""}{mv.text}</dd> : null}
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <dt className="text-xs text-muted">Attendance at the OKR session</dt>
                <dd className="text-2xl font-semibold tabular-nums">{attendance && attendance.total > 0 ? formatPercent((attendance.present / attendance.total) * 100) : "—"}</dd>
                <dd className="mt-0.5 text-xs text-muted">{attendance && attendance.total > 0 ? `${attendance.present} of ${attendance.total} present` : "No session attendance recorded for this week"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-4 text-muted">
              {final ? <span>Final lock passed {wat(week.final_lock_at)}. This report can no longer be changed.</span>
                : <><Countdown to={week.content_lock_at} label="Content lock" /><Countdown to={week.final_lock_at} label="Final lock" /></>}
            </div>
          </>
        ) : phase === "OPEN" ? (
          <p className="text-muted">No report started. Add at least one SMART goal and submit before {contentLockPhrase} WAT.</p>
        ) : (
          <Banner tone="critical" title="No report was filed for this week">Reports can no longer be started after content lock. At final lock this week scores 0.00 and is recorded as non-compliant{final ? "" : " unless an authorised late report is filed"}.</Banner>
        )}
        {!holiday && (id || phase === "OPEN") ? (
          <Link href={id ? `/weekly/${id}` : `/weekly?start=${week.id}`} className={buttonClass(id ? "secondary" : "primary", "sm")}>{id ? (final ? "View report" : "Open report") : "Start report"}</Link>
        ) : null}
      </div>
    </Card>
  );
}
