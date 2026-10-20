import type { Metadata } from "next";
import Link from "next/link";
import { ComplianceBadge, PhaseBadge, ScoreText, SubmissionBadge, wat } from "@/components/status";
import { Countdown } from "@/components/ui/client";
import { RankingExplorer } from "./ranking-explorer";
import { Hero } from "@/components/ui/hero";
import { AnalyticsDashboard } from "@/components/analytics/dashboard";
import { getDashboardCells } from "@/lib/data/analytics";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge, Banner, buttonClass, Card, CardHeader, EmptyState, PageHeader, ScoreBar } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import {
  activeWeeks, currentQuarter, getExecutiveDashboard, getReportView, latestQuarterSnapshot, recentSnapshots, reportIdFor, serverNow,
} from "@/lib/data";
import { fundSummaryOrNull, listAmendments, listDisbursements, listSessions, listViolations } from "@/lib/data/governance";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { getLockSchedule } from "@/lib/data/config";
import { contentLockPhrase } from "@/lib/domain/schedule";
import { formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requireActor();
  const isExec = can(actor, "dashboard.executive.view");
  const isBu = can(actor, "weekly_report.view_own_bu") && !!actor.buId;
  const isHr = can(actor, "attendance.session.manage") || can(actor, "violation.create");
  const isFin = can(actor, "disbursement.approve");
  return (
    <>
      <Hero name={actor.name.split(" ")[0]} actions={[
        can(actor, "violation.create") && { href: "/governance/violations?new=violation", label: "Report a violation" },
        can(actor, "disbursement.create") && { href: "/finance?new=disbursement", label: "Request a disbursement" },
        can(actor, "weekly_report.create") && { href: "/weekly", label: "Weekly report" },
        can(actor, "users.manage") && { href: "/admin/people?new=user", label: "Add a user" },
        can(actor, "reports.view") && { href: "/reports", label: "Open reports" },
      ].filter((a): a is { href: string; label: string } => !!a)} />
      <div className="space-y-8">
        {isBu || isExec || isHr || isFin ? <Analytics /> : null}
        {isBu ? <BuDashboard buId={actor.buId!} buName={actor.buName ?? "your BU"} /> : null}
        {isHr ? <HrDashboard canViolations={can(actor, "violation.create")} /> : null}
        {isFin ? <FinanceDashboard /> : null}
        {isExec ? <ExecutiveDashboard /> : null}
        {!isBu && !isExec && !isHr && !isFin ? (
          <Card><EmptyState title="Nothing to show yet">Your role does not have an operational dashboard. Use the navigation to open the areas you can access.</EmptyState></Card>
        ) : null}
      </div>
    </>
  );
}

