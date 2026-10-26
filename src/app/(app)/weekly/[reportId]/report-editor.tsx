"use client";

import { Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { IntegrityDialog } from "@/components/integrity-dialog";
import { SmartPanel, type SmartData } from "@/components/smart-panel";
import { ComplianceBadge, GoalStatusBadge, PhaseBadge, ScoreText, SubmissionBadge, TaskStatusBadge, wat } from "@/components/status";
import { ApiFailure, apiRequest, ConfirmButton, Countdown, Modal, useAction } from "@/components/ui/client";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Input, Label, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import type { GoalView, ReportView } from "@/lib/data";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { formatPercent, formatFraction } from "@/lib/format";
import { DiscardReportButton } from "@/app/(app)/admin/admin-actions";

// Ordering guard for the edit lease: React may unmount and remount the editor in quick succession (navigation, hot reload, strict mode).
let pendingRelease: Promise<void> = Promise.resolve();

type Caps = { edit: boolean; submit: boolean; execute: boolean; review: boolean; integrity: boolean };
type SubKr = { id: string; label: string; kr: string };

export function ReportEditor({ view, subKrs, caps }: { view: ReportView; subKrs: SubKr[]; caps: Caps }) {
  const { report, week, phase } = view;
  const holiday = week.reporting_state === "ORGANIZATION_HOLIDAY";
  const late = phase === "LATE_OPEN";
  const editable = (phase === "OPEN" || late) && caps.edit && !holiday;
  const { run, pending } = useAction();
  const [lease, setLease] = useState<'idle' | 'held' | 'conflict' | 'error'>("idle");
  const [leaseMsg, setLeaseMsg] = useState("");
  const [goalModal, setGoalModal] = useState<{ goal?: GoalView } | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [summary, setSummary] = useState(report.skipped_session_summary_comment ?? "");
  const [reviewText, setReviewText] = useState("");

  // Edit lease: one BU Lead edits at a time. Acquire on open, heartbeat every 2 min, release on leave.
  useEffect(() => {
    if (!editable) return;
    let stopped = false;
    const acquire = async () => {
      try {
        await pendingRelease; // a release from the previous mount must reach the server BEFORE this acquire, or it would drop the new lease
        await apiRequest("POST", `weekly-reports/${report.id}/edit-session`);
        if (!stopped) setLease("held");
      } catch (e) {
        const f = e as ApiFailure;
        if (stopped) return;
        setLease(f.code === "EDIT_LEASE_CONFLICT" ? "conflict" : "error");
        setLeaseMsg(f.message);
      }
    };
    acquire();
    const hb = setInterval(acquire, 120_000);
    return () => {
      stopped = true;
      clearInterval(hb);
      pendingRelease = fetch(`/api/v1/weekly-reports/${report.id}/edit-session`, { method: "DELETE", keepalive: true }).then(() => undefined, () => undefined);
    };
  }, [editable, report.id]);

  const canMutate = editable && lease === "held";
  const exec = (phase === "CONTENT_LOCKED" || late) && caps.execute && !holiday;
  const submitted = report.submission_status === "SUBMITTED";

  return (
    <>
      <PageHeader
        title={`${view.business_unit.name} · ${formatWeekLabel(week)}`}
        description={`Reporting week opened ${wat(week.week_start_at, { weekday: "short", day: "numeric", month: "short" })}.`}
        actions={
          <>
            <DiscardReportButton reportId={report.id} reportStatus={report.status} submissionStatus={report.submission_status} />
            {caps.submit && !holiday && phase !== "FINAL_LOCKED" && phase !== "NOT_OPEN" ? (
              <Button disabled={pending || (submitted && !view.summary_required)}
                onClick={async () => {
                  setBlockers([]);
                  try {
                    await apiRequest("POST", `weekly-reports/${report.id}/submit`, { summaryComment: summary || null, expectedVersion: null });
                    run(async () => undefined, { success: submitted ? "Report already submitted." : "Report submitted." });
                  } catch (e) {
                    const f = e as ApiFailure;
                    const list = Array.isArray(f.details) ? (f.details as string[]) : [f.message];
                    setBlockers(list.map(blockerText));
                  }
                }}>{submitted ? "Submitted ✓" : "Submit report"}</Button>
            ) : undefined}
          </>
        }
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <PhaseBadge phase={phase} />
          <SubmissionBadge status={report.submission_status} />
          {report.review_status === "REVIEWED" ? <Badge tone="done">Reviewed</Badge> : phase === "FINAL_LOCKED" && submitted ? <Badge tone="warn">Awaiting review</Badge> : null}
          <ComplianceBadge status={view.compliance?.status} />
          {view.session_outcome === "SKIPPED" ? <Badge tone="warn">SKIPPED WEEK · session not held</Badge> : null}
          <span className="ml-auto flex flex-wrap gap-4 text-sm text-muted">
            <Countdown to={week.content_lock_at} label="Content lock" /><Countdown to={week.final_lock_at} label="Final lock" />
          </span>
        </div>
        <p className="text-xs text-muted">Content locks {wat(week.content_lock_at)} · Final lock {wat(week.final_lock_at)}</p>

        {holiday ? <Banner tone="info" title="ORGANIZATION HOLIDAY · REPORT NOT REQUIRED">No report is due for this week.</Banner> : null}
        {late ? <Banner tone="locked" title="Late report — authorised exception.">{view.late_exception?.reason ? `Reason: ${view.late_exception.reason}. ` : ""}Add your goals and tasks, set every task to Done or Not done, then submit. It is reviewed before the quarterly score is amended; the original zero and earlier scores stay on record.</Banner> : null}
        {phase === "CONTENT_LOCKED" ? <Banner tone="locked" title="Content Locked — goal and task definitions can no longer be changed.">{exec ? "You can still set each task to Done or Not done until final lock. Tasks left undefined become Not done at final lock." : null}</Banner> : null}
        {phase === "FINAL_LOCKED" ? <Banner tone="locked" title="Report Finalized — historical record is immutable.">Scores and compliance are final{view.snapshot && view.snapshot.version > 1 ? ` (score version ${view.snapshot.version} after an integrity correction)` : ""}.</Banner> : null}
        {editable && lease === "conflict" ? <Banner tone="warn" title="Another BU Lead is editing this report">{leaseMsg} You can view it, but changes are disabled until their session ends.</Banner> : null}
        {editable && lease === "error" ? <Banner tone="critical" title="Could not start an editing session">{leaseMsg}</Banner> : null}
        {blockers.length ? (
          <Banner tone="critical" title="The report cannot be submitted yet">
            <ul className="list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </Banner>
        ) : null}

        {view.summary_required && !holiday ? (
          <Card>
            <CardHeader title="Performance summary for skipped OKR week"
              description="The physical session was skipped. Summarise your BU's actual performance and results this week in your own words. This supplements, and never replaces, the weekly report and its review." />
            <div className="space-y-3 px-6 py-4">
              <Label htmlFor="summary">Summary (required to submit)</Label>
              <Textarea id="summary" rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={phase === "FINAL_LOCKED" || !caps.submit} maxLength={4000} />
              {caps.submit && phase !== "FINAL_LOCKED" ? (
                <Button size="sm" variant="secondary" disabled={pending}
                  onClick={() => run(() => apiRequest("PUT", `weekly-reports/${report.id}/skipped-summary`, { comment: summary }), { success: "Summary saved." })}>Save summary</Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <section aria-labelledby="goals-h" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="goals-h" className="text-lg font-semibold">SMART goals ({view.goals.length})</h2>
              {canMutate ? <Button size="sm" onClick={() => setGoalModal({})}><Plus className="h-4 w-4" aria-hidden />Add goal</Button> : null}
            </div>
            {view.goals.length === 0 ? (
              <Card><EmptyState title="No weekly goals yet">Add at least one SMART Goal before submitting your report.</EmptyState></Card>
            ) : view.goals.map((g) => (
              <GoalCard key={g.id} goal={g} phase={phase} canMutate={canMutate} exec={exec} integrity={caps.integrity && phase !== "OPEN" && phase !== "NOT_OPEN" && phase !== "LATE_OPEN"}
                version={report.version} onEdit={() => setGoalModal({ goal: g })} />
            ))}
          </section>

          <aside className="space-y-4" aria-label="Score">
            <Card>
              <CardHeader title={view.snapshot ? "Final score" : "Score preview"} description="Every goal has equal weight, whatever its number of tasks." />
              <div className="space-y-2 px-6 py-4 text-sm">
                <p className="text-3xl font-semibold"><ScoreText value={view.snapshot?.final_score ?? view.score_preview.final_score} /></p>
                <dl className="grid grid-cols-2 gap-y-1">
                  <dt className="text-muted">Done goals</dt><dd className="text-right tabular-nums">{view.snapshot ? view.snapshot.state === "SCORED" ? view.score_preview.done_goals : 0 : view.score_preview.done_goals} / {view.score_preview.total_goals}</dd>
                  <dt className="text-muted">Base score</dt><dd className="text-right tabular-nums">{formatPercent(view.snapshot?.base_score ?? view.score_preview.base_score)}</dd>
                  <dt className="text-muted">Applied penalty</dt><dd className="text-right tabular-nums">{formatFraction(view.snapshot?.combined_penalty_rate ?? view.score_preview.applied_penalty_rate)}</dd>
                </dl>
                {!view.snapshot ? <p className="text-xs text-muted">Preview only. The authoritative score is calculated at final lock.</p> : null}
                {view.snapshot?.state === "NOT_SUBMITTED" ? <Badge tone="critical">Not submitted at final lock → 0.0%</Badge> : null}
              </div>
            </Card>
            {caps.review && phase === "FINAL_LOCKED" && submitted ? (
              <Card>
                <div className="space-y-3 px-6 py-4 text-sm">
                  {report.review_status === "REVIEWED" ? (
                    <>
                      <p>This report has already been reviewed.</p>
                      {report.review_comments ? <p className="text-xs text-muted">Comments: {report.review_comments}</p> : null}
                    </>
                  ) : (
                    <>
                      {report.review_rejection_reason ? (
                        <p className="text-xs text-muted">Rejected: {report.review_rejection_reason}</p>
                      ) : null}
                      <Label htmlFor="review-text">Comments or rejection reason</Label>
                      <Textarea id="review-text" value={reviewText} onChange={(e) => setReviewText(e.target.value)} rows={3} maxLength={2000}
                        placeholder="Optional for a review; required to reject" />
                      <div className="flex gap-2">
                        <ConfirmButton label="Review" title="Mark this finalised report as reviewed"
                          description="Record that you have reviewed this finalised report. It does not change the score."
                          onConfirm={() => run(() => apiRequest("POST", `weekly-reports/${report.id}/review`, { comments: reviewText.trim() || undefined }),
                            { success: "Report reviewed." })} />
                        <ConfirmButton label="Reject" variant="danger" title="Reject this report" confirmLabel="Reject" disabled={reviewText.trim() === ""}
                          description="Record a rejection with the reason entered. The score is unchanged and the report stays awaiting review."
                          onConfirm={() => run(() => apiRequest("POST", `weekly-reports/${report.id}/review`, { rejection_reason: reviewText.trim() }),
                            { success: "Report rejected." })} />
                      </div>
                    </>
                  )}
                </div>
              </Card>
            ) : null}
          </aside>
        </div>
      </div>

      {goalModal ? (
        <GoalForm key={goalModal.goal?.id ?? "new"} reportId={report.id} version={report.version} subKrs={subKrs} goal={goalModal.goal}
          onClose={() => setGoalModal(null)} />
      ) : null}
    </>
  );
}

function blockerText(b: string): string {
  if (b === "TASK_STATUS_REQUIRED") return "A late report is scored on submission: set every task to Done or Not done first.";
  if (b === "GOAL_MINIMUM_REQUIRED") return "Add at least one SMART Goal before submitting your report.";
  if (b.startsWith("GOAL_TASK_REQUIRED")) return `Every goal needs at least one task${b.includes(":") ? ` (${b.split(":").slice(1).join(":").trim()})` : ""}.`;
  if (b === "SKIPPED_SUMMARY_REQUIRED") return "Enter a performance summary for the skipped OKR week (it is required, and cannot be auto-generated).";
  return b;
}

function GoalCard({ goal, phase, canMutate, exec, integrity, version, onEdit }: {
  goal: GoalView; phase: string; canMutate: boolean; exec: boolean; integrity: boolean; version: number; onEdit: () => void;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [ic, setIc] = useState<GoalView["tasks"][number] | null>(null);
  const [newTask, setNewTask] = useState("");
  const ev = goal.evaluation;
  const smart: SmartData | null = ev ? {
    overall: Number(ev.overall_score), specific: Number(ev.specific_score), measurable: Number(ev.measurable_score), achievable: Number(ev.achievable_score),
    relevant: Number(ev.relevant_score), timeBound: Number(ev.time_bound_score), warnings: ev.warnings, suggestions: ev.suggestions,
  } : null;
  return (
    <Card>
      <div className="space-y-3 px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-base font-semibold">{goal.title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <GoalStatusBadge status={goal.status} pending={goal.has_undefined_tasks && phase !== "FINAL_LOCKED"} />
            {goal.goal_type === "STRETCH" ? <Badge tone="stretch">Stretch</Badge> : <Badge tone="brand">KR-aligned</Badge>}
            {smart ? <Badge tone={smart.overall >= 70 ? "done" : smart.overall >= 45 ? "warn" : "notdone"} title="SMART quality score">SMART {smart.overall.toFixed(0)}%</Badge> : null}
          </div>
        </div>
        {goal.sub_key_result ? <p className="text-sm text-muted">{goal.sub_key_result.kr_code} · {goal.sub_key_result.kr_title} → <strong className="font-medium text-ink">{goal.sub_key_result.code} {goal.sub_key_result.title}</strong></p>
          : <p className="text-sm text-muted">Stretch goal — no Sub-KR applies.</p>}
        {goal.description ? <p className="text-sm">{goal.description}</p> : null}

        <ul className="divide-y divide-line rounded-lg border border-line">
          {goal.tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">{t.description}</span>
              <TaskStatusBadge status={t.status} />
              {canMutate ? (
                <span className="flex gap-1">
                  <EditTaskButton taskId={t.id} text={t.description} version={version} />
                  <ConfirmButton label="Delete" variant="secondary" title="Delete task" description="The task will be removed from this goal. This is recorded in the audit trail."
                    onConfirm={() => run(() => apiRequest("POST", `tasks/${t.id}/delete`, { expectedVersion: version }), { success: "Task deleted." })} />
                </span>
              ) : null}
              {exec && t.status === "UNDEFINED" ? (
                <span className="flex gap-1">
                  <Button size="sm" disabled={pending} onClick={() => run(() => apiRequest("POST", `tasks/${t.id}/execution-status`, { status: "DONE" }), { success: "Marked done." })}>Done</Button>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", `tasks/${t.id}/execution-status`, { status: "NOT_DONE" }), { success: "Marked not done." })}>Not done</Button>
                </span>
              ) : null}
              {integrity && t.status !== "UNDEFINED" ? <Button size="sm" variant="ghost" onClick={() => setIc(t)}>Correct…</Button> : null}
            </li>
          ))}
        </ul>

        {canMutate ? (
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newTask.trim()) return;
            const ok = await run(() => apiRequest("POST", `goals/${goal.id}/tasks`, { description: newTask, expectedVersion: version }), { success: "Task added." }); if (ok) setNewTask(""); }}>
            <label className="sr-only" htmlFor={`nt-${goal.id}`}>New task</label>
            <Input id={`nt-${goal.id}`} placeholder="Add a task" value={newTask} onChange={(e) => setNewTask(e.target.value)} maxLength={1000} />
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>Add task</Button>
          </form>
        ) : phase !== "OPEN" && phase !== "LATE_OPEN" ? <p className="flex items-center gap-1 text-xs text-muted"><Lock className="h-3 w-3" aria-hidden />Definition locked</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          {smart ? <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"} SMART details</Button> : null}
          {canMutate ? (<>
            <Button size="sm" variant="secondary" onClick={onEdit}>Edit goal</Button>
            <ConfirmButton label="Delete goal" variant="secondary" title="Delete goal" description="The goal and its tasks are soft-deleted (kept in the audit trail) and excluded from scoring."
              onConfirm={() => run(() => apiRequest("POST", `goals/${goal.id}/delete`, { expectedVersion: version }), { success: "Goal deleted." })} />
          </>) : null}
        </div>
        {open && smart ? <SmartPanel data={smart} /> : null}
        {ic ? <IntegrityDialog task={ic} open onOpenChange={(o) => !o && setIc(null)} /> : null}
      </div>
    </Card>
  );
}

function EditTaskButton({ taskId, text, version }: { taskId: string; text: string; version: number }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(text);
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setV(text); setOpen(true); }}>Edit</Button>
      <Modal open={open} onOpenChange={setOpen} title="Edit task">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
          const ok = await run(() => apiRequest("PATCH", `tasks/${taskId}`, { description: v, expectedVersion: version }), { success: "Task updated." }); if (ok) setOpen(false); }}>
          <Label htmlFor={`et-${taskId}`}>Task</Label>
          <Textarea id={`et-${taskId}`} value={v} onChange={(e) => setV(e.target.value)} maxLength={1000} required />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !v.trim()}>Save</Button></div>
        </form>
      </Modal>
    </>
  );
}

