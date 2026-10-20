import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requireActor } from "@/lib/auth/actor";
import { getReportView, getStrategyTree, getWeek } from "@/lib/data";
import { ReportEditor } from "./report-editor";

export const metadata: Metadata = { title: "Weekly report" };

export default async function ReportPage({ params }: PageProps<"/weekly/[reportId]">) {
  const { reportId } = await params;
  const actor = await requireActor();
  const view = await getReportView(reportId); // RLS: a report from another BU is simply not found
  if (!view) notFound();
  const week = await getWeek(view.week.id);
  const tree = week ? await getStrategyTree(week.quarter_id) : null;
  const ownBu = actor.buId === view.business_unit.id;
  return (
    <ReportEditor
      view={view}
      subKrs={(tree?.key_results ?? []).flatMap((k) => k.sub_key_results.map((s) => ({ id: s.id, label: `${s.code} · ${s.title}`, kr: `${k.code} · ${k.title}` })))}
      caps={{
        edit: ownBu && can(actor, "weekly_report.edit"),
        submit: ownBu && can(actor, "weekly_report.submit"),
        execute: ownBu && can(actor, "task.execute"),
        review: can(actor, "weekly_report.review"),
        integrity: can(actor, "integrity_correction.create"),
      }}
    />
  );
}
