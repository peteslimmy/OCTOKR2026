import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { JourneyTimeline } from "@/components/lifecycle/journey";
import { can, requireActor } from "@/lib/auth/actor";
import { getJourney } from "@/lib/data/lifecycle";

export const metadata: Metadata = { title: "Journey" };

export default async function PersonJourneyPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) notFound();
  const actor = await requireActor();
  if (!can(actor, "users.manage")) return <Card><div className="p-6 text-sm">People management is not available for your role.</div></Card>;
  const j = await getJourney(employeeId);
  if (!j.events.length) notFound();
  return (
    <>
      <PageHeader title={j.name ?? "Journey"} description={`${j.email ?? ""} — everything recorded about this person's unit, roles and status, with who changed it and why.`}
        actions={<Link href="/admin/people" className={buttonClass("secondary")}>Back to People</Link>} />
      <Card><CardHeader title="Journey" description="Newest first. History is never edited." /><JourneyTimeline events={j.events} /></Card>
    </>
  );
}
