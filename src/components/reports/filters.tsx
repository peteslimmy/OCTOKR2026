import Link from "next/link";
import { Button, Input, Label, Select, Field } from "@/components/ui/primitives";
import type { Quarter } from "@/lib/data";
import type { ReportDefinition, ReportParams } from "@/lib/reports/types";

/** Plain GET form: filters live in the URL, so every view is shareable, bookmarkable and identical for charts, tables and exports. */
export function ReportFilters({ action, def, params, quarters, bus }: {
  action: string; def?: ReportDefinition; params: ReportParams; quarters: Quarter[]; bus?: { id: string; name: string }[];
}) {
  const showQuarter = !def || def.params.includes("quarter");
  const showBu = !!bus && bus.length > 1 && (!def || def.params.includes("bu"));
  const showPeriod = !!def && def.params.includes("period");
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3" aria-label="Report filters">
      {showQuarter ? (
        <div className="min-w-44">
          <Label htmlFor="f-quarter">Quarter</Label>
          <Select id="f-quarter" name="quarterId" defaultValue={params.quarterId ?? ""}>
            <option value="">Current quarter</option>
            {quarters.map((q) => <option key={q.id} value={q.id}>Q{q.quarter_number} {q.year} ({q.status.toLowerCase()})</option>)}
          </Select>
        </div>
      ) : null}
      {showBu ? (
        <div className="min-w-44">
          <Label htmlFor="f-bu">Business Unit</Label>
          <Select id="f-bu" name="buId" defaultValue={params.buId ?? ""}>
            <option value="">All Business Units</option>
            {bus!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
      ) : null}
      {showPeriod ? (
        <>
          <Field id="f-from" label="From"><Input type="date" name="from" defaultValue={params.from ?? ""} /></Field>
          <Field id="f-to" label="To"><Input type="date" name="to" defaultValue={params.to ?? ""} /></Field>
        </>
      ) : null}
      <Button type="submit" size="sm">Apply</Button>
      <Link href={action} className="inline-flex min-h-8 items-center px-2 text-sm text-brand-700 underline">Reset filters</Link>
    </form>
  );
}

export const paramString = (p: ReportParams, extra: Record<string, string> = {}) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...extra })) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
};
