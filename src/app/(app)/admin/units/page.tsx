import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listBusinessUnits } from "@/lib/data";
import { BuReportingToggle, CreateBu, DeleteBu, BulkDeleteBu } from "../admin-actions";

export const metadata: Metadata = { title: "Business Units & Departments" };

export default async function UnitsPage() {
  const actor = await requireActor();
  if (!can(actor, "business_units.manage")) return <Card><EmptyState title="Units are not available for your role" /></Card>;

  // Fetch BUs with dependent counts
  const sb = await (await import("@/lib/supabase/server")).userClient();
  const bus = await (await import("@/lib/data")).listBusinessUnits();

  // Get employee counts per BU
  const { data: empCounts } = await sb
    .from("employees")
    .select("business_unit_id")
    .in("business_unit_id", bus.map(b => b.id));

  const empCountMap = new Map<string, number>();
  empCounts?.forEach(e => {
    empCountMap.set(e.business_unit_id, (empCountMap.get(e.business_unit_id) || 0) + 1);
  });

  // Get report counts per BU
  const { data: reportCounts } = await sb
    .from("weekly_reports")
    .select("business_unit_id")
    .in("business_unit_id", bus.map(b => b.id));

  const reportCountMap = new Map<string, number>();
  reportCounts?.forEach(r => {
    reportCountMap.set(r.business_unit_id, (reportCountMap.get(r.business_unit_id) || 0) + 1);
  });

  const busWithDeps = bus.map(b => ({
    ...b,
    hasEmployees: (empCountMap.get(b.id) || 0) > 0,
    hasReports: (reportCountMap.get(b.id) || 0) > 0,
  }));

  const reporting = busWithDeps.filter((b) => b.unit_type === "BUSINESS_UNIT");
  const departments = busWithDeps.filter((b) => b.unit_type === "DEPARTMENT");

  const Row = ({ b }: { b: (typeof busWithDeps)[number] }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
      <span><span className="font-mono text-xs text-muted">{b.code}</span> <span className="font-medium">{b.name}</span></span>
      <span className="flex items-center gap-2">
        <Badge tone={b.reports_weekly ? "info" : "undefined"}>{b.reports_weekly ? "reports weekly" : "no weekly report"}</Badge>
        <Badge tone={b.status === "ACTIVE" ? "done" : "undefined"}>{b.status.toLowerCase()}</Badge>
        <BuReportingToggle id={b.id} name={b.name} status={b.status} reportsWeekly={b.reports_weekly} />
        <DeleteBu id={b.id} name={b.name} code={b.code} hasEmployees={b.hasEmployees} hasReports={b.hasReports} />
      </span>
    </li>
  );

  return (
    <>
      <PageHeader title="Business Units & Departments" description="Every staff member belongs to one unit. Every unit is a Business Unit or a Department; each is marked as reporting weekly or not. Units that report are scored and ranked."
        actions={<><BulkDeleteBu bus={busWithDeps} /><Link href="/admin/import/business-units" className={buttonClass("secondary", "sm")}>Import from a file</Link><CreateBu /></>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Business Units (${reporting.length})`} description="Business Units, whether or not they currently report weekly." />
          {reporting.length === 0 ? <EmptyState title="No Business Units yet">Use “Add unit” to create the first one.</EmptyState> : <ul className="divide-y divide-line">{reporting.map((b) => <Row key={b.id} b={b} />)}</ul>}
        </Card>
        <Card>
          <CardHeader title={`Departments (${departments.length})`} description="Departments. Some report weekly, some do not." />
          {departments.length === 0 ? <EmptyState title="No Departments yet">A Department is a unit that does not file weekly reports. Add one with type “Department”.</EmptyState> : <ul className="divide-y divide-line">{departments.map((b) => <Row key={b.id} b={b} />)}</ul>}
        </Card>
      </div>
    </>
  );
}