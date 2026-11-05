import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { serverNow } from "@/lib/data";
import { liveReportData } from "@/lib/ai/live-report-data";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../ai-tabs";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Communications · 4COREPAL" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));
const KIND: Record<string, string> = { ALERT: "Alert", WEEKLY_SUMMARY: "Weekly summary", REMINDER: "Reminder", CLOSURE_REQUEST: "Monthly review", REMARK_REQUEST: "Remarks request", CORRECTIVE_ACTION: "Corrective action", ESCALATION: "Escalation", REPORT: "Report", APPROVAL_REQUEST: "Approval request", FOLLOW_UP: "Follow-up" };
const EMAIL: Record<string, { label: string; tone: "done" | "warn" | "critical" | "undefined" | "info" }> = {
  SENT: { label: "Email sent", tone: "done" }, PENDING: { label: "Email queued", tone: "info" }, SENDING: { label: "Email sending", tone: "info" }, FAILED: { label: "Email failed", tone: "critical" }, SKIPPED: { label: "Email skipped", tone: "undefined" }, NOT_EMAILED: { label: "In-app only", tone: "undefined" },
};
interface Row { id: string; kind: string; subject: string; createdAt: string; recipient: string; unit: string | null; caseId: string | null; inApp: string; email: string; emailAttempts: number; acknowledgedAt: string | null; respondedAt: string | null; followUp: string }

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.communication.view")) return <Notice><EmptyState title="The communication history is not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const sp = await searchParams;
  const sb = await userClient();
  const { data } = await sb.rpc("read_ai_communications", { p_limit: 200 });
  const all = (Array.isArray(data) ? data : []) as Row[];
  const nowMs = new Date(await serverNow()).getTime();      // the application clock, so the page agrees with the rest of the application
  const problems = all.filter((r) => r.email === "FAILED" || (r.followUp === "PENDING" && nowMs - new Date(r.createdAt).getTime() > 3 * 864e5));
  const rows = sp.show === "problems" ? problems : sp.show === "waiting" ? all.filter((r) => r.followUp === "PENDING") : all;
  const counts = (await liveReportData().counts().catch(() => null))?.communications;
  return (
    <>
      <PageHeader title="Communications" description="Everything 4COREPAL has sent: who was told, in the application and by email, whether the email went, and whether they have answered." />
      <AiTabs current="communications" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">Sent in the last 7 days</p><p className="mt-1 text-2xl font-semibold tabular-nums">{counts?.sentLast7 ?? all.length}</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">Waiting for a response</p><p className="mt-1 text-2xl font-semibold tabular-nums">{counts?.awaitingResponse ?? all.filter((r) => r.followUp === "PENDING").length}</p></div>
        <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">Failed or unanswered for 3+ days</p><p className="mt-1 text-2xl font-semibold tabular-nums">{problems.length}</p></div>
      </div>
      <div className="mb-3 flex gap-3 text-sm"><Link href="/ai/communications" className={!sp.show ? "font-semibold underline" : "underline"}>Everything</Link><Link href="/ai/communications?show=waiting" className={sp.show === "waiting" ? "font-semibold underline" : "underline"}>Waiting for a response</Link><Link href="/ai/communications?show=problems" className={sp.show === "problems" ? "font-semibold underline" : "underline"}>Failed or unanswered</Link></div>
      <Card>
        {rows.length === 0 ? <EmptyState title="Nothing to show">Messages appear here as the daily review asks units for remarks, answers or responses.</EmptyState> : (
          <DataTable caption="Communications" columns={[{ label: "Sent" }, { label: "Kind" }, { label: "To" }, { label: "Unit" }, { label: "Message" }, { label: "Delivery" }, { label: "Response" }]} maxHeight="40rem">
            {rows.map((r) => {
              const em = EMAIL[r.email] ?? EMAIL.NOT_EMAILED;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-muted">{when(r.createdAt)}</td><td>{KIND[r.kind] ?? r.kind}</td><td className="whitespace-nowrap font-medium">{r.recipient}</td><td>{r.unit ?? "—"}</td>
                  <td className="max-w-xs">{r.caseId ? <Link href={`/ai/cases/${r.caseId}`} className="text-brand-700 underline">{r.subject}</Link> : r.subject}</td>
                  <td><div className="flex flex-col gap-1"><Badge tone="done">In-app</Badge><Badge tone={em.tone}>{em.label}{r.email === "FAILED" ? ` (${r.emailAttempts} tries)` : ""}</Badge></div></td>
                  <td className="text-xs">{r.respondedAt ? <Badge tone="done">Responded {when(r.respondedAt)}</Badge> : r.acknowledgedAt ? <Badge tone="info">Seen {when(r.acknowledgedAt)}</Badge> : r.followUp === "PENDING" ? <Badge tone="warn">Waiting</Badge> : <span className="text-muted">None needed</span>}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </>
  );
}
