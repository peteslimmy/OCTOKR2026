import type { Metadata } from "next";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { AiAdminTabs } from "../admin-tabs";
import { AiTabs } from "../../ai-tabs";
import { Notice } from "../../notice";

export const metadata: Metadata = { title: "Usage and activity · 4COREPAL" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));
const usd = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`;
type Usage = { today: { calls: number; costUsd: number; inputTokens: number; outputTokens: number }; last7: { calls: number; costUsd: number; errors: number; blocked: number }; last30: { calls: number; costUsd: number }; byPurpose: { purpose: string; calls: number; costUsd: number; avgMs: number | null }[]; models: string[] };
type Job = { id: string; kind: string; status: string; attempts: number; started_at: string | null; error: string | null; result: unknown };
type Act = { seq: number; at: string; action: string; actor: string; role: string | null; unit: string | null; entity: string; detail: { from: Record<string, unknown> | null; to: Record<string, unknown> | null } | null };
const PURPOSE: Record<string, string> = { assistant: "Assistant answers", report_commentary: "Written report explanations" };
const label = (a: string) => a.replace(/^AI_/, "").toLowerCase().replace(/_/g, " ");

export default async function UsagePage() {
  const actor = await requireActor();
  if (!can(actor, "ai.audit.view") && !can(actor, "ai.config.manage")) return <Notice><EmptyState title="Usage and activity are for the people who audit 4COREPAL" /></Notice>;
  const sb = await userClient();
  const [u, j, a, c] = await Promise.all([
    sb.rpc("read_ai_usage_summary"), sb.from("ai_jobs").select("id, kind, status, attempts, started_at, error, result").order("started_at", { ascending: false, nullsFirst: false }).limit(15),
    sb.rpc("read_ai_activity", { p_limit: 60 }), sb.from("ai_settings").select("key, value").in("key", ["daily_cost_ceiling_usd", "price_input_per_mtok_usd"]),
  ]);
  const usage = u.data as Usage | null, jobs = (j.data ?? []) as Job[], activity = (Array.isArray(a.data) ? a.data : []) as Act[];
  const set = new Map(((c.data ?? []) as { key: string; value: number }[]).map((s) => [s.key, Number(s.value)]));
  const ceiling = set.get("daily_cost_ceiling_usd") ?? 0, priced = (set.get("price_input_per_mtok_usd") ?? 0) > 0;
  const failed = jobs.filter((x) => x.status === "FAILED" || x.status === "DEAD");
  return (
    <>
      <PageHeader title="Usage and activity" description="What the AI provider has cost, how the daily review has run, and what 4COREPAL and the people who run it have done. The record holds what was done, never the text of a question, answer or remark." />
      <AiTabs current="admin" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin />
      <AiAdminTabs current="usage" />
      <div className="space-y-6">
        <section aria-labelledby="h-use"><h2 id="h-use" className="mb-2 text-lg font-semibold">AI provider usage</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">Today</p><p className="mt-1 text-2xl font-semibold tabular-nums">{usage ? usd(Number(usage.today.costUsd)) : "—"}</p><p className="mt-1 text-xs text-muted">{usage?.today.calls ?? 0} calls{ceiling > 0 ? `, ceiling ${usd(ceiling)}` : ", no ceiling set"}</p></div>
            <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">Last 7 days</p><p className="mt-1 text-2xl font-semibold tabular-nums">{usage ? usd(Number(usage.last7.costUsd)) : "—"}</p><p className="mt-1 text-xs text-muted">{usage?.last7.calls ?? 0} calls</p></div>
            <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">Last 30 days</p><p className="mt-1 text-2xl font-semibold tabular-nums">{usage ? usd(Number(usage.last30.costUsd)) : "—"}</p><p className="mt-1 text-xs text-muted">{usage?.last30.calls ?? 0} calls</p></div>
            <div className="rounded-xl border border-line bg-panel p-4"><p className="text-xs text-muted">Problems, last 7 days</p><p className="mt-1 text-2xl font-semibold tabular-nums">{usage ? usage.last7.errors + usage.last7.blocked : "—"}</p><p className="mt-1 text-xs text-muted">{usage?.last7.errors ?? 0} failed or timed out, {usage?.last7.blocked ?? 0} stopped by a limit</p></div>
          </div>
          {!priced ? <p className="mt-2 text-xs text-muted">No provider price has been entered, so cost shows as zero and the daily ceiling cannot act. Enter the prices under Switch and settings.</p> : null}
        </section>
        <Card>
          <CardHeader title="By purpose, last 30 days" description={usage?.models.length ? `Models used: ${usage.models.join(", ")}.` : undefined} />
          {!usage || usage.byPurpose.length === 0 ? <EmptyState title="The AI provider has not been used yet" /> : (
            <DataTable caption="Usage by purpose" columns={[{ label: "Purpose" }, { label: "Calls", align: "right" }, { label: "Cost", align: "right" }, { label: "Average time (ms)", align: "right" }]} maxHeight={null}>
              {usage.byPurpose.map((p) => <tr key={p.purpose}><td className="font-medium">{PURPOSE[p.purpose] ?? p.purpose}</td><td className="text-right tabular-nums">{p.calls}</td><td className="text-right tabular-nums">{usd(Number(p.costUsd))}</td><td className="text-right tabular-nums">{p.avgMs ?? "—"}</td></tr>)}
            </DataTable>
          )}
        </Card>
        <Card>
          <CardHeader title="Daily and monthly runs" description={failed.length ? `${failed.length} recent run${failed.length === 1 ? "" : "s"} failed. A failed run is tried again; after the retry limit it is marked dead and needs a look.` : "Each run, with how it ended."} />
          {jobs.length === 0 ? <EmptyState title="Nothing has run yet" /> : (
            <DataTable caption="Runs" columns={[{ label: "Run" }, { label: "Status" }, { label: "Tries", align: "right" }, { label: "Started" }, { label: "Result or error" }]} maxHeight="22rem">
              {jobs.map((r) => <tr key={r.id}><td className="font-medium">{r.kind}</td><td><Badge tone={r.status === "SUCCEEDED" ? "done" : r.status === "DEAD" ? "critical" : r.status === "FAILED" ? "warn" : "info"}>{r.status.toLowerCase()}</Badge></td><td className="text-right tabular-nums">{r.attempts}</td><td className="text-muted">{r.started_at ? when(r.started_at) : "—"}</td><td className="max-w-md text-xs text-muted">{r.error ?? JSON.stringify(r.result ?? {})}</td></tr>)}
            </DataTable>
          )}
        </Card>
        <Card>
          <CardHeader title="Activity" description="What the agent and the people who run it have done, newest first. Configuration changes show what they were changed from and to." />
          {activity.length === 0 ? <EmptyState title="No activity recorded yet" /> : (
            <DataTable caption="Activity" columns={[{ label: "When" }, { label: "What" }, { label: "By" }, { label: "Unit" }, { label: "Change" }]} maxHeight="34rem">
              {activity.map((x) => <tr key={x.seq}><td className="whitespace-nowrap text-muted">{when(x.at)}</td><td className="font-medium">{label(x.action)}</td><td>{x.actor}{x.role ? <span className="text-xs text-muted"> ({x.role.toLowerCase().replace(/_/g, " ")})</span> : null}</td><td>{x.unit ?? "—"}</td>
                <td className="max-w-xs text-xs text-muted">{x.detail ? `${JSON.stringify(x.detail.from ?? {})} → ${JSON.stringify(x.detail.to ?? {})}` : ""}</td></tr>)}
            </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}
