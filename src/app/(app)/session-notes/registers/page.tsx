import type { Metadata } from "next";
import Link from "next/link";
import { ActionCard } from "@/components/session-notes/action-card";
import { DecisionStatusBadge, SeverityBadge } from "@/components/session-notes/common";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { can, requireActor } from "@/lib/auth/actor";
import { listBusinessUnits, listQuarters } from "@/lib/data";
import { getPeople, listActions, listDecisions, listRisks } from "@/lib/data/session-notes";
import { ACTION_STATUSES, DECISION_STATUSES, RISK_STATUSES, actionStatusLabel, decisionStatusLabel } from "@/lib/session-notes/constants";

export const metadata: Metadata = { title: "Commitments & registers" };

const TABS = [["actions", "Action items"], ["decisions", "Decisions"], ["risks", "Risks & blockers"]] as const;
const sel = "mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2";

export default async function RegistersPage({ searchParams }: PageProps<"/session-notes/registers">) {
  const actor = await requireActor();
  // a person who was only ever given an action can still see their commitments
  if (!can(actor, "session_notes.view") && !can(actor, "session_actions.update")) return <Card><EmptyState title="The registers are not available for your role" /></Card>;
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) || undefined; };
  const tab = (TABS.find(([t]) => t === one("tab"))?.[0] ?? "actions") as (typeof TABS)[number][0];
  const f = { bu: one("bu"), quarter: one("quarter"), status: one("status"), view: one("view"), mine: one("mine"), severity: one("severity") };
  const [units, quarters, people] = await Promise.all([listBusinessUnits(), listQuarters(), getPeople().catch(() => [])]);
  const caps = { assign: can(actor, "session_actions.assign"), update: can(actor, "session_actions.update"), verify: can(actor, "session_actions.verify"), viewerId: actor.id, viewerBuId: actor.buId };

  const [actions, decisions, risks] = await Promise.all([
    tab === "actions" ? listActions({ bu: f.bu, quarter: f.quarter, status: f.view === "outstanding" ? undefined : f.status, assignee: f.mine ? actor.id : undefined, overdue: f.view === "overdue" }) : Promise.resolve([]),
    tab === "decisions" ? listDecisions({ bu: f.bu, quarter: f.quarter, status: f.status }) : Promise.resolve([]),
    tab === "risks" ? listRisks({ bu: f.bu, quarter: f.quarter, status: f.status, severity: f.severity, openOnly: f.view === "open" }) : Promise.resolve([]),
  ]);
  const shownActions = f.view === "outstanding" ? actions.filter((a) => ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(a.status)) : actions;
  const q = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ tab, ...f, ...over })) if (v) p.set(k, v); return `/session-notes/registers?${p.toString()}`; };
  const exp = (kind: string, format: string) => `/api/v1/okr-exports?kind=${kind}&format=${format}${f.bu ? `&bu=${f.bu}` : ""}${f.quarter ? `&quarter=${f.quarter}` : ""}`;
  const exportKinds = tab === "actions" ? [["outstanding-actions", "Outstanding actions"], ["overdue-actions", "Overdue commitments"], ["action-completion", "Action completion"]] : tab === "decisions" ? [["decisions", "Decisions register"]] : [["risks", "Risks & blockers register"]];

  return (
    <>
      <PageHeader title="Commitments & registers" description="Every action item, decision and risk from OKR sessions, in one place. Each one belongs to the session it came from." actions={<><ExecutiveCommentary module="RISK" label="Executive Commentary" /><Link className={buttonClass("secondary")} href="/session-notes">Session library</Link></>} />
      <nav aria-label="Registers" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([t, label]) => <Link key={t} href={q({ tab: t, status: undefined, view: undefined })} aria-current={tab === t ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>)}
      </nav>
      <Card className="mb-4">
        <form method="get" action="/session-notes/registers" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filter the register">
          <input type="hidden" name="tab" value={tab} />
          <label className="text-sm">Business unit<select name="bu" defaultValue={f.bu ?? ""} className={sel}><option value="">All I may see</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="text-sm">Quarter<select name="quarter" defaultValue={f.quarter ?? ""} className={sel}><option value="">All</option>{quarters.map((x) => <option key={x.id} value={x.id}>Q{x.quarter_number} {x.year}</option>)}</select></label>
          <label className="text-sm">Status<select name="status" defaultValue={f.status ?? ""} className={sel}><option value="">Any</option>
            {(tab === "actions" ? ACTION_STATUSES.map((s) => [s, actionStatusLabel[s]]) : tab === "decisions" ? DECISION_STATUSES.map((s) => [s, decisionStatusLabel[s]]) : RISK_STATUSES.map((s) => [s, s.charAt(0) + s.slice(1).toLowerCase()])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {tab === "actions" ? <label className="text-sm">Show<select name="view" defaultValue={f.view ?? ""} className={sel}><option value="">Everything</option><option value="outstanding">Outstanding only</option><option value="overdue">Overdue only</option></select></label> : null}
          {tab === "risks" ? <label className="text-sm">Show<select name="view" defaultValue={f.view ?? ""} className={sel}><option value="">Everything</option><option value="open">Open and mitigating only</option></select></label> : null}
          {tab === "actions" ? <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={!!f.mine} /> Only mine</label> : null}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5"><button type="submit" className={buttonClass("primary")}>Apply</button><Link className={buttonClass("secondary")} href={`/session-notes/registers?tab=${tab}`}>Clear</Link></div>
        </form>
      </Card>
      {can(actor, "session_notes.export") ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label="Exports">
          <span className="text-muted">Export (what you may read, with the filters above):</span>
          {exportKinds.map(([k, label]) => <span key={k} className="inline-flex items-center gap-2"><span>{label}</span>{(["pdf", "xlsx", "csv"] as const).map((fmt) => <a key={fmt} className="text-brand-700 underline" href={exp(k, fmt)}>{fmt.toUpperCase()}</a>)}</span>)}
        </div>
      ) : null}

      {tab === "actions" ? (shownActions.length === 0 ? <Card><EmptyState title="No action items match" /></Card> : (
        <div className="space-y-3" data-testid="action-register">
          <p className="text-sm text-muted">{shownActions.length} action item{shownActions.length === 1 ? "" : "s"}</p>
          {shownActions.map((a) => <ActionCard key={a.id} a={a} caps={caps} people={people} />)}
        </div>
      )) : null}

      {tab === "decisions" ? (
        <Card>
          <CardHeader title={`${decisions.length} decision${decisions.length === 1 ? "" : "s"}`} description="Only an approved decision is formal. Superseded decisions are kept and point to what replaced them." />
          {decisions.length === 0 ? <EmptyState title="No decisions match" /> : (
            <DataTable caption="Decisions register" maxHeight={null} columns={[{ label: "Decision" }, { label: "Status" }, { label: "Date" }, { label: "Unit" }, { label: "Session" }]}>
              {decisions.map((d) => (
                <tr key={d.id} className="border-b border-line align-top last:border-0">
                  <td><p className="font-medium text-ink">{d.title}</p><p className="font-mono text-xs text-muted">{d.reference}</p><p className="mt-1 max-w-xl text-sm text-muted">{d.description.slice(0, 220)}{d.description.length > 220 ? "…" : ""}</p>
                    {d.superseded_by_reference ? <p className="text-xs text-muted">Replaced by {d.superseded_by_reference}</p> : null}</td>
                  <td><DecisionStatusBadge status={d.status} />{d.decided_by_name ? <p className="mt-1 text-xs text-muted">by {d.decided_by_name}</p> : null}</td>
                  <td className="whitespace-nowrap">{d.decision_date}</td><td>{d.affected_bu_name ?? "—"}</td>
                  <td><Link className="text-brand-700 underline" href={`/session-notes/${d.session_id}?tab=decisions`}>{d.session_reference}</Link></td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      ) : null}

      {tab === "risks" ? (
        <Card>
          <CardHeader title={`${risks.length} risk${risks.length === 1 ? "" : "s"} and blocker${risks.length === 1 ? "" : "s"}`} />
          {risks.length === 0 ? <EmptyState title="No risks or blockers match" /> : (
            <DataTable caption="Risks and blockers register" maxHeight={null} columns={[{ label: "Risk" }, { label: "Severity" }, { label: "Status" }, { label: "Owner" }, { label: "Target" }, { label: "Session" }]}>
              {risks.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td><p className="font-medium text-ink">{r.title}</p><p className="font-mono text-xs text-muted">{r.reference} · {r.business_unit_name} · {r.kind.toLowerCase()}</p>
                    {r.raised_in_sessions > 1 ? <Badge tone="warn">Raised in {r.raised_in_sessions} sessions</Badge> : null}</td>
                  <td><SeverityBadge severity={r.severity} /></td><td>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}{r.overdue ? <p className="text-xs text-[var(--critical-fg)]">Past target</p> : null}</td>
                  <td>{r.owner_name ?? "—"}</td><td className="whitespace-nowrap">{r.target_date ?? "—"}</td>
                  <td><Link className="text-brand-700 underline" href={`/session-notes/${r.session_id}?tab=risks`}>{r.session_reference}</Link></td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      ) : null}
    </>
  );
}
