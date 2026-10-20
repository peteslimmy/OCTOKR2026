import type { Metadata } from "next";
import Link from "next/link";
import { ScoreText, wat } from "@/components/status";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listLateCandidates, listLateExceptions, type LateExceptionRow } from "@/lib/data/governance";
import { ApplyButton, AuthoriseButton, RevokeButton } from "./late-actions";
import { formatWeekLabel } from "@/lib/domain/week-label";

export const metadata: Metadata = { title: "Late reports" };

const TONE = { AUTHORISED: "warn", SUBMITTED: "info", APPLIED: "done", REVOKED: "critical" } as const;
const LABEL = { AUTHORISED: "Authorised — awaiting the BU", SUBMITTED: "Submitted — awaiting review", APPLIED: "Score amended", REVOKED: "Closed without amendment" } as const;

export default async function LateReportsPage() {
  const actor = await requireActor();
  const amend = can(actor, "quarter.score.amend");
  const review = can(actor, "weekly_report.review");
  if (!amend && !review) {
    return <Card><EmptyState title="Late-report amendments are not available for your role" /></Card>;
  }
  const [rows, candidates] = await Promise.all([listLateExceptions(), amend ? listLateCandidates() : Promise.resolve([])]);
  const live = rows.filter((r) => r.status === "AUTHORISED" || r.status === "SUBMITTED");
  const done = rows.filter((r) => r.status === "APPLIED" || r.status === "REVOKED");

  return (
    <>
      <PageHeader title="Late-report amendments"
        description="A Business Unit that missed a weekly report can be authorised to file it late. After the report is submitted and reviewed, a different approver applies it: a new weekly and quarterly score version is created. The original zero, earlier scores and compliance history are never changed, and the quarter is not reopened."
        actions={<Link href="/governance" className={buttonClass("secondary", "sm")}>Governance</Link>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`In progress (${live.length})`} />
          {live.length === 0 ? <EmptyState title="No late reports in progress" /> : (
            <ul className="divide-y divide-line">
              {live.map((r) => <ExceptionItem key={r.id} r={r} actorId={actor.id} amend={amend} review={review} />)}
            </ul>
          )}
        </Card>
        {amend ? (
          <Card>
            <CardHeader title={`Missing reports that can be accepted late (${candidates.length})`} description="Finalised weeks where a Business Unit filed nothing and was scored 0.00." />
            {candidates.length === 0 ? <EmptyState title="No missing reports" /> : (
              <ul className="divide-y divide-line">
                {candidates.map((c) => (
                  <li key={`${c.business_unit_id}-${c.reporting_week_id}`} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.business_unit}</span> · {formatWeekLabel(c)}
                      {c.quarter_locked ? <Badge tone="locked">Quarter locked</Badge> : null}
                    </span>
                    <AuthoriseButton businessUnitId={c.business_unit_id} reportingWeekId={c.reporting_week_id} label={`${c.business_unit}, ${formatWeekLabel(c)}`} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
        <Card>
          <CardHeader title="History" description="Read-only. Every step is recorded." />
          {done.length === 0 ? <EmptyState title="No completed amendments yet" /> : (
            <ul className="divide-y divide-line">
              {done.map((r) => <ExceptionItem key={r.id} r={r} actorId={actor.id} amend={false} review={false} />)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ExceptionItem({ r, actorId, amend, review }: { r: LateExceptionRow; actorId: string; amend: boolean; review: boolean }) {
  const label = `${r.business_unit}, ${formatWeekLabel(r)}`;
  const reviewedByMe = r.reviewed_by_id === actorId;
  return (
    <li className="space-y-3 px-6 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{r.business_unit} <span className="font-normal text-muted">· {formatWeekLabel(r)}</span></p>
        <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
      </div>
      <p><span className="text-muted">Authorised by {r.authorised_by} · {wat(r.authorised_at)} — reason:</span> {r.reason}</p>
      {r.amendment ? (
        <p>
          Weekly score <ScoreText value={r.amendment.old_weekly_score} /> → <ScoreText value={r.amendment.new_weekly_score} /> · Quarterly score{" "}
          <ScoreText value={r.amendment.old_quarterly_score} /> → <ScoreText value={r.amendment.new_quarterly_score} />
          {r.amendment.quarter_locked ? " (quarter was locked; not reopened)" : ""}
        </p>
      ) : null}
      {r.revoke_reason ? <p><span className="text-muted">Closed — reason:</span> {r.revoke_reason}</p> : null}
      <ol className="space-y-1 text-muted">
        {r.events.map((e, i) => <li key={i}>{wat(e.at)} · {e.type.toLowerCase().replace("_", " ")}{e.actor ? ` by ${e.actor}` : ""}</li>)}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {r.weekly_report_id && r.status === "SUBMITTED"
          ? <Link className={buttonClass("secondary", "sm")} href={`/weekly/${r.weekly_report_id}`}>{review ? "Open report to review" : "Open report"}</Link> : null}
        {amend && r.status === "SUBMITTED" && r.review_status === "REVIEWED"
          ? (reviewedByMe ? <Badge tone="info">You reviewed this — a different approver must apply it</Badge> : <ApplyButton id={r.id} label={label} />) : null}
        {amend && r.status === "SUBMITTED" && r.review_status !== "REVIEWED" ? <Badge tone="warn">Not reviewed yet</Badge> : null}
        {amend && (r.status === "AUTHORISED" || r.status === "SUBMITTED") ? <RevokeButton id={r.id} submitted={r.status === "SUBMITTED"} /> : null}
      </div>
    </li>
  );
}