function GoalForm({ reportId, version, subKrs, goal, onClose }: { reportId: string; version: number; subKrs: SubKr[]; goal?: GoalView; onClose: () => void }) {
  const { run, pending } = useAction();
  const [type, setType] = useState<"KR_ALIGNED" | "STRETCH">(goal?.goal_type ?? "KR_ALIGNED");
  const [subKr, setSubKr] = useState(goal?.sub_key_result?.id ?? "");
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [tasks, setTasks] = useState<string[]>(goal ? goal.tasks.map((t) => t.description) : [""]);
  const [preview, setPreview] = useState<SmartData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Live SMART guidance (debounced). Never blocks saving.
  useEffect(() => {
    if (!title.trim()) return;
    const t = setTimeout(() => {
      apiRequest<SmartData>("POST", "smart-evaluations", { goalType: type, subKeyResultId: type === "KR_ALIGNED" && subKr ? subKr : null, title, description: description || null, tasks: (goal ? goal.tasks.map((x) => x.description) : tasks).filter(Boolean) })
        .then(setPreview).catch(() => setPreview(null))
    }, 500);
    return () => clearTimeout(t);
  }, [title, description, type, subKr, tasks, goal]);

  const shownPreview = title.trim() ? preview : null;
  const taskList = tasks.map((t) => t.trim()).filter(Boolean);
  const valid = title.trim().length > 0 && (type === "STRETCH" || subKr) && (goal ? true : taskList.length > 0);

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={goal ? "Edit goal" : "Add a SMART goal"} description="Describe the outcome, link it to a Sub-KR (or mark it Stretch), then add its tasks.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        const body = { goalType: type, subKeyResultId: type === "KR_ALIGNED" ? subKr : null, title, description: description || null, expectedVersion: version };
        const out = goal
          ? await run(() => apiRequest("PATCH", `goals/${goal.id}`, body), { success: "Goal updated." })
          : await run(() => apiRequest("POST", `weekly-reports/${reportId}/goals`, { ...body, tasks: taskList.map((d) => ({ description: d })) }), { success: "Goal added." });
        if (out) onClose(); else setErr("The goal was not saved. See the message above.");
      }}>
        <fieldset className="flex gap-4">
          <legend className="mb-1 text-sm font-medium">Classification</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="gt" checked={type === "KR_ALIGNED"} onChange={() => setType("KR_ALIGNED")} />KR-aligned</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="gt" checked={type === "STRETCH"} onChange={() => { setType("STRETCH"); setSubKr(""); }} />Stretch (no Sub-KR applies)</label>
        </fieldset>
        {type === "KR_ALIGNED" ? (
          <div>
            <Label htmlFor="subkr">Sub-KR</Label>
            <Select id="subkr" value={subKr} onChange={(e) => setSubKr(e.target.value)} required>
              <option value="">Select a Sub-KR…</option>
              {subKrs.map((s) => <option key={s.id} value={s.id}>{s.kr} → {s.label}</option>)}
            </Select>
          </div>
        ) : null}
        <div><Label htmlFor="g-title">Goal</Label><Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} required placeholder="e.g. Publish 3 pricing sheets to all sales leads by Friday 17:00" /></div>
        <div><Label htmlFor="g-desc">Description (optional)</Label><Textarea id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></div>
        {!goal ? (
          <div className="space-y-2">
            <Label htmlFor="task-0">Tasks (at least one)</Label>
            {tasks.map((t, i) => (
              <div key={i} className="flex gap-2">
                <Input id={`task-${i}`} aria-label={`Task ${i + 1}`} value={t} maxLength={1000} onChange={(e) => setTasks((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
                {tasks.length > 1 ? <Button variant="ghost" size="sm" aria-label={`Remove task ${i + 1}`} onClick={() => setTasks((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button> : null}
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setTasks((l) => [...l, ""])}>Add another task</Button>
          </div>
        ) : <p className="text-sm text-muted">Manage this goal&apos;s tasks from the goal card.</p>}
        {shownPreview ? <SmartPanel data={shownPreview} /> : null}
        {err ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{err}</p> : null}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !valid}>{pending ? "Saving…" : "Save goal"}</Button></div>
      </form>
    </Modal>
  );
}