import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listConfigChanges } from "@/lib/data/config";
import { ChangeQueue } from "./change-queue";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireActor();
  const involved = ["config.approve", "config.protected.approve", "config.emergency", "violation.edit", "integrity_penalty.configure", "reminders.configure", "business_units.manage"].some((p) => can(actor, p));
  if (!involved) return <Card><EmptyState title="Approvals are not available for your role" /></Card>;
  const rows = await listConfigChanges();
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));
  const waiting = rows.filter((r) => r.status === "PENDING").length;
  return (
    <>
      <PageHeader title="Approvals" description="Changes to governance settings are asked for by one person and approved by a different one. Nothing changes until it is approved." />
      <Card>
        <CardHeader title={`Configuration changes${waiting ? ` (${waiting} waiting)` : ""}`} description="Violation types and fines, the integrity penalty rate, reminder and email settings, and Business Unit reporting." />
        <ChangeQueue me={actor.id} canApprove={can(actor, "config.approve")} canProtected={can(actor, "config.protected.approve")} canEmergency={can(actor, "config.emergency")}
          items={rows.map((r) => ({ id: r.id, topic: r.topic, description: r.topic_description, target: r.target, proposed: r.proposed, current: r.current_value, reason: r.reason, status: r.status, emergency: r.emergency,
            requestedBy: r.requested_by_name, requestedById: r.requested_by, decidedBy: r.decided_by_name, comment: r.decision_comment, when: when(r.created_at), protectedTopic: r.topic_protected }))} />
      </Card>
    </>
  );
}
