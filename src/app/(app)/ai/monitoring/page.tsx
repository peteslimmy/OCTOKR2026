import type { Metadata } from "next";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../ai-tabs";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Monitoring · 4COREPAL" };
const SEV: Record<string, "critical" | "warn" | "info" | "done"> = { CRITICAL: "critical", HIGH: "critical", MEDIUM: "warn", LOW: "info" };
const KIND: Record<string, string> = { MISSED_REPORT: "Report not filed", CONSECUTIVE_MISSED_REPORTS: "Reports missed in a row", SCORE_DROP: "Score fell sharply" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));
type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
type F = { id: string; kind: string; severity: string; summary: string; detected_at: string; business_units: Rel<{ name: string }>; reporting_weeks: Rel<{ week_number: number }> };
type Q = { id: string; status: string; task_count: number; requested_at: string; business_units: Rel<{ name: string }>; reporting_weeks: Rel<{ week_number: number }> };
type J = { id: string; kind: string; status: string; attempts: number; started_at: string | null; error: string | null; result: unknown };

export default async function MonitoringPage() {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.insights.org")) return <Notice><EmptyState title="Monitoring is for executives and administrators" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const sb = await userClient();
  const [f, q, j] = await Promise.all([
    sb.from("ai_findings").select("id, kind, severity, summary, detected_at, business_units(name), reporting_weeks(week_number)").order("detected_at", { ascending: false }).limit(50),
    sb.from("ai_remark_requests").select("id, status, task_count, requested_at, business_units(name), reporting_weeks(week_number)").in("status", ["PENDING", "PARTIAL", "ESCALATED"]).order("requested_at"),
    can(actor, "ai.audit.view") ? sb.from("ai_jobs").select("id, kind, status, attempts, started_at, finished_at, error, result").order("started_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
  ]);
  const findings = (f.data ?? []) as unknown as F[], open = (q.data ?? []) as unknown as Q[], jobs = (j.data ?? []) as unknown as J[];
  return (
    <>
      <PageHeader title="Monitoring" description="What the daily review noticed and which unit leads still owe remarks. These are fixed rules over recorded data. A finding is a reason to look, not a verdict." />
      <AiTabs current="monitoring" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Waiting for remarks" description="Requests the unit lead has not fully answered." />
          {open.length === 0 ? <EmptyState title="No request is waiting" /> : (
            <DataTable caption="Open remark requests" columns={[{ label: "Unit" }, { label: "Week" }, { label: "Tasks", align: "right" }, { label: "Status" }, { label: "Asked" }]} maxHeight="22rem">
              {open.map((r) => <tr key={r.id}><td className="font-medium">{one(r.business_units)?.name}</td><td>Week {one(r.reporting_weeks)?.week_number}</td><td className="text-right tabular-nums">{r.task_count}</td><td><Badge tone={r.status === "ESCALATED" ? "critical" : "warn"}>{r.status === "ESCALATED" ? "Escalated" : r.status === "PARTIAL" ? "Partly answered" : "Waiting"}</Badge></td><td className="text-muted">{when(r.requested_at)}</td></tr>)}
            </DataTable>
          )}
        </Card>
        <Card>
          <CardHeader title="Findings" description="Newest first." />
          {findings.length === 0 ? <EmptyState title="Nothing has been flagged yet" /> : (
            <DataTable caption="Findings" columns={[{ label: "Severity" }, { label: "What" }, { label: "Unit" }, { label: "Week" }, { label: "Found" }]} maxHeight="30rem">
              {findings.map((x) => <tr key={x.id}><td><Badge tone={SEV[x.severity] ?? "info"}>{x.severity.toLowerCase()}</Badge></td><td><p className="font-medium">{KIND[x.kind] ?? x.kind}</p><p className="text-xs text-muted">{x.summary}</p></td><td>{one(x.business_units)?.name ?? "—"}</td><td>{one(x.reporting_weeks) ? `Week ${one(x.reporting_weeks)!.week_number}` : "—"}</td><td className="text-muted">{when(x.detected_at)}</td></tr>)}
            </DataTable>
          )}
        </Card>
        {can(actor, "ai.audit.view") ? (
          <Card>
            <CardHeader title="Recent runs" description="Each day's review, with how it ended." />
            {jobs.length === 0 ? <EmptyState title="The daily review has not run yet" /> : (
              <DataTable caption="Monitoring runs" columns={[{ label: "Run" }, { label: "Status" }, { label: "Attempts", align: "right" }, { label: "Started" }, { label: "Result" }]} maxHeight="18rem">
                {jobs.map((r) => <tr key={r.id}><td className="font-medium">{r.kind}</td><td><Badge tone={r.status === "SUCCEEDED" ? "done" : r.status === "DEAD" ? "critical" : "warn"}>{r.status.toLowerCase()}</Badge></td><td className="text-right tabular-nums">{r.attempts}</td><td className="text-muted">{r.started_at ? when(r.started_at) : "—"}</td><td className="text-xs text-muted">{r.error ?? JSON.stringify(r.result ?? {})}</td></tr>)}
              </DataTable>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
