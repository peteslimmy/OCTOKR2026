"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { IntegrityDialog } from "@/components/integrity-dialog";
import { ComplianceBadge, GoalStatusBadge, PhaseBadge, ScoreText, SubmissionBadge, TaskStatusBadge } from "@/components/status";
import { Badge, Card } from "@/components/ui/primitives";
import { SmartStrip } from "@/components/smart-strip";
import { RichText } from "@/components/ui/rich-text";
import type { ReportView } from "@/lib/data";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { stripLeadingNumber } from "@/lib/domain/task-text";


export function PresenterView({ view, canCorrect, prevHref, nextHref, buName, lastWeek, intelligence }: { view: ReportView; canCorrect: boolean; prevHref: string; nextHref: string; buName: string; lastWeek?: ReactNode; intelligence?: ReactNode }) {
  const router = useRouter();
  const [ic, setIc] = useState<ReportView["goals"][number]["tasks"][number] | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      if (e.key === "ArrowRight") router.push(nextHref);
      if (e.key === "ArrowLeft") router.push(prevHref);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [router, nextHref, prevHref]);

  const correctable = canCorrect && !view.quarter_locked && (view.phase === "CONTENT_LOCKED" || view.phase === "FINAL_LOCKED" || !!view.status_changes_open);
  const final = view.snapshot?.final_score ?? view.score_preview.final_score;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const goalTotal = view.goals.length;
  const allTasks = view.goals.flatMap((g) => g.tasks);
  const goalPct = pct(view.goals.filter((g) => g.status === "DONE").length, goalTotal);
  const taskPct = pct(allTasks.filter((t) => t.status === "DONE").length, allTasks.length);
  // red below 50%, yellow from 50% up to the 70% target, green at or above it
  const bandColour = (v: number) => (v >= 70 ? "#15803d" : v >= 50 ? "#d97706" : "#b91c1c");
  const perf = [{ name: "Goals", pct: goalPct, color: bandColour(goalPct) }, { name: "Tasks", pct: taskPct, color: bandColour(taskPct) }];
  // Alignment: share of this week's goals mapped to each Key Result (KR1–KR3 always shown; any other KR or Stretch only when present).
  const krCodes = [...new Set(["KR1", "KR2", "KR3", ...view.goals.map((g) => g.sub_key_result?.kr_code).filter((c): c is string => !!c)])].sort();
  const alignment = krCodes.map((c) => ({ label: c, n: view.goals.filter((g) => g.sub_key_result?.kr_code === c).length }));
  const stretchN = view.goals.filter((g) => !g.sub_key_result).length;
  if (stretchN) alignment.push({ label: "Stretch", n: stretchN });
  return (
    <div className="space-y-4">
      {/* compact unit card: name and week on one line, the two progress bars and the alignment chips beside it, the score and last-week hint to the right */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-52">
            <h2 className="flex flex-wrap items-center gap-x-2 text-xl font-semibold leading-tight">
              <Link href={prevHref} aria-label="Previous BU" title="Previous BU (left arrow key)" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-brand-700 hover:bg-surface"><ChevronLeft className="h-4 w-4" aria-hidden /></Link>
              {buName}<span className="text-sm font-normal text-muted">{`Week ${view.week.week_number}`}</span>
              <Link href={nextHref} aria-label="Next BU" title="Next BU (right arrow key)" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-brand-700 hover:bg-surface"><ChevronRight className="h-4 w-4" aria-hidden /></Link>
            </h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5"><PhaseBadge phase={view.phase} /><SubmissionBadge status={view.report.submission_status} auto={view.report.auto_submitted} /><ComplianceBadge status={view.compliance?.status} />
              {view.session_outcome === "SKIPPED" ? <Badge tone="warn">SKIPPED WEEK</Badge> : null}</div>
          </div>
          {goalTotal > 0 ? (
            <div className="flex min-w-0 flex-[2_1_22rem] flex-wrap items-center gap-x-6 gap-y-3 lg:border-l lg:border-line lg:pl-6">
              <div className="min-w-[11rem] flex-1 space-y-1.5" role="group" aria-label={`Goals ${goalPct}% complete, tasks ${taskPct}% complete`}>
                {perf.map((r) => (
                  <div key={r.name} className="grid grid-cols-[2.75rem_1fr_3rem] items-center gap-2 text-sm">
                    <span className="text-muted">{r.name}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-line" aria-hidden><span className="block h-full rounded-full" style={{ width: `${r.pct}%`, backgroundColor: r.color }} /></span>
                    <span className="text-right font-semibold tabular-nums text-ink">{r.pct}%</span>
                  </div>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 basis-40 flex-col items-start gap-1 text-xs" aria-label="Goal alignment to Key Results this week">
                <span className="font-medium">Alignment this week</span>
                <span className="flex flex-wrap gap-1.5">{alignment.map((a) => <Badge key={a.label} tone={a.n ? "done" : "undefined"}>{a.label} {pct(a.n, goalTotal)}% ({a.n}/{goalTotal})</Badge>)}</span>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col items-end text-right lg:border-l lg:border-line lg:pl-6">{lastWeek}<p className="mt-1 text-3xl font-semibold leading-none"><ScoreText value={final} /></p>
            <p className="mt-1 text-xs text-muted">{view.score_preview.done_goals}/{view.score_preview.total_goals} goals done{view.snapshot ? " · final" : " · preview"}</p></div>
        </div>
        {view.report.skipped_session_summary_comment ? <blockquote className="mt-3 rounded-lg bg-surface p-3 text-sm"><p className="mb-1 font-medium">BU performance summary</p><RichText value={view.report.skipped_session_summary_comment} /></blockquote> : null}
      </Card>

      {view.goals.length === 0 ? <Card><p className="p-6 text-sm text-muted">No goals were filed.</p></Card> : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-panel px-5 py-2.5">
            <h2 className="text-base font-semibold">{formatWeekLabel(view.week)} <span className="font-normal text-muted">· Summary detail</span></h2>
            <p className="text-xs text-muted">{view.goals.length} {view.goals.length === 1 ? "goal" : "goals"} · {view.goals.reduce((n, g) => n + g.tasks.length, 0)} tasks</p>
          </div>
          {canCorrect && view.quarter_locked ? <p className="border-b border-line bg-panel px-5 py-2 text-xs text-muted">This quarter is locked, so task statuses can no longer be corrected.</p> : null}
          <ol className="max-h-[max(20rem,calc(100vh-19rem))] space-y-3 overflow-y-auto overscroll-contain bg-surface p-3" tabIndex={0} aria-label="Goals and tasks">
            {view.goals.map((g, gi) => (
              <li key={g.id}
                className={`grid overflow-hidden rounded-xl border lg:grid-cols-[2fr_3fr] ${g.status === "DONE"
                  ? "border-[color-mix(in_srgb,var(--done-fg)_40%,white)] bg-[color-mix(in_srgb,var(--done-bg)_35%,white)]" : "border-line bg-panel"}`}>
                <div className="flex flex-col gap-2 border-line p-4 lg:border-r">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-line bg-panel px-1.5 py-0.5"><SmartStrip evaluation={g.evaluation} /></span>
                    <GoalStatusBadge status={g.status} pending={g.has_undefined_tasks && view.phase !== "FINAL_LOCKED"} />
                    {g.goal_type === "STRETCH" ? <Badge tone="stretch">Stretch</Badge> : null}
                  </div>
                  <h3 className="text-base font-semibold leading-snug">{`Goal ${gi + 1}: ${g.title}`}</h3>
                  <div className="mt-auto space-y-1 border-t border-line pt-2">
                    {g.sub_key_result ? (
                      <>
                        <p className="inline-block rounded-md border border-line bg-panel px-2 py-0.5 text-xs">{g.sub_key_result.code} {g.sub_key_result.title}</p>
                      </>
                    ) : <p className="text-xs text-muted">Stretch goal — no Sub-KR</p>}
                    {g.bu_goal ? <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">BU goal → <span className="font-normal normal-case tracking-normal text-ink">{g.bu_goal.title}</span></p> : null}
                  </div>
                </div>
                <ul className="divide-y divide-line self-center">
                  {g.tasks.map((t, ti) => (
                    <li key={t.id} className="flex h-11 items-center justify-between gap-3 px-4 text-sm leading-tight">
                      <span className="line-clamp-2" title={stripLeadingNumber(t.description)}><span className="mr-2 font-mono text-xs text-muted tabular-nums">{gi + 1}.{ti + 1}</span>{stripLeadingNumber(t.description)}</span>
                      {correctable && t.status !== "UNDEFINED" ? (
                        <button type="button" onClick={() => setIc(t)} className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" title="Click to correct this task's status" aria-label={`Correct status of task ${gi + 1}.${ti + 1}`}><TaskStatusBadge status={t.status} /></button>
                      ) : <span className="shrink-0"><TaskStatusBadge status={t.status} /></span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {view.report.comment ? (
        <Card className="p-5"><h2 className="mb-1 text-base font-semibold">{buName} — comments for the week</h2><RichText value={view.report.comment} /></Card>
      ) : null}
      {intelligence}
      {ic ? <IntegrityDialog task={ic} open onOpenChange={(o) => !o && setIc(null)} /> : null}
    </div>
  );
}
