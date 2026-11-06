import type { Metadata } from "next";
import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, Field, Input, PageHeader, Select, type Tone } from "@/components/ui/primitives";
import { MetricCard } from "@/components/ui/metric-card";
import { can, requireActor } from "@/lib/auth/actor";
import {
  AUDIT_CATEGORIES, AUDIT_CHANNELS, AUDIT_OUTCOMES, AUDIT_PAGE_SIZE, AUDIT_SEVERITIES, auditKpis, auditTrace, filterFrom, filterParams, listAlerts, listRules, pageAudit, recordAuditAccess,
  type AuditFilter, type AuditRow, type TraceEvent,
} from "@/lib/data/audit";
import { AlertActions, RuleEditor, VerifyChain } from "./audit-client";

export const metadata: Metadata = { title: "Audit & Security Centre" };

const FULL = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" } as const;
const SEV_TONE: Record<string, Tone> = { CRITICAL: "critical", HIGH: "critical", MEDIUM: "warn", LOW: "info", INFO: "undefined" };
const OUTCOME_TONE: Record<string, Tone> = { SUCCESS: "done", FAILURE: "critical", DENIED: "critical", REJECTED: "warn", PARTIAL: "warn" };
const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const TABS = [["events", "Events"], ["alerts", "Security indicators"], ["rules", "Detection rules"], ["integrity", "Integrity"]] as const;

