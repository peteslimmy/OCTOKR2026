import type { Metadata } from "next";
import { NavSelect } from "@/components/ui/nav-select";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { can, requireActor } from "@/lib/auth/actor";
import { defaultQuarter, listBusinessUnits, listBuGoals, listQuarters } from "@/lib/data";
import { userClient } from "@/lib/supabase/server";
import { BuGoalsManager } from "./bu-goals-manager";

export const metadata: Metadata = { title: "Business Unit goals" };

export default async function BuGoalsPage({ searchParams }: { searchParams: Promise<{ bu?: string; quarter?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  if (!can(actor, "bu_goals.manage")) return <Card><EmptyState title="Business Unit goals are kept by Business Unit Leads">Your role does not keep a unit&apos;s goals. Weekly goals show the unit goal they support.</EmptyState></Card>;

  const filesForAny = can(actor, "weekly_report.file_for_any_bu");
  const units = (await listBusinessUnits()).filter((b) => b.reports_weekly && b.status === "ACTIVE").sort((x, y) => x.name.localeCompare(y.name));
  const unit = filesForAny ? (units.find((b) => b.id === sp.bu) ?? units[0] ?? null) : units.find((b) => b.id === actor.buId) ?? null;
  if (!unit) return <Card><EmptyState title="Your unit does not file weekly reports">Business Unit goals are kept for the units that file weekly reports.</EmptyState></Card>;

  const quarters = await listQuarters();
  const quarter = quarters.find((q) => q.id === sp.quarter) ?? (await defaultQuarter());
  if (!quarter) return <Card><EmptyState title="No quarter configured" /></Card>;

  const goals = await listBuGoals(unit.id, quarter.id);
  // how many weekly goals already point at each unit goal
  const sb = await userClient();
  const { data: aligned } = goals.length ? await sb.from("smart_goals").select("bu_goal_id").in("bu_goal_id", goals.map((g) => g.id)).is("deleted_at", null) : { data: [] as { bu_goal_id: string }[] };
  const counts = new Map<string, number>();
  for (const r of (aligned ?? []) as { bu_goal_id: string }[]) counts.set(r.bu_goal_id, (counts.get(r.bu_goal_id) ?? 0) + 1);
  const hrefQuarter = `/bu-goals?${filesForAny ? `bu=${unit.id}&` : ""}quarter=`;

  return (
    <>
      <PageHeader title="Business Unit goals" description="What your unit commits to this quarter, in your own words. Each weekly goal you write is aligned to one of these as well as to the organisation's Sub-KR."
        actions={actor.buId ? <ExecutiveCommentary module="BU_GOAL" subjectType="BUSINESS_UNIT" subjectId={actor.buId} subjectLabel="Business unit goals" businessUnitId={actor.buId} /> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-4" role="group" aria-label="Filters">
        <NavSelect id="bug-quarter" label="Quarter" value={quarter.id} hrefBase={hrefQuarter}
          options={[...quarters].sort((x, y) => y.year - x.year || y.quarter_number - x.quarter_number).map((q) => ({ value: q.id, group: String(q.year), label: `Q${q.quarter_number} ${q.year} · ${q.status.toLowerCase()}` }))} />
        {filesForAny ? <NavSelect id="bug-unit" label="Unit" value={unit.id} hrefBase={`/bu-goals?quarter=${quarter.id}&bu=`} options={units.map((b) => ({ value: b.id, label: b.name }))} /> : null}
      </div>
      <Card>
        <CardHeader title={`${unit.name} — goals for Q${quarter.quarter_number} ${quarter.year}`} description="Active goals appear in the weekly goal form. A retired goal stays on the weekly goals that already use it." />
        <BuGoalsManager businessUnitId={unit.id} quarterId={quarter.id} locked={quarter.status === "LOCKED"}
          goals={goals.map((g) => ({ id: g.id, title: g.title, status: g.status, weeklyGoals: counts.get(g.id) ?? 0 }))} />
      </Card>
    </>
  );
}
