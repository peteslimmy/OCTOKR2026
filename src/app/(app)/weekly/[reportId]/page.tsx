import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requireActor } from "@/lib/auth/actor";
import { getReportView, getStrategyTree, getWeek, listBuGoals } from "@/lib/data";
import { getBuWeekTrend } from "@/lib/data/analytics";
import { BuIntelligenceSection } from "@/components/insights/intelligence";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { ReportEditor } from "./report-editor";

export const metadata: Metadata = { title: "Weekly report" };

export default async function ReportPage({ params }: PageProps<"/weekly/[reportId]">) {
  const { reportId } = await params;
  const actor = await requireActor();
  const view = await getReportView(reportId); // RLS: a report from another BU is simply not found
  if (!view) notFound();
  const week = await getWeek(view.week.id);
  const [tree, buGoals, trend] = week ? await Promise.all([getStrategyTree(week.quarter_id), listBuGoals(view.business_unit.id, week.quarter_id), getBuWeekTrend(view.business_unit.id, week.quarter_id).catch(() => [])]) : [null, [], []];
  // a Super Admin may work any unit's report; everyone else only their own unit's
  const ownBu = actor.buId === view.business_unit.id || can(actor, "weekly_report.file_for_any_bu");
  return (
    <>
    <div className="mb-3 flex justify-end"><ExecutiveCommentary module="WEEKLY_REPORT" subjectType="WEEKLY_REPORT" subjectId={view.report.id} subjectLabel={`${view.business_unit.name} · weekly report, week ${view.week.week_number}`} businessUnitId={view.business_unit.id} quarterId={week?.quarter_id ?? null} reportingWeekId={view.week.id} /></div>
    <ReportEditor
      view={view}
      trend={trend}
      intelligence={week ? <BuIntelligenceSection buId={view.business_unit.id} buName={view.business_unit.name} quarterId={week.quarter_id} /> : null}
      currentWeek={`W${view.week.week_number}`}
      buGoals={buGoals.filter((g) => g.status === "ACTIVE").map((g) => ({ id: g.id, code: g.code, title: g.title }))}
      subKrs={(tree?.key_results ?? []).flatMap((k) => k.sub_key_results.map((s) => ({ id: s.id, label: `${s.code} · ${s.title}`, kr: `${k.code} · ${k.title}` })))}
      caps={{
        edit: ownBu && can(actor, "weekly_report.edit"),
        submit: ownBu && can(actor, "weekly_report.submit"),
        execute: ownBu && can(actor, "task.execute"),
        review: can(actor, "weekly_report.review"),
        integrity: can(actor, "integrity_correction.create"),
      }}
    />
    </>
  );
}