async function BuDashboard({ buId, buName }: { buId: string; buName: string }) {
  const [weeks, quarter, schedule] = await Promise.all([activeWeeks(), currentQuarter(), getLockSchedule()]);
  const rows = await Promise.all(weeks.map(async (w) => {
    const id = await reportIdFor(buId, w.id);
    return { week: w, id, view: id ? await getReportView(id) : null };
  }));
  const [qs, recent] = await Promise.all([quarter ? latestQuarterSnapshot(quarter.id, buId) : null, recentSnapshots(buId, 6)]);
  const latestPerWeek = new Map<string, (typeof recent)[number]>();
  for (const s of recent) if (!latestPerWeek.has(s.reporting_week_id)) latestPerWeek.set(s.reporting_week_id, s);

  return (
    <section aria-labelledby="bu-h" className="space-y-4">
      <h2 id="bu-h" className="text-lg font-semibold">{buName} — this week</h2>
      {rows.length === 0 ? (
        <Card><EmptyState title="No reporting week is open">A reporting week opens every Monday 00:00 WAT. If a quarter is not active, ask an Admin to activate it.</EmptyState></Card>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3" aria-label="Quarter at a glance">
        <MetricCard label="Quarter execution score" value={qs?.score === null || qs?.score === undefined ? null : Number(qs.score)} kind="percent"
          note={qs ? (qs.calculation_status === "FINAL" ? "Final" : "Provisional until reports are reviewed") : "Calculated after the first week is finalised."}
          definition="The average of your weekly scores over every reportable week in the quarter. A week with no report counts as zero; holiday weeks are left out."
          href="/reports/bu-scorecard" hrefLabel="Scorecard" />
        <MetricCard label="Weeks with no report" value={qs ? Number(qs.missing_report_zero_count) : null}
          definition="Reportable weeks in this quarter where no report was submitted by the final lock. Each one scored zero and was recorded as non-compliant."
          href="/reports/weekly-compliance" hrefLabel="Compliance by week" />
        <MetricCard label="Reportable weeks" value={qs ? Number(qs.denominator_count) : null}
          note={qs ? `${qs.excluded_holiday_count} holiday ${Number(qs.excluded_holiday_count) === 1 ? "week" : "weeks"} excluded` : undefined}
          definition="The finalised weeks that count toward your quarterly score: every week except organisation holidays." />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ week, id, view }) => {
          const holiday = week.reporting_state === "ORGANIZATION_HOLIDAY";
          return (
            <Card key={week.id}>
              <CardHeader
                title={formatWeekLabel(week)}
                description={`${wat(week.week_start_at, { day: "numeric", month: "short" })} → final lock ${wat(week.final_lock_at)}`}
                action={week.phase ? <PhaseBadge phase={week.phase} /> : undefined}
              />
              <div className="space-y-3 px-6 py-4 text-sm">
                {holiday ? (
                  <Banner tone="info" title="ORGANIZATION HOLIDAY · REPORT NOT REQUIRED">No weekly report is due for this week and it is excluded from your quarterly score.</Banner>
                ) : view ? (
                  <>
                    {view.session_outcome === "SKIPPED" ? <Badge tone="warn">OKR session skipped — performance summary required</Badge> : null}
                    <div className="flex flex-wrap items-center gap-2"><SubmissionBadge status={view.report.submission_status} /><ComplianceBadge status={view.compliance?.status} /></div>
                    <dl className="grid grid-cols-3 gap-4">
                      <div><dt className="text-muted">Goals</dt><dd className="text-xl font-semibold tabular-nums">{view.score_preview.total_goals}</dd></div>
                      <div><dt className="text-muted">Done</dt><dd className="text-xl font-semibold tabular-nums">{view.score_preview.done_goals}</dd></div>
                      <div><dt className="text-muted">{view.snapshot ? "Final score" : "Score preview"}</dt>
                        <dd className="text-xl font-semibold"><ScoreText value={view.snapshot?.final_score ?? view.score_preview.final_score} /></dd></div>
                    </dl>
                    <div className="flex flex-wrap gap-4 text-muted">
                      <Countdown to={week.content_lock_at} label="Content lock" /><Countdown to={week.final_lock_at} label="Final lock" />
                    </div>
                  </>
                ) : week.phase === "OPEN" ? (
                  <p className="text-muted">No report started. Add at least one SMART goal and submit before {contentLockPhrase(schedule.active)} WAT.</p>
                ) : (
                  <Banner tone="critical" title="No report was filed for this week">Reports can no longer be started after content lock. At final lock this week scores 0.00 and is recorded as non-compliant{week.phase === "FINAL_LOCKED" ? "" : " unless an authorised exception applies"}.</Banner>
                )}
                {!holiday && (id || week.phase === "OPEN") ? (
                  <Link href={id ? `/weekly/${id}` : `/weekly?start=${week.id}`} className={buttonClass(id ? "secondary" : "primary", "sm")}>
                    {id ? "Open report" : "Start report"}
                  </Link>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader title="Quarter execution score"
          description="Arithmetic mean over every non-holiday reporting week in the quarter. A week with no report counts as 0.00."
          action={qs ? <Badge tone={qs.calculation_status === "FINAL" ? "done" : "warn"}>{qs.calculation_status === "FINAL" ? "Final" : "Provisional"}</Badge> : undefined} />
        <div className="grid gap-6 px-6 py-4 sm:grid-cols-[200px_1fr]">
          <div>
            <p className="text-3xl font-semibold"><ScoreText value={qs?.score} /></p>
            <p className="mt-1 text-xs text-muted">
              {qs ? `${qs.denominator_count} reportable weeks · ${qs.missing_report_zero_count} missing · ${qs.excluded_holiday_count} holiday excluded · v${qs.version_number}` : "Calculated after the first week is finalised."}
              {qs?.score === null ? ` (${qs.score_reason})` : ""}
            </p>
          </div>
          <div>
            {latestPerWeek.size === 0 ? <p className="text-sm text-muted">No finalised weeks yet.</p> : (
              <ul className="space-y-2">
                {[...latestPerWeek.values()].map((s) => (
                  <li key={s.reporting_week_id} className="grid grid-cols-[88px_1fr_72px] items-center gap-2 text-sm">
                    <span className="text-muted" title={formatWeekLabel(s.reporting_weeks)}>W{s.reporting_weeks.week_number}</span>
                    <ScoreBar value={Number(s.final_score)} label={`${formatWeekLabel(s.reporting_weeks)} score`} />
                    <span className="text-right tabular-nums">{s.score_state === "NOT_SUBMITTED" ? "No report" : formatPercent(s.final_score)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}

const naira = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));

async function HrDashboard({ canViolations }: { canViolations: boolean }) {
  const [sessions, pending, violations, fund] = await Promise.all([
    listSessions(3), listAmendments("PENDING").catch(() => []), canViolations ? listViolations() : Promise.resolve([]), fundSummaryOrNull(),
  ]);
  const next = sessions[0];
  const open = violations.filter((v) => v.status === "OPEN");
  return (
    <section aria-labelledby="hr-h" className="space-y-4">
      <h2 id="hr-h" className="text-lg font-semibold">Governance</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5"><p className="text-sm text-muted">Latest OKR session</p>
          {next ? <><p className="mt-1 text-lg font-semibold">{formatWeekLabel(next.reporting_weeks)}</p>
            <p className="mt-1 flex flex-wrap gap-2"><Badge tone={next.outcome === "SKIPPED" ? "warn" : next.outcome === "HELD" ? "done" : "info"}>{next.outcome === "SKIPPED" ? "SKIPPED WEEK · VIRTUAL PRESENT" : next.outcome.toLowerCase()}</Badge></p>
            <Link href={`/governance/sessions/${next.id}`} className="mt-2 inline-block text-sm text-brand-700 underline">Open roster</Link></>
            : <><p className="mt-1 text-sm text-muted">No session yet.</p><Link href="/governance" className="mt-2 inline-block text-sm text-brand-700 underline">Create one</Link></>}</Card>
        <MetricCard label="Amendments awaiting decision" value={pending.length} href="/governance/amendments" hrefLabel="Review queue"
          definition="Attendance corrections that someone has asked for and nobody has approved or rejected yet. The person who asked cannot decide their own request." />
        {canViolations ? <MetricCard label="Open violations" value={open.length} note={`${naira(open.reduce((s, v) => s + Number(v.fine_amount), 0))} outstanding`}
          href="/governance/violations" hrefLabel="Manage violations" definition="Violations that have been recorded and not yet settled or waived. The amount is the sum of their fines." /> : null}
        {fund ? <MetricCard label="Violation fund (available)" value={Number(fund.available)} kind="currency" href="/finance" hrefLabel="Fund & requests"
          definition="Money received from settled violations, less money already disbursed or committed to approved requests." /> : null}
      </div>
    </section>
  );
}

async function FinanceDashboard() {
  const [fund, reqs] = await Promise.all([fundSummaryOrNull(), listDisbursements()]);
  const waiting = reqs.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW");
  const toRelease = reqs.filter((r) => r.status === "APPROVED");
  return (
    <section aria-labelledby="fin-h" className="space-y-4">
      <h2 id="fin-h" className="text-lg font-semibold">Finance</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Available to commit" value={fund ? Number(fund.available) : null} kind="currency"
          note={fund ? (fund.reconciled ? "✓ Ledger reconciled" : "⚠ Reconciliation mismatch") : undefined}
          definition="The fund balance after approved but not yet released requests are set aside." />
        <MetricCard label="Waiting for your decision" value={waiting.length} href="/finance" hrefLabel="Approval queue"
          definition="Disbursement requests that have been submitted or are under review and need an approve or reject decision." />
        <MetricCard label="Approved, awaiting release" value={toRelease.length} note={`${naira(toRelease.reduce((s, r) => s + Number(r.amount), 0))} committed`}
          definition="Requests that were approved but whose money has not been released yet. Release is a separate step by a different person." />
      </div>
    </section>
  );
}

async function ExecutiveDashboard() {
  const quarter = await currentQuarter();
  if (!quarter) return <Card><EmptyState title="No quarter configured">An Admin needs to create and activate a quarter.</EmptyState></Card>;
  const [d, fund] = await Promise.all([getExecutiveDashboard(quarter.id), fundSummaryOrNull()]);
  return (
    <section aria-labelledby="exec-h" className="space-y-4">
      <h2 id="exec-h" className="text-lg font-semibold">Organisation execution — Q{quarter.quarter_number} {quarter.year}</h2>
      {(() => {
        const scored = d.ranking.filter((r) => r.quarter_score !== null && r.quarter_score !== undefined).map((r) => Number(r.quarter_score));
        const avg = scored.length ? scored.reduce((x, y) => x + y, 0) / scored.length : null;
        const withMissing = d.ranking.filter((r) => Number(r.missing_report_zero_count ?? 0) > 0).length;
        const prov = d.ranking.some((r) => r.quarter_status === "PROVISIONAL");
        return (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Organisation at a glance">
            <MetricCard label="Average BU quarter score" value={avg} kind="percent" note={scored.length ? `${scored.length} of ${d.ranking.length} BUs scored${prov ? " · some provisional" : ""}` : "No scores yet"}
              definition="The plain average of each Business Unit's quarterly execution score. It does not weight units by size, and it is not a ranking: read it with the trend."
              href="/reports/performance-trends" hrefLabel="Trends" />
            <MetricCard label="BUs with missing reports" value={withMissing} note={`of ${d.ranking.length} Business Units`}
              definition="Business Units that have at least one reportable week with no submitted report this quarter."
              href="/reports/reporting-register" hrefLabel="Reporting register" />
            <MetricCard label="Non-compliant weeks recorded" value={d.non_compliant.length}
              definition="Finalised BU-weeks with no report by the final lock. A later authorised late report does not change this record."
              href="/reports/weekly-compliance" hrefLabel="Compliance by week" />
            <MetricCard label="Integrity corrections" value={d.integrity.total} note={`${d.integrity.applied} penalised · ${d.integrity.waived} waived`}
              definition="Corrections made to goal or task definitions after the content lock. Each needs a reason and either applies or waives the penalty."
              href="/reports/integrity-corrections" hrefLabel="Corrections" />
          </div>
        );
      })()}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Business Unit ranking" description="Ranked by quarterly execution score (primary). Weekly score is for the latest finalised week." />
          <RankingExplorer rows={d.ranking} quarterId={quarter.id} />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Non-compliance" description="Weeks with no submitted report at final lock." />
            {d.non_compliant.length === 0 ? <EmptyState title="No non-compliance recorded">Every finalised week so far had a submitted report.</EmptyState> : (
              <ul className="divide-y divide-line">
                {d.non_compliant.slice(0, 8).map((n, i) => (
                  <li key={i} className="flex items-center justify-between px-6 py-3 text-sm"><span className="font-medium">{n.business_unit}</span>
                    <span className="text-muted">{new Date(n.week_start_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}</span></li>
                ))}
              </ul>
            )}
          </Card>
          {fund ? (
            <Card>
              <CardHeader title="Violation fund" description="Read-only summary" />
              <dl className="grid grid-cols-2 gap-4 px-6 py-4 text-sm">
                <div><dt className="text-muted">Available</dt><dd className="text-xl font-semibold tabular-nums">{naira(fund.available)}</dd></div>
                <div><dt className="text-muted">Pending decisions</dt><dd className="text-xl font-semibold tabular-nums">{fund.pending_requests}</dd></div>
                <div><dt className="text-muted">Inflows</dt><dd className="tabular-nums">{naira(fund.inflow)}</dd></div>
                <div><dt className="text-muted">Outflows</dt><dd className="tabular-nums">{naira(fund.outflow)}</dd></div>
              </dl>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Integrity corrections" />
            <dl className="grid grid-cols-3 gap-4 px-6 py-4 text-sm">
              <div><dt className="text-muted">Total</dt><dd className="text-xl font-semibold tabular-nums">{d.integrity.total}</dd></div>
              <div><dt className="text-muted">Penalty applied</dt><dd className="text-xl font-semibold tabular-nums">{d.integrity.applied}</dd></div>
              <div><dt className="text-muted">Waived</dt><dd className="text-xl font-semibold tabular-nums">{d.integrity.waived}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
      <Card>
        <CardHeader title="Sub-KR goal execution"
          description="Share of mapped goals done in finalised, submitted reports. This is an execution metric, not proof that the underlying KR outcome was attained." />
        <div className="divide-y divide-line">
          {d.strategy.key_results.map((kr) => (
            <div key={kr.id} className="px-6 py-4">
              <h3 className="text-sm font-semibold">{kr.code} · {kr.title}</h3>
              <ul className="mt-2 space-y-2">
                {kr.sub_key_results.map((s) => (
                  <li key={s.id} className="grid grid-cols-1 items-center gap-2 text-sm sm:grid-cols-[1fr_200px_120px]">
                    <span>{s.code} {s.title}</span>
                    {s.execution === null ? <span className="text-muted">No mapped goals yet</span> : <ScoreBar value={Number(s.execution)} label={`${s.code} execution`} />}
                    <span className="text-muted tabular-nums sm:text-right">{s.done_goals}/{s.mapped_goals} goals</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {d.strategy.key_results.length === 0 ? <EmptyState title="No key results yet">Create the quarterly objective and its 3–4 key results under Strategy.</EmptyState> : null}
        </div>
      </Card>
    </section>
  );
}

async function Analytics() {
  const [quarter, now] = await Promise.all([currentQuarter(), serverNow()]);
  if (!quarter) return null;
  const cells = await getDashboardCells(quarter.id);
  return <AnalyticsDashboard cells={cells} nowIso={now} quarterLabel={`Q${quarter.quarter_number} ${quarter.year}`} />;
}
