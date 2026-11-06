import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { JourneyTimeline } from "@/components/lifecycle/journey";
import { requireActor } from "@/lib/auth/actor";
import { getJourney } from "@/lib/data/lifecycle";
import { userClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My journey" };

export default async function MyJourneyPage() {
  const actor = await requireActor();
  const sb = await userClient();
  const { data: u } = await sb.from("users").select("employee_id").eq("id", actor.id).maybeSingle();
  const j = u?.employee_id ? await getJourney(u.employee_id as string) : null;
  return (
    <>
      <PageHeader title="My journey" description="Your units, roles and status over time: when you joined, moves, promotions and who recorded them." />
      <Card><CardHeader title="Journey" description="Newest first." />{j ? <JourneyTimeline events={j.events} /> : <p className="p-6 text-sm text-muted">Nothing is recorded yet.</p>}</Card>
    </>
  );
}
