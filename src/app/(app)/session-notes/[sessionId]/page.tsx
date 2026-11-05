import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { SessionWorkspace, type Caps, type Performance } from "@/components/session-notes/workspace";
import { Card, EmptyState } from "@/components/ui/primitives";
import { aiModuleStatus } from "@/lib/ai/status";
import { can, requireActor } from "@/lib/auth/actor";
import { getWeekOverview } from "@/lib/data";
import { getOutstanding, getWorkspace } from "@/lib/data/session-notes";

export const metadata: Metadata = { title: "OKR session" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SessionPage({ params, searchParams }: PageProps<"/session-notes/[sessionId]">) {
  const actor = await requireActor();
  const { sessionId } = await params;
  const sp = await searchParams;
  if (!UUID.test(sessionId)) notFound();
  if (!can(actor, "session_notes.view")) return <Card><EmptyState title="OKR session notes are not available for your role" /></Card>;
  const ws = await getWorkspace(sessionId);
  if (!ws) notFound();   // not found and not permitted look the same (row-level security returned nothing)
  const s = ws.session;
  const outstanding = s.status === "ARCHIVED" ? null : await getOutstanding(sessionId);

  let performance: Performance | null = null;
  if (s.reporting_week_id && s.business_unit_id) {
    try {
      const row = (await getWeekOverview(s.reporting_week_id)).find((r) => r.business_unit.id === s.business_unit_id);
      if (row) performance = { submission_status: row.submission_status, final_score: row.final_score, compliance: row.compliance ?? null, report_status: null };
    } catch { /* the context panel simply omits what the person cannot read */ }
  }
  const caps: Caps = {
    create: can(actor, "session_notes.create"), update: can(actor, "session_notes.update"), finalise: can(actor, "session_notes.finalise"), archive: can(actor, "session_notes.archive"),
    export: can(actor, "session_notes.export"), viewAll: can(actor, "session_notes.view_all"), decisionsCreate: can(actor, "session_decisions.create"), decisionsApprove: can(actor, "session_decisions.approve"),
    actionsCreate: can(actor, "session_actions.create"), actionsAssign: can(actor, "session_actions.assign"), actionsUpdate: can(actor, "session_actions.update"), actionsVerify: can(actor, "session_actions.verify"),
    risksManage: can(actor, "session_risks.manage"), ai: can(actor, "ai.assistant.use") && (await aiModuleStatus()).canUse, buId: actor.buId, viewerId: actor.id,
  };
  // the way back to Presentation mode keeps the unit and the week
  const presentationHref = can(actor, "presentation.view") && s.reporting_week_id ? `/presentation?week=${s.reporting_week_id}${s.business_unit_id ? `&bu=${s.business_unit_id}` : ""}` : null;
  const tab = typeof sp.tab === "string" ? sp.tab : null;
  return (
    <>
      <div className="mb-3 flex justify-end"><ExecutiveCommentary module="SESSION_NOTES" subjectType="SESSION" subjectId={s.id} subjectLabel={`Session ${s.reference}: ${s.title}`} businessUnitId={s.business_unit_id} quarterId={s.quarter_id} reportingWeekId={s.reporting_week_id} /></div>
      <SessionWorkspace ws={ws} outstanding={outstanding} caps={caps} performance={performance} presentationHref={presentationHref} initialTab={tab} />
    </>
  );
}
