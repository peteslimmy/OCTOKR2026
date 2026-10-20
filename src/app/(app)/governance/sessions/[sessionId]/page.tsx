import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requireActor } from "@/lib/auth/actor";
import { getRoster } from "@/lib/data/governance";
import { RosterWorkspace } from "./roster-workspace";

export const metadata: Metadata = { title: "OKR session" };

export default async function SessionPage({ params }: PageProps<"/governance/sessions/[sessionId]">) {
  const { sessionId } = await params;
  const actor = await requireActor();
  const roster = await getRoster(sessionId); // RLS: roles without attendance access get nothing back
  if (!roster) notFound();
  return (
    <RosterWorkspace
      roster={roster}
      caps={{ manage: can(actor, "attendance.session.manage"), request: can(actor, "attendance.amendment.request"), correct: can(actor, "attendance.session.outcome.request"), emergency: can(actor, "attendance.session.outcome.emergency") }}
    />
  );
}
