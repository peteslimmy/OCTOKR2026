import type { Metadata } from "next";
import Link from "next/link";
import { Banner, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { listBusinessUnits, listQuarters } from "@/lib/data";
import { availableReports } from "@/lib/reports/access";
import { REPORTS } from "@/lib/reports/catalogue";
import { Builder } from "./builder";

export const metadata: Metadata = { title: "Report builder" };

export default async function BuilderPage() {
  const actor = await requireActor();
  if (!actor.permissions.has("reports.view") || !actor.permissions.has("reports.build")) return <Card><EmptyState title="The report builder is not available for your role" /></Card>;
  const [quarters, bus] = await Promise.all([listQuarters(), listBusinessUnits()]);
  const reports = availableReports(actor, REPORTS).map((r) => ({ id: r.id, title: r.title, category: r.category, params: r.params, description: r.description }));
  return (
    <>
      <PageHeader title="Report builder" description="Start from an approved report, choose the period, unit and columns you need, preview it and save the view. Every figure keeps its official definition."
        actions={<Link href="/reports" className={buttonClass("secondary", "sm")}>All reports</Link>} />
      <Banner tone="info" title="What the builder can and cannot do">It selects and arranges data the approved reports already produce, within your own access. It cannot query the database directly, define new scores, or reach data outside your permissions.</Banner>
      <div className="mt-6">
        <Builder reports={reports} quarters={quarters.map((q) => ({ id: q.id, label: `Q${q.quarter_number} ${q.year} (${q.status.toLowerCase()})` }))}
          bus={actor.permissions.has("weekly_report.view_all") ? bus.filter((b) => b.status === "ACTIVE" && b.reports_weekly).map((b) => ({ id: b.id, name: b.name })) : []} canExport={actor.permissions.has("reports.export")} />
      </div>
    </>
  );
}
