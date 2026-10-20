import type { Metadata } from "next";
import Link from "next/link";
import { ComplianceBadge, ScoreText, SubmissionBadge, wat } from "@/components/status";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { activeWeeks, getReportView, getWeekOverview, recentFinalWeeks } from "@/lib/data";
import { LastWeekHint } from "./last-week-hint";
import { PresenterView } from "./presenter-view";
import { formatWeekLabel } from "@/lib/domain/week-label";

export const metadata: Metadata = { title: "Presentation" };

export default async function PresentationPage({ searchParams }: PageProps<"/presentation">) {
  const actor = await requireActor();
  if (!can(actor, "presentation.view")) return <Card><EmptyState title="Presentation mode is not available for your role" /></Card>;
  const sp = await searchParams;
  const weeks = [...(await activeWeeks()), ...(await recentFinalWeeks(6))];
  const unique = weeks.filter((w, i) => weeks.findIndex((x) => x.id === w.id) === i);
  // Default to the week being presented: the most recent one that has passed content lock.
  const week = unique.find((w) => w.id === sp.week) ?? unique.find((w) => w.phase === "CONTENT_LOCKED" || w.status === "FINAL_LOCKED") ?? unique[0];
  if (!week) return <Card><EmptyState title="No reporting week yet">Weeks appear once a quarter is activated.</EmptyState></Card>;

  const overview = await getWeekOverview(week.id);
  const idx = Math.max(0, overview.findIndex((o) => o.business_unit.id === sp.bu));
  const current = overview[idx];
  const view = current?.report_id ? await getReportView(current.report_id) : null;
  const base = `/presentation?week=${week.id}`;
  const prev = overview[(idx - 1 + overview.length) % overview.length];
  const next = overview[(idx + 1) % overview.length];

  return (
    <>
      <PageHeader title="Presentation mode" description={`${formatWeekLabel(week)} · final lock ${wat(week.final_lock_at)}`}
        actions={<Link href="/dashboard" className="rounded-lg border border-line bg-panel px-4 py-2 text-sm">Exit presentation</Link>} />
      <div className="mb-4 flex flex-wrap gap-2" role="navigation" aria-label="Reporting weeks">
        {unique.map((w) => (
          <Link key={w.id} href={`/presentation?week=${w.id}`} aria-current={w.id === week.id ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${w.id === week.id ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel"}`}>
            {formatWeekLabel(w)}{w.reporting_state === "ORGANIZATION_HOLIDAY" ? " (holiday)" : ""}
          </Link>
        ))}
      </div>
      {week.reporting_state === "ORGANIZATION_HOLIDAY" ? <Card><EmptyState title="ORGANIZATION HOLIDAY · REPORT NOT REQUIRED">No BU reports are due for this week.</EmptyState></Card> : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card>
            <nav aria-label="Business units"><ul className="divide-y divide-line">
              {overview.map((o, i) => (
                <li key={o.business_unit.id}>
                  <Link href={`${base}&bu=${o.business_unit.id}`} aria-current={i === idx ? "page" : undefined}
                    className={`flex items-center justify-between gap-2 px-4 py-3 text-sm ${i === idx ? "bg-brand-100 font-semibold text-brand-800" : "hover:bg-surface"}`}>
                    <span>{o.business_unit.name}</span>
                    {o.final_score !== null ? <ScoreText value={o.final_score} /> : o.submission_status === "SUBMITTED" ? <Badge tone="done">Submitted</Badge> : <Badge tone="warn">None</Badge>}
                  </Link>
                </li>
              ))}
            </ul></nav>
          </Card>
          <div className="space-y-4">
            {current ? <div className="flex justify-end"><LastWeekHint weekId={week.id} buId={current.business_unit.id} buName={current.business_unit.name} /></div> : null}
            {current ? (
              view ? <PresenterView view={view} canCorrect={can(actor, "integrity_correction.create")}
                    prevHref={`${base}&bu=${prev.business_unit.id}`} nextHref={`${base}&bu=${next.business_unit.id}`} buName={current.business_unit.name} />
                : (<Card><EmptyState title={`${current.business_unit.name} has no report for this week`}>
                    <span className="flex flex-wrap items-center justify-center gap-2"><SubmissionBadge status="NOT_SUBMITTED" /><ComplianceBadge status={current.compliance} /></span>
                  </EmptyState></Card>)
            ) : <Card><EmptyState title="No business units" /></Card>}
          </div>
        </div>
      )}
    </>
  );
}