type Params = Record<string, string | string[] | undefined>;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const actor = await requireActor();
  if (!can(actor, "audit.read")) return <Card><EmptyState title="You do not have access to the audit log" /></Card>;
  const sp: Params = await searchParams;
  const filter = filterFrom(sp);
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0]) ?? "events";
  const cursor = typeof sp.cursor === "string" ? sp.cursor : null;
  const traceId = typeof sp.trace === "string" && /^[0-9a-f-]{36}$/i.test(sp.trace) ? sp.trace : null;
  const base = filterParams(filter);
  const href = (extra: Record<string, string | null>, keepFilter = true) => {
    const p = new URLSearchParams(keepFilter ? base : undefined);
    for (const [k, v] of Object.entries(extra)) { if (v === null) p.delete(k); else p.set(k, v); }
    const s = p.toString();
    return `/audit${s ? `?${s}` : ""}`;
  };

  const [kpis, page, alerts, rules, trace] = await Promise.all([
    auditKpis(actor.id, filter),
    tab === "events" ? pageAudit(filter, cursor, AUDIT_PAGE_SIZE) : Promise.resolve(null),
    tab === "alerts" || tab === "events" ? listAlerts(tab === "events" ? "open" : undefined) : Promise.resolve([]),
    tab === "rules" ? listRules() : Promise.resolve([]),
    traceId ? auditTrace(actor.id, traceId).catch(() => null) : Promise.resolve(null),
  ]);
  // looking at the log is itself recorded (one entry per person per minute); a failure to record never blocks the page
  await recordAuditAccess(actor.id, "VIEWED", filter, page?.rows.length ?? null).catch(() => undefined);

  const filtered = base.size > 0;
  const canManage = can(actor, "audit.alerts.manage");
  const canConfigure = can(actor, "audit.rules.configure");
  const exportQuery = base.toString();

  return (
    <>
      <PageHeader title="Audit & Security Centre"
        description="Append-only, tamper-evident record of who did what, when, from where and with what result. Times are West Africa Time. Entries cannot be edited or deleted by anyone."
        actions={<>
          <a href={`/api/v1/audit/export?format=csv${exportQuery ? `&${exportQuery}` : ""}`} className={buttonClass("secondary", "sm")} download>Export CSV{filtered ? " (filtered)" : ""}</a>
          <a href={`/api/v1/audit/export?format=pdf${exportQuery ? `&${exportQuery}` : ""}`} className={buttonClass("secondary", "sm")} download>Export PDF{filtered ? " (filtered)" : ""}</a>
        </>} />

      <section aria-label="Summary for the period" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <MetricCard label="Events" value={kpis.total} note={filter.from || filter.to ? "In the chosen dates" : "Last 7 days"} />
        <MetricCard label="Refused or failed" value={kpis.failed_or_denied} note={`${kpis.denied} denied · ${kpis.failures} failed`} />
        <MetricCard label="High or critical" value={kpis.high_or_critical} note="By event severity" />
        <MetricCard label="Failed sign-ins" value={kpis.logins_failed} />
        <MetricCard label="Exports" value={kpis.exports} note="Files and registers taken out" />
        <MetricCard label="Open indicators" value={kpis.open_alerts} href={href({ tab: "alerts" }, false)} hrefLabel="Review indicators"
          definition="An indicator is a pattern in the log that deserves a second look, such as many refused requests in a short time. It is not a finding about anyone." />
      </section>

      <nav aria-label="Audit sections" className="mb-4 flex flex-wrap gap-2 border-b border-line">
        {TABS.map(([k, name]) => (
          <Link key={k} href={href({ tab: k === "events" ? null : k, cursor: null, trace: null })} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>
            {name}{k === "alerts" && kpis.open_alerts > 0 ? <> <Badge tone="critical">{kpis.open_alerts}</Badge></> : null}
          </Link>
        ))}
      </nav>

      {tab === "events" && page ? <>
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <Link href={href({ category: null, cursor: null })} className={chip(!filter.category)}>All <span className="text-muted">{kpis.total}</span></Link>
          {AUDIT_CATEGORIES.filter((c) => kpis.by_category[c] || filter.category === c).map((c) => (
            <Link key={c} href={href({ category: c, cursor: null })} aria-current={filter.category === c ? "true" : undefined} className={chip(filter.category === c)}>{label(c)} <span className="text-muted">{kpis.by_category[c] ?? 0}</span></Link>
          ))}
        </div>
        <Filters filter={filter} />
        {trace ? <TracePanel trace={trace} closeHref={href({ trace: null })} href={href} /> : null}
        <Card>
          <CardHeader title={`${page.rows.length}${page.nextCursor ? "+" : ""} event${page.rows.length === 1 ? "" : "s"}${cursor ? " on this page" : filtered ? " match" : " most recent"}`}
            description="Open an event for the people, place, before and after, and the events that belong with it." />
          {page.rows.length === 0 ? <EmptyState title="No audit events match" /> : (
            <ul className="divide-y divide-line">
              {page.rows.map((r) => <EventRow key={r.id} r={r} traceHref={href({ trace: r.id })} />)}
            </ul>
          )}
          {page.nextCursor ? <p className="border-t border-line px-6 py-3"><Link href={href({ cursor: page.nextCursor })} className={buttonClass("secondary", "sm")}>Older events</Link></p> : null}
        </Card>
      </> : null}

      {tab === "alerts" ? (
        <Card>
          <CardHeader title="Security indicators" description="Each one is a pattern the detection rules noticed. Review it, record what you found, and close it with a note. None of them is a conclusion about a person." />
          {alerts.length === 0 ? <EmptyState title="No indicators" /> : (
            <ul className="divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEV_TONE[a.severity] ?? "info"}>{a.severity}</Badge>
                    <span className="font-medium">{label(a.rule_code)}</span>
                    <Badge tone={a.status === "NEW" ? "warn" : a.status === "ESCALATED" ? "critical" : "undefined"}>{label(a.status)}</Badge>
                    <span className="text-xs text-muted">{wat(a.created_at, FULL)}</span>
                  </div>
                  <p className="mt-1 text-sm">{a.summary}</p>
                  <p className="text-xs text-muted">{a.event_count} event{a.event_count === 1 ? "" : "s"} between {wat(a.first_event_at, FULL)} and {wat(a.last_event_at, FULL)}{a.subject_label ? ` · ${a.subject_label}` : ""}</p>
                  {a.status_note ? <p className="mt-1 text-sm text-muted">Note: {a.status_note}</p> : null}
                  <p className="mt-1 text-sm">{a.evidence_event_ids.slice(0, 5).map((id, i) => <Link key={id} className="mr-3 text-brand-700 underline" href={`/audit?trace=${id}`}>Event {i + 1}</Link>)}</p>
                  {canManage ? <AlertActions id={a.id} status={a.status} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "rules" ? (
        <Card>
          <CardHeader title="Detection rules" description="Thresholds, windows and severity are data. Changing one needs the Super Admin, a recent second factor and a reason, and is recorded with the before and after." />
          <DataTable caption="Detection rules" columns={[{ label: "Rule" }, { label: "Threshold" }, { label: "Window" }, { label: "Severity" }, { label: "On" }, { label: "", srOnly: true }]}>
            {rules.map((r) => (
              <tr key={r.code}>
                <td><span className="font-medium">{r.name}</span><br /><span className="text-xs text-muted">{r.description}</span></td>
                <td className="tabular-nums">{r.threshold}</td><td className="tabular-nums">{r.window_minutes} min</td>
                <td><Badge tone={SEV_TONE[r.severity] ?? "info"}>{r.severity}</Badge></td>
                <td>{r.enabled ? "Yes" : "No"}</td>
                <td>{canConfigure ? <RuleEditor rule={r} /> : null}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === "integrity" ? (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Integrity of the record</h2>
          <p className="mt-1 text-sm text-muted">Every new event is linked to the one before it with a SHA-256 hash. If any event is changed or removed, the chain no longer matches and the first broken event is reported.
            Events written before the chain began ({kpis.chain.unchained_history.toLocaleString("en-GB")}) are kept exactly as they were and are protected by the database rules only.</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted">Chained events</dt><dd className="text-xl font-semibold tabular-nums">{(kpis.chain.chained ?? 0).toLocaleString("en-GB")}</dd></div>
            <div><dt className="text-sm text-muted">Who may change or delete an event</dt><dd className="text-xl font-semibold">No one</dd></div>
          </dl>
          <VerifyChain />
        </Card>
      ) : null}
    </>
  );
}

const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel text-ink hover:bg-surface"}`;

function Filters({ filter }: { filter: AuditFilter }) {
  const filtered = Object.keys(filter).length > 0;
  return (
    <form method="get" className="mb-4 grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter the audit log">
      {filter.category ? <input type="hidden" name="category" value={filter.category} /> : null}
      <Field id="au-from" label="From"><Input type="date" name="from" defaultValue={filter.from ?? ""} /></Field>
      <Field id="au-to" label="To"><Input type="date" name="to" defaultValue={filter.to ?? ""} /></Field>
      <Field id="au-actor" label="Person (name, e-mail or id)"><Input name="actor" defaultValue={filter.actor ?? ""} maxLength={100} /></Field>
      <Field id="au-role" label="Role at the time"><Input name="role" defaultValue={filter.role ?? ""} placeholder="SUPER_ADMIN" maxLength={40} /></Field>
      <Field id="au-bu" label="Business unit"><Input name="bu" defaultValue={filter.bu ?? ""} maxLength={80} /></Field>
      <Field id="au-action" label="Action starts with"><Input name="action" defaultValue={filter.action ?? ""} placeholder="ROLE_" maxLength={60} /></Field>
      <Field id="au-type" label="Entity type"><Input name="type" defaultValue={filter.entityType ?? ""} placeholder="role" maxLength={60} /></Field>
      <Field id="au-entity" label="Entity id"><Input name="entity" defaultValue={filter.entityId ?? ""} maxLength={100} /></Field>
      <Field id="au-outcome" label="Outcome"><Select name="outcome" defaultValue={filter.outcome ?? ""}><option value="">Any</option>{AUDIT_OUTCOMES.map((o) => <option key={o} value={o}>{label(o)}</option>)}</Select></Field>
      <Field id="au-severity" label="Severity"><Select name="severity" defaultValue={filter.severity ?? ""}><option value="">Any</option>{AUDIT_SEVERITIES.map((o) => <option key={o} value={o}>{label(o)}</option>)}</Select></Field>
      <Field id="au-channel" label="Channel"><Select name="channel" defaultValue={filter.channel ?? ""}><option value="">Any</option>{AUDIT_CHANNELS.map((o) => <option key={o} value={o}>{label(o)}</option>)}</Select></Field>
      <Field id="au-ip" label="Source address"><Input name="ip" defaultValue={filter.ip ?? ""} maxLength={64} /></Field>
      <Field id="au-session" label="Session reference"><Input name="session" defaultValue={filter.session ?? ""} maxLength={64} /></Field>
      <Field id="au-request" label="Request id"><Input name="request" defaultValue={filter.request ?? ""} maxLength={80} /></Field>
      <Field id="au-q" label="Record id or words in the reason" className="sm:col-span-2"><Input name="q" defaultValue={filter.q ?? ""} maxLength={100} /></Field>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={buttonClass("primary", "sm")}>Apply filters</button>
        {filtered ? <Link href="/audit" className={buttonClass("secondary", "sm")}>Clear</Link> : null}
      </div>
    </form>
  );
}

function EventRow({ r, traceHref }: { r: AuditRow; traceHref: string }) {
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 hover:bg-surface">
          <span className="w-44 shrink-0 text-sm tabular-nums">{wat(r.occurred_at, FULL)}</span>
          <span className="font-medium">{r.action}</span>
          <Badge tone={OUTCOME_TONE[r.outcome] ?? "undefined"}>{label(r.outcome)}</Badge>
          {r.severity && r.severity !== "INFO" ? <Badge tone={SEV_TONE[r.severity] ?? "info"}>{r.severity}</Badge> : null}
          <span className="text-sm text-muted">{r.actor_name ?? "System"}{r.actor_role ? ` · ${r.actor_role}` : ""}</span>
          <span className="text-sm text-muted">{r.entity_type}{r.entity_id ? ` ${r.entity_id.length > 12 ? r.entity_id.slice(0, 8) + "…" : r.entity_id}` : ""}</span>
        </summary>
        <div className="grid gap-4 bg-surface px-6 py-4 lg:grid-cols-3">
          <Facts title="Who" rows={[["Name", r.actor_name], ["E-mail", r.actor_email], ["Role at the time", r.actor_role], ["Business unit", r.actor_bu_name], ["Scope", r.actor_scope && label(r.actor_scope)]]} />
          <Facts title="Where from" rows={[["Address", r.ip_address && `${r.ip_address}${r.ip_trusted ? "" : " (server-side, not the person's)"}`], ["Browser", r.browser], ["System", r.os], ["Device", r.device], ["Channel", r.channel && label(r.channel)], ["Session", r.session_ref]]} />
          <Facts title="Identifiers" rows={[["Event", r.id], ["Record", r.entity_id], ["Request", r.request_id], ["Correlation", r.correlation_id], ["Workflow", r.workflow_id], ["Approval", r.related_approval_id], ["Category", r.event_category && label(r.event_category)]]} />
          {r.reason ? <p className="lg:col-span-3"><span className="text-sm font-medium">Reason: </span>{r.reason}</p> : null}
          <div className="lg:col-span-3"><Changes before={r.old_values} after={r.new_values} /></div>
          {r.metadata ? <pre className="overflow-x-auto rounded border border-line bg-panel p-2 text-xs lg:col-span-3">{JSON.stringify(r.metadata, null, 2)}</pre> : null}
          <p className="lg:col-span-3 text-sm"><Link href={traceHref} className="text-brand-700 underline">Trace related events (request, workflow, session, person)</Link>
            {r.chain_seq ? <span className="ml-3 font-mono text-xs text-muted">chain #{r.chain_seq} · {r.row_hash?.slice(0, 12)}</span> : null}</p>
        </div>
      </details>
    </li>
  );
}

function Facts({ title, rows }: { title: string; rows: [string, string | null | undefined | false][] }) {
  const shown = rows.filter(([, v]) => v);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {shown.length === 0 ? <p className="text-sm text-muted">Not recorded</p> : (
        <dl className="space-y-0.5 text-sm">{shown.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-muted">{k}</dt><dd className="min-w-0 break-all">{v}</dd></div>)}</dl>
      )}
    </div>
  );
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));
/** Field-level before and after: only the fields that differ when both sides are records; the raw values otherwise. Redacted secrets show as such. */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  if (before == null && after == null) return null;
  if (isObj(before) || isObj(after)) {
    const b = isObj(before) ? before : {}, a = isObj(after) ? after : {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    if (keys.length === 0 && before != null && after != null) return <p className="text-sm text-muted">No field changed.</p>;
    if (keys.length > 0 && keys.length <= 40) {
      return (
        <table className="w-full text-sm"><caption className="sr-only">Fields changed</caption>
          <thead><tr className="text-left text-muted"><th className="pr-3 font-medium">Field</th><th className="pr-3 font-medium">Before</th><th className="font-medium">After</th></tr></thead>
          <tbody>{keys.map((k) => <tr key={k} className="align-top"><td className="pr-3 font-mono text-xs">{k}</td><td className="break-all pr-3">{show(b[k])}</td><td className="break-all">{show(a[k])}</td></tr>)}</tbody>
        </table>
      );
    }
  }
  return <div className="grid gap-2 sm:grid-cols-2"><pre className="overflow-x-auto rounded border border-line bg-panel p-2 text-xs">Before: {show(before)}</pre><pre className="overflow-x-auto rounded border border-line bg-panel p-2 text-xs">After: {show(after)}</pre></div>;
}

function TracePanel({ trace, closeHref, href }: { trace: Awaited<ReturnType<typeof auditTrace>>; closeHref: string; href: (e: Record<string, string | null>) => string }) {
  const e = trace.event;
  const Line = ({ t }: { t: TraceEvent }) => (
    <li className={`flex flex-wrap gap-x-3 text-sm ${t.id === e.id ? "font-semibold" : ""}`}>
      <span className="w-40 shrink-0 tabular-nums text-muted">{wat(t.occurred_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <Link href={href({ trace: t.id })} className="text-brand-700 underline">{t.action}</Link>
      <span className="text-muted">{t.outcome.toLowerCase()}{t.actor_name ? ` · ${t.actor_name}` : ""}</span>
    </li>
  );
  const groups: [string, TraceEvent[]][] = [["Same record or workflow", trace.same_workflow], ["Same request", trace.same_request], ["Same sign-in session", trace.same_session], ["Same person, one day either side", trace.same_actor]];
  return (
    <Card className="mb-4">
      <CardHeader title={`Trace: ${e.action}`} description={`${wat(e.occurred_at, FULL)} · ${e.actor_name ?? "System"} · event ${e.id}`} action={<Link href={closeHref} className={buttonClass("secondary", "sm")}>Close trace</Link>} />
      <div className="grid gap-4 px-6 pb-4 lg:grid-cols-2">
        {groups.map(([title, list]) => (
          <section key={title} aria-label={title}>
            <h3 className="mb-1 text-sm font-semibold">{title} <span className="font-normal text-muted">({list.length})</span></h3>
            {list.length === 0 ? <p className="text-sm text-muted">Nothing else recorded.</p> : <ul className="space-y-1">{list.map((t) => <Line key={t.id} t={t} />)}</ul>}
          </section>
        ))}
      </div>
      <p className="border-t border-line px-6 py-3 text-xs text-muted">{trace.chain.valid === null ? "This event was written before the hash chain began." : trace.chain.valid ? `Hash chain: this event is intact (#${trace.chain.chain_seq}).` : "Hash chain: this event does NOT match its stored hash."}</p>
    </Card>
  );
}
