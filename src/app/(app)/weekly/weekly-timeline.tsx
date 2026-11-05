import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge, buttonClass, Card } from "@/components/ui/primitives";
import type { Cell } from "@/lib/analytics";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { formatPercent } from "@/lib/format";

const TARGET = 70;

type Status = { label: string; tone: "undefined" | "warn" | "info" | "done" };
/** Where a week's score puts it, against the 70% quarter target. */
function statusOf(c: Cell, score: number | null): Status {
  if (!c.submitted && (c.compliance === "NON_COMPLIANT" || score === null || c.scoreState === "NOT_SUBMITTED")) return { label: "Unreported", tone: "undefined" };
  if (score === null) return { label: "In progress", tone: "info" };
  if (score >= 85) return { label: "Peak performer", tone: "done" };
  if (score >= TARGET) return { label: "On track", tone: "info" };
  if (score >= 50) return { label: "Attention", tone: "warn" };
  return { label: "Lagging", tone: "warn" };
}

/** The weeks of the quarter, newest first, each with its score as a bar against the target. */
export function WeeklyTimeline({ cells, nowIso, quarterLabel, quarterScore, quarterFinal }: { cells: Cell[]; nowIso: string; quarterLabel: string; quarterScore: number | null; quarterFinal: boolean }) {
  const weeks = cells.filter((c) => !c.holiday && new Date(c.weekStart).getTime() <= new Date(nowIso).getTime()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const holidays = cells.filter((c) => c.holiday).length;
  const rows = weeks.map((c) => {
    const score = c.score;
    const raw = c.goalsTotal > 0 ? (c.goalsDone / c.goalsTotal) * 100 : null;
    return { c, score, raw, status: statusOf(c, score) };
  });
  const missing = rows.filter((r) => r.status.label === "Unreported").length;
  // a week with no report scores zero, so the mean counts it; a week still in progress is left out
  const counted = rows.filter((r) => r.status.label !== "In progress");
  const computed = counted.length ? counted.reduce((n, r) => n + (r.score ?? 0), 0) / counted.length : null;
  const mean = quarterScore ?? computed;
  const best = rows.reduce<number | null>((m, r) => (r.score !== null && (m === null || r.score > (rows[m].score ?? -1)) ? rows.indexOf(r) : m), null);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">Weekly Execution Timeline <span className="rounded border border-line bg-surface px-2 py-0.5 text-xs font-normal text-muted">{quarterLabel} reporting range</span></h2>
          <p className="mt-1 text-sm text-muted">Every reporting week of the quarter, newest first. Holiday weeks are not counted.</p>
        </div>
        <ul className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-700" aria-hidden />Recorded score</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-line" aria-hidden />Unreported / 0.0%</li>
          <li className="flex items-center gap-1.5"><span className="inline-block h-3 border-l-2 border-dashed border-brand-700" aria-hidden />{TARGET}% target</li>
          <li className="flex items-center gap-1.5"><span className="inline-block h-3 border-l border-dotted border-muted" aria-hidden />50% midline</li>
        </ul>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[17rem_1fr]">
        <aside className="space-y-4 self-start rounded-xl border border-line bg-surface p-5" aria-label="Quarter summary">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Quarter execution mean</p>
          <p className="text-4xl font-bold tracking-tight tabular-nums">{mean === null ? "—" : formatPercent(mean)}</p>
          <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Reportable weeks</dt><dd className="font-semibold tabular-nums">{rows.length}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Missing submissions</dt><dd className="font-semibold tabular-nums">{missing}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Holiday excluded</dt><dd className="font-semibold tabular-nums">{holidays}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Target</dt><dd className="font-semibold tabular-nums">{TARGET}%</dd></div>
          </dl>
          {!quarterFinal ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,#f59e0b_40%,white)] bg-[color-mix(in_srgb,#f59e0b_10%,white)] p-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Provisional period</p>
              <p className="mt-1 text-muted">The mean includes weeks that are not yet final. Scores become final when the quarter closes.</p>
            </div>
          ) : null}
          <Link href="/reports/weekly-compliance" className={buttonClass("secondary", "sm") + " w-full justify-center"}>Open the compliance report</Link>
        </aside>

        <div className="min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label="Weekly scores, newest first">
          <div className="min-w-[40rem]">
            <div className="grid grid-cols-[minmax(10rem,14rem)_1fr_6.5rem_8.5rem] items-end gap-4 px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>Week &amp; date window</span>
              <span className="relative block h-4" aria-hidden>
                <span className="absolute left-0">0%</span><span className="absolute left-1/4 -translate-x-1/2">25%</span><span className="absolute left-1/2 -translate-x-1/2">50%</span>
                <span className="absolute -translate-x-1/2 text-brand-700" style={{ left: `${TARGET}%` }}>{TARGET}% target</span><span className="absolute right-0">100%</span>
              </span>
              <span className="text-right">Raw / score %</span><span className="text-right">Status</span>
            </div>
            {rows.length === 0 ? <p className="px-2 py-10 text-center text-sm text-muted">No weeks have started in this quarter yet.</p> : (
              <ol className="divide-y divide-line border-t border-line">
                {rows.map((r, i) => (
                  <li key={r.c.weekId} className={`grid grid-cols-[minmax(10rem,14rem)_1fr_6.5rem_8.5rem] items-center gap-4 px-2 py-3 ${i === best && (r.score ?? 0) > 0 ? "rounded-lg bg-[color-mix(in_srgb,var(--brand-700,#7a1420)_5%,white)]" : ""}`}>
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">W{r.c.weekNumber}</span>
                      {r.c.reportId ? <Link href={`/weekly/${r.c.reportId}`} className="truncate font-medium hover:underline" title={formatWeekLabel({ week_number: r.c.weekNumber, week_start_at: r.c.weekStart })}>{formatWeekLabel({ week_number: r.c.weekNumber, week_start_at: r.c.weekStart })}</Link>
                        : <span className="truncate font-medium" title={formatWeekLabel({ week_number: r.c.weekNumber, week_start_at: r.c.weekStart })}>{formatWeekLabel({ week_number: r.c.weekNumber, week_start_at: r.c.weekStart })}</span>}
                    </span>
                    <span className="relative block h-2.5 rounded-full bg-line" role="img" aria-label={`${formatWeekLabel({ week_number: r.c.weekNumber, week_start_at: r.c.weekStart })}: ${r.score === null ? "no score" : `${r.score.toFixed(1)}%`}`}>
                      <span className="absolute inset-y-0 left-0 rounded-full bg-brand-700" style={{ width: `${Math.max(0, Math.min(100, r.score ?? 0))}%` }} />
                      <span className="absolute -top-1 -bottom-1 border-l border-dotted border-muted" style={{ left: "50%" }} aria-hidden />
                      <span className="absolute -top-1 -bottom-1 border-l-2 border-dashed border-brand-700/70" style={{ left: `${TARGET}%` }} aria-hidden />
                    </span>
                    <span className="flex items-center justify-end gap-2 text-sm">
                      <span className="tabular-nums text-muted">{(r.raw ?? 0).toFixed(1)}</span><span className="font-semibold tabular-nums">{formatPercent(r.score ?? 0)}</span>
                    </span>
                    <span className="flex justify-end"><Badge tone={r.status.tone}>{r.status.label}</Badge></span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
