import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
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

  // Build hierarchy map
  const buById = new Map(bus.map(b => [b.id, b]));
  const childrenMap = new Map<string, string[]>();
  bus.forEach(b => {
    if (b.parent_unit_id) {
      const children = childrenMap.get(b.parent_unit_id) || [];
      children.push(b.id);
      childrenMap.set(b.parent_unit_id, children);
    }
  });

  const busWithDeps = bus.map(b => ({
    ...b,
    hasEmployees: (empCountMap.get(b.id) || 0) > 0,
    hasReports: (reportCountMap.get(b.id) || 0) > 0,
  }));

  const reporting = busWithDeps.filter((b) => b.unit_type === "BUSINESS_UNIT");
  const departments = busWithDeps.filter((b) => b.unit_type === "DEPARTMENT");

  type BusWithDeps = (typeof busWithDeps)[number];

  // Helper to render a unit row with hierarchy
  const renderUnitRow = ({ b, depth = 0 }: { b: BusWithDeps; depth?: number }): React.ReactNode => {
    const children = childrenMap.get(b.id) || [];
    const hasChildren = children.length > 0;
    const indent = depth * 24;

    return (
      <>
        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm" style={{ paddingLeft: indent + 24 }}>
          <span className="flex items-center gap-2">
            {hasChildren && <span className="text-muted" title="Has child units, listed below">▼</span>}
            <span className="font-mono text-xs text-muted">{b.code}</span>
            <span className="font-medium">{b.name}</span>
            {b.parent_unit_id && (
              <span className="text-xs text-muted px-2 py-0.5 bg-panel rounded">
                Child of {buById.get(b.parent_unit_id)?.name ?? "Unknown"}
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            <Badge tone={b.reports_weekly ? "info" : "undefined"}>{b.reports_weekly ? "reports weekly" : "no weekly report"}</Badge>
            <Badge tone={b.status === "ACTIVE" ? "done" : "undefined"}>{b.status.toLowerCase()}</Badge>
            {b.description && <span className="text-xs text-muted truncate max-w-xs" title={b.description}>{b.description}</span>}
            {b.location && <span className="text-xs text-muted">📍 {b.location}</span>}
            <BuReportingToggle id={b.id} name={b.name} status={b.status} reportsWeekly={b.reports_weekly} />
            <DeleteBu id={b.id} name={b.name} code={b.code} hasEmployees={b.hasEmployees} hasReports={b.hasReports} />
          </span>
        </li>
        {children.map(childId => {
          const child = busWithDeps.find(b => b.id === childId);
          return child ? <Fragment key={child.id}>{renderUnitRow({ b: child, depth: depth + 1 })}</Fragment> : null;
        })}
      </>
    );
  };

  const Row = ({ b }: { b: BusWithDeps }): React.ReactNode => {
    // Only render root units at top level
    if (b.parent_unit_id) return null;
    return renderUnitRow({ b, depth: 0 });
  };

  return (
    <>
      <PageHeader title="Business Units & Departments" description="Every staff member belongs to one unit. Every unit is a Business Unit or a Department; each is marked as reporting weekly or not. Units that report are scored and ranked. Units can have a parent unit for hierarchy."
        actions={<><BulkDeleteBu bus={busWithDeps} /><Link href="/admin/import/business-units" className={buttonClass("secondary", "sm")}>Import from a file</Link><CreateBu units={bus.map((b) => ({ id: b.id, code: b.code, name: b.name }))} /></>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Business Units (${reporting.length})`} description="Business Units, whether or not they currently report weekly." />
          {reporting.length === 0 ? <EmptyState title="No Business Units yet">Use &ldquo;Add unit&rdquo; to create the first one.</EmptyState> : <ul className="divide-y divide-line">{reporting.map((b) => <Row key={b.id} b={b} />)}</ul>}
        </Card>
        <Card>
          <CardHeader title={`Departments (${departments.length})`} description="Departments. Some report weekly, some do not." />
          {departments.length === 0 ? <EmptyState title="No Departments yet">A Department is a unit that does not file weekly reports. Add one with type &ldquo;Department&rdquo;.</EmptyState> : <ul className="divide-y divide-line">{departments.map((b) => <Row key={b.id} b={b} />)}</ul>}
        </Card>
      </div>
    </>
  );
}