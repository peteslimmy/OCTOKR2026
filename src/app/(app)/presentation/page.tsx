import type { Metadata } from "next";
import Link from "next/link";
import { ComplianceBadge, ScoreText, SubmissionBadge, wat } from "@/components/status";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { activeWeeks, getReportView, getWeekOverview, recentFinalWeeks } from "@/lib/data";
import { getPublishedQuote } from "@/lib/data/governance";
import { getQuoteTurnsForWeek } from "@/lib/data/quote-rota";
import { QuoteReview } from "./quote-review";
import { PresentationTabs } from "./presentation-tabs";
import { BuIntelligenceSection } from "@/components/insights/intelligence";
import { LastWeekHint } from "./last-week-hint";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { PresenterView } from "./presenter-view";
import { QuotePresenter } from "./quote-presenter";
import { WeekStrip } from "./week-strip";
import { formatWeekLabel } from "@/lib/domain/week-label";

export const metadata: Metadata = { title: "Presentation" };

export default async function PresentationPage({ searchParams }: PageProps<"/presentation">) {
  const actor = await requireActor();
  if (!can(actor, "presentation.view")) return <Card><EmptyState title="Presentation mode is not available for your role" /></Card>;
  const sp = await searchParams;
  const weeks = [...(await activeWeeks()), ...(await recentFinalWeeks(52))];
  const unique = weeks.filter((w, i) => weeks.findIndex((x) => x.id === w.id) === i);
  // Default to the week being presented: the most recent one that has passed content lock.
  const week = unique.find((w) => w.id === sp.week) ?? unique.find((w) => w.phase === "CONTENT_LOCKED" || w.status === "FINAL_LOCKED") ?? unique[0];
  if (!week) return <Card><EmptyState title="No reporting week yet">Weeks appear once a quarter is activated.</EmptyState></Card>;

  const [overview, turns] = await Promise.all([getWeekOverview(week.id), getQuoteTurnsForWeek(week.id).catch(() => [])]);
  // the week's quote, with the speakers of the sessions either side of it
  const ordered = [...unique].sort((a, b) => a.week_start_at.localeCompare(b.week_start_at));
  const at = ordered.findIndex((w) => w.id === week.id);
  const around = (w: (typeof ordered)[number] | undefined) => (w ? getPublishedQuote(w.id).catch(() => null) : Promise.resolve(null));
  const [quote, quoteBefore, quoteAfter] = await Promise.all([around(week), around(ordered[at - 1]), around(ordered[at + 1])]);
  const neighbour = (w: (typeof ordered)[number] | undefined, q: typeof quote) => (w ? `Week ${w.week_number}${q ? `: ${q.speaker_name}` : ""}` : null);
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(week.week_start_at));
  const idx = Math.max(0, overview.findIndex((o) => o.business_unit.id === sp.bu));
  const current = overview[idx];
  const view = current?.report_id ? await getReportView(current.report_id) : null;
  const base = `/presentation?week=${week.id}`;
  const prev = overview[(idx - 1 + overview.length) % overview.length];
  const next = overview[(idx + 1) % overview.length];
  // the quote has its own tab; it is offered only when there is a quote turn to review or the person can assign one
  const hasQuoteTab = turns.length > 0 || can(actor, "quote.assign");
  const tab = hasQuoteTab && sp.view === "quote" ? "quote" : "units";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Presentation mode</h1>
          <p className="mt-1 text-sm text-muted">{`${formatWeekLabel(week)} · final lock ${wat(week.final_lock_at)}`}</p>
        </div>
        <WeekStrip currentId={week.id} view={tab === "quote" ? "quote" : undefined} weeks={unique.map((w) => ({ id: w.id, label: formatWeekLabel(w), holiday: w.reporting_state === "ORGANIZATION_HOLIDAY" }))} />
        {quote && turns.length === 0 ? <QuotePresenter quote={quote.quote} speaker={quote.speaker_name} businessUnit={quote.business_unit} session={`Week ${week.week_number} · ${month}`}
          previous={neighbour(ordered[at - 1], quoteBefore)} next={neighbour(ordered[at + 1], quoteAfter)} /> : null}
        <Link href="/dashboard" className="shrink-0 rounded-lg border border-line bg-panel px-4 py-2 text-sm">Exit presentation</Link>
      </div>
      <PresentationTabs weekId={week.id} active={tab} showQuote={hasQuoteTab} />
      {tab === "quote" ? <QuoteReview turns={turns} weekLabel={formatWeekLabel(week)} session={`Week ${week.week_number} · ${month}`} canAssign={can(actor, "quote.assign")} />
      : week.reporting_state === "ORGANIZATION_HOLIDAY" ? <Card><EmptyState title="ORGANIZATION HOLIDAY · REPORT NOT REQUIRED">No BU reports are due for this week.</EmptyState></Card> : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card>
            <nav aria-label="Business units" className="max-h-[calc(100vh-13rem)] overflow-y-auto"><ul className="divide-y divide-line">
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
            {current ? (
              view ? <PresenterView view={view} canCorrect={can(actor, "integrity_correction.create")}
                    prevHref={`${base}&bu=${prev.business_unit.id}`} nextHref={`${base}&bu=${next.business_unit.id}`} buName={current.business_unit.name}
                    intelligence={<BuIntelligenceSection buId={current.business_unit.id} buName={current.business_unit.name} quarterId={week.quarter_id} compact />}
                    lastWeek={<LastWeekHint weekId={week.id} buId={current.business_unit.id} buName={current.business_unit.name} />} />
                : (<Card><EmptyState title={`${current.business_unit.name} has no report for this week`}>
                    <span className="flex flex-wrap items-center justify-center gap-2"><SubmissionBadge status="NOT_SUBMITTED" /><ComplianceBadge status={current.compliance} /></span>
                  </EmptyState></Card>)
            ) : <Card><EmptyState title="No business units" /></Card>}
            {current ? <Card data-testid="presentation-executive-commentary"><CardHeader title="Executive commentary" description={`Observations and recommendations about ${current.business_unit.name} this week. Commenting changes nothing in the report.`}
              action={<ExecutiveCommentary module="PRESENTATION" subjectType="BUSINESS_UNIT" subjectId={current.business_unit.id} subjectLabel={`${current.business_unit.name} · ${formatWeekLabel(week)}`} businessUnitId={current.business_unit.id} quarterId={week.quarter_id} reportingWeekId={week.id} />} /></Card> : null}
          </div>
        </div>
      )}
    </>
  );
}
