import type { Metadata } from "next";
import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { activeWeeks, listBusinessUnits, recentFinalWeeks, type ReportingWeek } from "@/lib/data";
import { getWeekQuote, listActiveEmployees, listAmendments, listSessionCorrections, listViolations, sessionForWeek } from "@/lib/data/governance";
import { CreateSessionButton, QuoteForm, QuoteStepButton } from "./governance-actions";
import { CorrectionQueue } from "./session-correction-actions";
import { formatWeekLabel } from "@/lib/domain/week-label";

export const metadata: Metadata = { title: "Governance" };

const OUTCOME_TONE = { SCHEDULED: "info", HELD: "done", SKIPPED: "warn" } as const;

export default async function GovernancePage() {
  const actor = await requireActor();
  const manage = can(actor, "attendance.session.manage");
  if (!manage && !can(actor, "violation.create") && !can(actor, "attendance.amendment.view") && !can(actor, "attendance.amendment.request")) {
    return <Card><EmptyState title="Governance is not available for your role" /></Card>;
  }
  const weeks: ReportingWeek[] = [...(await activeWeeks()), ...(await recentFinalWeeks(6))].filter((w, i, a) => a.findIndex((x) => x.id === w.id) === i)
    .sort((a, b) => b.week_start_at.localeCompare(a.week_start_at));
  const rows = await Promise.all(weeks.map(async (w) => ({ week: w, session: await sessionForWeek(w.id), quote: await getWeekQuote(w.id) })));
  const [pending, violations, bus] = await Promise.all([
    can(actor, "attendance.amendment.view") || can(actor, "attendance.amendment.approve") ? listAmendments("PENDING") : Promise.resolve([]),
    can(actor, "violation.create") ? listViolations() : Promise.resolve([]),
    listBusinessUnits(),
  ]);
  const people = can(actor, "quote.record") ? (await listActiveEmployees().catch(() => [])).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, unit: e.business_units?.name ?? "" })) : [];
  const open = violations.filter((v) => v.status === "OPEN");
  const seesCorrections = manage || can(actor, "attendance.session.outcome.request") || can(actor, "attendance.session.outcome.approve");
  const corrections = seesCorrections ? await listSessionCorrections() : [];
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

  return (
    <>
      <PageHeader title="Governance" description="Weekly OKR sessions, attendance, violations and the weekly quote. Attendance is independent of the reporting locks."
        actions={<>
          <Link href="/governance/amendments" className={buttonClass("secondary", "sm")}>Amendments{pending.length ? ` (${pending.length} pending)` : ""}</Link>
          {can(actor, "violation.create") ? <Link href="/violations?tab=violations" className={buttonClass("secondary", "sm")}>Violations{open.length ? ` (${open.length} open)` : ""}</Link> : null}
        </>} />
      <Card>
        <CardHeader title="OKR sessions by reporting week" description="Each session presents the week that final-locks that day." />
        {rows.length === 0 ? <EmptyState title="No reporting weeks yet">Activate a quarter to schedule weeks.</EmptyState> : (
          <ul className="divide-y divide-line">
            {rows.map(({ week, session, quote }) => (
              <li key={week.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="space-y-1">
                  <p className="font-medium">{formatWeekLabel(week)} <span className="text-sm font-normal text-muted">· final lock {wat(week.final_lock_at)}</span></p>
                  <div className="flex flex-wrap gap-2">
                    {week.reporting_state === "ORGANIZATION_HOLIDAY" ? <Badge tone="info">ORGANIZATION HOLIDAY · REPORT NOT REQUIRED</Badge> : null}
                    {session ? <Badge tone={OUTCOME_TONE[session.outcome as keyof typeof OUTCOME_TONE] ?? "undefined"}>{session.outcome === "SKIPPED" ? "SKIPPED WEEK · VIRTUAL PRESENT" : `Session ${session.outcome.toLowerCase()}`}</Badge> : <Badge tone="undefined">No session yet</Badge>}
                    {session && session.roster_status !== "NONE" ? <Badge tone={session.roster_status === "FINALIZED" ? "locked" : "warn"}>{session.roster_status === "FINALIZED" ? "Roster finalised" : "Roster in draft"}</Badge> : null}
                  </div>
                  {quote ? <p className="text-sm text-muted">“{quote.quote}” — {quote.speaker_name} <Badge tone={quote.status === "published" ? "done" : "info"}>{quote.status.toUpperCase()}</Badge></p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {session ? <Link href={`/governance/sessions/${session.id}`} className={buttonClass("primary", "sm")}>Open session</Link>
                    : manage && week.reporting_state === "NORMAL" ? <CreateSessionButton weekId={week.id} /> : null}
                  {quote && can(actor, "quote.record") && quote.status === "draft" ? <QuoteStepButton quoteId={quote.id} step="submit" /> : null}
                  {quote && can(actor, "quote.approve") && quote.status === "submitted" && actor.id !== quote.recorded_by && actor.id !== quote.submitted_by ? <QuoteStepButton quoteId={quote.id} step="approve" /> : null}
                  {quote && can(actor, "quote.approve") && quote.status === "approved" ? <QuoteStepButton quoteId={quote.id} step="publish" /> : null}
                  {quote && can(actor, "quote.approve") && quote.status === "published" ? <QuoteStepButton quoteId={quote.id} step="archive" /> : null}
                  {can(actor, "quote.record") && !quote && week.reporting_state === "NORMAL" ? <QuoteForm weekId={week.id} people={people} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {seesCorrections ? (
        <Card className="mt-6">
          <CardHeader title="Session outcome corrections" description="A session recorded as held or skipped by mistake can be reopened. One person asks, a different person approves, and someone other than the asker executes it. The earlier roster is archived, never edited or lost." />
          <CorrectionQueue me={actor.id} canApprove={can(actor, "attendance.session.outcome.approve")} canExecute={can(actor, "attendance.session.outcome.correct")}
            items={corrections.map((c) => ({ id: c.id, status: c.status, emergency: c.emergency, reason: c.reason, fromOutcome: c.from_outcome, weekLabel: formatWeekLabel(c), sessionId: c.session_id,
              requestedBy: c.requested_by, requestedById: c.requested_by_id, decidedBy: c.decided_by, executedBy: c.executed_by, comment: c.decision_comment, archivedRows: c.archived_rows, when: when(c.created_at) }))} />
        </Card>
      ) : null}
    </>
  );
}
