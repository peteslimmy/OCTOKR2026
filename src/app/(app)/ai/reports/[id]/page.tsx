import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { liveReportData } from "@/lib/ai/live-report-data";
import { reportById } from "@/lib/ai/reports";
import { aiModuleStatus } from "@/lib/ai/status";
import { AiTabs } from "../../ai-tabs";
import { ReportActions } from "./report-actions";
import { Notice } from "../../notice";

export const metadata: Metadata = { title: "Report · 4COREPAL" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ quarter?: string; unit?: string }> }) {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  const { id } = await params, sp = await searchParams;
  const def = reportById(id);
  if (!def) return <Notice><EmptyState title="That report does not exist"><Link href="/ai/reports" className="underline">Back to reports</Link></EmptyState></Notice>;
  if (!can(actor, "ai.insights.org") && !can(actor, "ai.insights.bu")) return <Notice><EmptyState title="Reports are not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const data = liveReportData();
  const asker = { id: actor.id, buId: actor.buId, permissions: actor.permissions };
  const [res, units] = await Promise.all([def.build({ asker, data, now: () => new Date() }, { quarter: sp.quarter, unit: sp.unit }), data.units()]);
  const org = can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view");
  const query = new URLSearchParams({ ...(sp.quarter ? { quarter: sp.quarter } : {}), ...(sp.unit ? { unit: sp.unit } : {}) }).toString();
  const pickUnit = def.scope !== "organisation" && org;
  return (
    <>
      <PageHeader title={def.title} description={"report" in res ? `${res.report.scopeLabel} · ${res.report.period} · ${res.report.subtitle}` : def.description} actions={<Link href="/ai/reports" className="text-sm underline print:hidden">All reports</Link>} />
      <AiTabs current="reports" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 print:hidden" aria-label="Report options">
        <div><label htmlFor="rq" className="block text-xs text-muted">Quarter (for example Q4 2026)</label><input id="rq" name="quarter" defaultValue={sp.quarter ?? ""} placeholder="current" className="w-32 rounded-lg border border-line bg-panel px-3 py-2 text-sm" /></div>
        {pickUnit ? <div><label htmlFor="ru" className="block text-xs text-muted">Unit</label>
          <select id="ru" name="unit" defaultValue={sp.unit ?? ""} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm"><option value="">{def.scope === "unit" ? "Choose a unit" : "Whole organisation"}</option>{units.map((u) => <option key={u.id} value={u.code}>{u.name}</option>)}</select></div> : null}
        <button type="submit" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white">Update</button>
      </form>
      {"error" in res ? <Card><EmptyState title="This report cannot be shown">{res.error}</EmptyState></Card> : (
        <div className="space-y-4">
          <ReportActions id={def.id} query={query} canExport={can(actor, "ai.report.export")} canExplain={can(actor, "ai.assistant.use")} />
          {res.report.sections.map((s) => (
            <Card key={s.heading}>
              <CardHeader title={s.heading} />
              {s.paragraphs.length ? <div className="space-y-2 px-6 py-4 text-sm">{s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div> : null}
              {s.table ? (
                s.table.rows.length === 0 ? <p className="px-6 pb-4 text-sm text-muted">Nothing to list.</p> : (
                  <DataTable caption={s.table.caption} columns={s.table.columns.map((label) => ({ label }))} maxHeight={null}>
                    {s.table.rows.map((row, i) => <tr key={i}>{row.map((c, k) => <td key={k}>{c === null || c === "" ? "—" : String(c)}</td>)}</tr>)}
                  </DataTable>
                )
              ) : null}
            </Card>
          ))}
          {res.report.limitations.length ? <Card><CardHeader title="What this report cannot tell you" /><ul className="list-disc space-y-1 px-10 py-4 text-sm text-muted">{res.report.limitations.map((l) => <li key={l}>{l}</li>)}</ul></Card> : null}
          <p className="text-xs text-muted">Generated {when(res.report.generatedAt)} WAT from recorded data. {res.report.sources.map((s, i) => <span key={s.href}>{i ? " · " : "Source: "}<Link href={s.href} className="underline">{s.label}</Link></span>)}</p>
        </div>
      )}
    </>
  );
}
