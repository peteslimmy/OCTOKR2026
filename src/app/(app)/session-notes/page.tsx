import type { Metadata } from "next";
import Link from "next/link";
import { SessionStatusBadge, MinutesStatusBadge } from "@/components/session-notes/common";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MetricCard } from "@/components/ui/metric-card";
import { can, requireActor } from "@/lib/auth/actor";
import { activeWeeks, listBusinessUnits, listQuarters, recentFinalWeeks } from "@/lib/data";
import { getDashboard, getPeople, listSessionTypes, searchSessions } from "@/lib/data/session-notes";
import { NOTE_CATEGORIES, SESSION_STATUSES, sessionStatusLabel, decisionStatusLabel, DECISION_STATUSES, ACTION_STATUSES, actionStatusLabel } from "@/lib/session-notes/constants";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { NewSessionDialog } from "./new-session";

export const metadata: Metadata = { title: "OKR session notes" };
const PAGE = 25;

export default async function SessionNotesPage({ searchParams }: PageProps<"/session-notes">) {
  const actor = await requireActor();
  if (!can(actor, "session_notes.view")) return <Card><EmptyState title="OKR session notes are not available for your role" /></Card>;
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) || undefined; };
  const page = Math.max(1, Number(one("page")) || 1);
  const f = { q: one("q"), bu: one("bu"), quarter: one("quarter"), week: one("week"), from: one("from"), to: one("to"), type: one("type"), facilitator: one("facilitator"), status: one("status"), noteCategory: one("noteCategory"), decisionStatus: one("decisionStatus"), actionStatus: one("actionStatus") };
  const fromPresentation = one("from-page") === "presentation";

  const [types, units, quarters, weeksA, weeksB, dash, result, people] = await Promise.all([
    listSessionTypes(), listBusinessUnits(), listQuarters(), activeWeeks().catch(() => []), recentFinalWeeks(52).catch(() => []),
    getDashboard({ quarter: f.quarter, bu: f.bu, from: f.from, to: f.to }), searchSessions({ ...f, limit: PAGE, offset: (page - 1) * PAGE }), getPeople().catch(() => []),
  ]);
  const weeks = [...weeksA, ...weeksB].filter((w, i, a) => a.findIndex((x) => x.id === w.id) === i).sort((a, b) => b.week_start_at.localeCompare(a.week_start_at));
  const ownUnit = !can(actor, "session_notes.view_all") && actor.buId ? actor.buId : null;
  const query = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...over })) if (v) p.set(k, v);
    return `/session-notes?${p.toString()}`;
  };
  const registers = (tab: string, extra = "") => `/session-notes/registers?tab=${tab}${f.bu ? `&bu=${f.bu}` : ""}${f.quarter ? `&quarter=${f.quarter}` : ""}${extra}`;
  const filtered = Object.values(f).some(Boolean);
  const pages = Math.max(1, Math.ceil(result.total / PAGE));
  const activeUnits = units.filter((u) => u.status === "ACTIVE");
  const defaultBu = one("bu") ?? ownUnit ?? null;

  return (
    <>
      <PageHeader title="OKR session notes" description="What was discussed, decided and committed in OKR review sessions, linked to the objectives and goals they are about, and kept for good."
        actions={<>
          {can(actor, "session_notes.export") ? <Link className={buttonClass("secondary")} href="/session-notes/registers">Registers & exports</Link> : null}
          {can(actor, "session_notes.create") ? <NewSessionDialog types={types.filter((t) => t.active).map((t) => ({ id: t.id, label: t.name }))} units={(ownUnit ? activeUnits.filter((u) => u.id === ownUnit) : activeUnits).map((u) => ({ id: u.id, label: u.name }))}
            weeks={weeks.map((w) => ({ id: w.id, label: formatWeekLabel(w) }))} defaultBu={defaultBu} defaultWeek={one("week") ?? null} lockedUnit={!!ownUnit} me={actor.id} fromPresentation={fromPresentation} /> : null}
        </>} />

      <section aria-labelledby="dash" className="mb-6">
        <h2 id="dash" className="sr-only">Overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Sessions" value={dash.sessions_total} note={`${dash.sessions_by_status.COMPLETED ?? 0} completed · ${dash.sessions_by_status.IN_PROGRESS ?? 0} in progress`} href={query({ page: undefined })} hrefLabel="See the sessions" definition="Sessions that are not archived, for the filters chosen, counted from the records you may read." />
          <MetricCard label="Awaiting finalised minutes" value={dash.awaiting_finalisation} note="Completed sessions whose minutes are not yet final" href={query({ status: "COMPLETED", page: undefined })} hrefLabel="See completed sessions" />
          <MetricCard label="Decisions" value={dash.decisions_total} note={`${dash.decisions_by_status.APPROVED ?? 0} approved · ${dash.decisions_by_status.PROPOSED ?? 0} proposed`} href={registers("decisions")} hrefLabel="Decisions register" />
          <MetricCard label="Action completion rate" value={dash.completion_rate === null ? "No actions yet" : `${dash.completion_rate}%`} note="Completed ÷ all actions not cancelled" definition="Counted from the action items in the sessions above. It says nothing about OKR task completion." href={registers("actions")} hrefLabel="Action register" />
          <MetricCard label="Outstanding actions" value={dash.actions_outstanding} note={`${dash.actions_due_soon} due within 2 days`} href={registers("actions", "&view=outstanding")} hrefLabel="See outstanding" />
          <MetricCard label="Overdue actions" value={dash.actions_overdue} note={dash.actions_overdue ? "Past their due date and not finished" : "None overdue"} href={registers("actions", "&view=overdue")} hrefLabel="See overdue" />
          <MetricCard label="Blocked actions" value={dash.actions_blocked} note={`${dash.actions_awaiting_verification} awaiting verification`} href={registers("actions", "&status=BLOCKED")} hrefLabel="See blocked" />
          <MetricCard label="Open risks & blockers" value={dash.risks_open} note={`${dash.risks_by_severity.CRITICAL ?? 0} critical · ${dash.risks_by_severity.HIGH ?? 0} high · ${dash.risks_overdue} past target`} href={registers("risks", "&view=open")} hrefLabel="Risks register" />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          <Card><CardHeader title="Sessions by unit" /><div className="p-4 text-sm">
            {dash.sessions_by_bu.length === 0 ? <p className="text-muted">No sessions for these filters.</p> : <ul className="space-y-1">{dash.sessions_by_bu.map((b) => <li key={b.business_unit_id ?? "org"} className="flex justify-between gap-2">{b.business_unit_id ? <Link className="underline" href={query({ bu: b.business_unit_id, page: undefined })}>{b.name}</Link> : <span>{b.name}</span>}<span className="tabular-nums">{b.sessions}</span></li>)}</ul>}
          </div></Card>
          <Card><CardHeader title="Sessions by quarter" /><div className="p-4 text-sm">
            {dash.sessions_by_quarter.length === 0 ? <p className="text-muted">No sessions for these filters.</p> : <ul className="space-y-1">{dash.sessions_by_quarter.map((b) => <li key={b.quarter_id} className="flex justify-between gap-2"><Link className="underline" href={query({ quarter: b.quarter_id, page: undefined })}>{b.label}</Link><span className="tabular-nums">{b.sessions}</span></li>)}</ul>}
          </div></Card>
          <Card><CardHeader title="Sessions by week" description={dash.sessions_without_week ? `${dash.sessions_without_week} without a reporting week` : undefined} /><div className="max-h-52 overflow-y-auto p-4 text-sm">
            {dash.sessions_by_week.length === 0 ? <p className="text-muted">No sessions tied to a week.</p> : <ul className="space-y-1">{dash.sessions_by_week.map((w) => <li key={w.week_id} className="flex justify-between gap-2"><Link className="underline" href={query({ week: w.week_id, page: undefined })}>{w.label} · {w.quarter}</Link><span className="tabular-nums">{w.sessions}</span></li>)}</ul>}
          </div></Card>
          <Card><CardHeader title="Repeated issues" description="The same risk raised in more than one session" /><div className="p-4 text-sm">
            {dash.repeated_issues.length === 0 && dash.actions_repeatedly_carried.length === 0 ? <p className="text-muted">None found.</p> : (
              <ul className="space-y-2">
                {dash.repeated_issues.slice(0, 5).map((r, i) => <li key={i}><span className="font-medium text-ink">{r.title}</span> <span className="text-muted">— {r.business_unit_name}, {r.sessions} sessions, {r.unresolved} unresolved</span></li>)}
                {dash.actions_repeatedly_carried.slice(0, 5).map((a) => <li key={a.id}><Badge tone="warn">Carried {a.reviews}×</Badge> <span className="text-ink">{a.reference}</span> <span className="text-muted">{a.description.slice(0, 80)}</span></li>)}
              </ul>
            )}
          </div></Card>
        </div>
      </section>

      <Card>
        <CardHeader title="Session library" description={`${result.total} session${result.total === 1 ? "" : "s"}${filtered ? " match your filters" : ""}. Historical sessions stay here after their week or quarter locks.`} />
        <form method="get" action="/session-notes" className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter sessions">
          <label className="text-sm">Keyword<input name="q" defaultValue={f.q} placeholder="Search notes, decisions, actions…" className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2" /></label>
          <label className="text-sm">Business unit<select name="bu" defaultValue={f.bu ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">All I may see</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="text-sm">Quarter<select name="quarter" defaultValue={f.quarter ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">All</option>{quarters.map((q) => <option key={q.id} value={q.id}>Q{q.quarter_number} {q.year}</option>)}</select></label>
          <label className="text-sm">Reporting week<select name="week" defaultValue={f.week ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">All</option>{weeks.map((w) => <option key={w.id} value={w.id}>{formatWeekLabel(w)}</option>)}</select></label>
          <label className="text-sm">From<input type="date" name="from" defaultValue={f.from} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2" /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={f.to} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2" /></label>
          <label className="text-sm">Session type<select name="type" defaultValue={f.type ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">All</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="text-sm">Status<select name="status" defaultValue={f.status ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">All</option>{SESSION_STATUSES.map((s) => <option key={s} value={s}>{sessionStatusLabel[s]}</option>)}</select></label>
          <label className="text-sm">Facilitator<select name="facilitator" defaultValue={f.facilitator ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="text-sm">Note category<select name="noteCategory" defaultValue={f.noteCategory ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">Any</option>{NOTE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></label>
          <label className="text-sm">Has a decision that is<select name="decisionStatus" defaultValue={f.decisionStatus ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">Any</option>{DECISION_STATUSES.map((s) => <option key={s} value={s}>{decisionStatusLabel[s]}</option>)}</select></label>
          <label className="text-sm">Has an action that is<select name="actionStatus" defaultValue={f.actionStatus ?? ""} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2"><option value="">Any</option>{ACTION_STATUSES.map((s) => <option key={s} value={s}>{actionStatusLabel[s]}</option>)}</select></label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonClass("primary")}>Apply filters</button>
            {filtered ? <Link className={buttonClass("secondary")} href="/session-notes">Clear</Link> : null}
          </div>
        </form>
        {result.rows.length === 0 ? (
          <EmptyState title={filtered ? "No sessions match" : "No sessions yet"}>{filtered ? "Try fewer filters." : can(actor, "session_notes.create") ? "Start a session to record an OKR review." : "Sessions you can see will appear here."}</EmptyState>
        ) : (
          <DataTable caption="OKR sessions" maxHeight={null} columns={[{ label: "Session" }, { label: "Date" }, { label: "Unit" }, { label: "Week" }, { label: "Status" }, { label: "Records" }, { label: "Minutes" }]}>
            {result.rows.map((s) => (
              <tr key={s.id} className="border-b border-line align-top last:border-0">
                <td><Link className="font-medium text-brand-700 underline" href={`/session-notes/${s.id}`}>{s.title}</Link><p className="font-mono text-xs text-muted">{s.reference} · {s.type_name}</p>
                  {s.snippets.length ? <ul className="mt-1 space-y-0.5 text-xs text-muted">{s.snippets.map((x, i) => <li key={i}>…{x.replace(/\[\[/g, "«").replace(/\]\]/g, "»")}…</li>)}</ul> : null}</td>
                <td className="whitespace-nowrap">{s.session_date}</td>
                <td>{s.business_unit_name ?? "Organisation"}</td>
                <td className="whitespace-nowrap">{s.week_number ? `Week ${s.week_number}` : "—"}<p className="text-xs text-muted">{s.quarter_label ?? ""}</p></td>
                <td><SessionStatusBadge status={s.status} /></td>
                <td className="text-xs text-muted">{s.notes} notes · {s.decisions} decisions · {s.open_actions} open actions · {s.risks} risks</td>
                <td>{s.minutes_status ? <MinutesStatusBadge status={s.minutes_status} /> : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </DataTable>
        )}
        {pages > 1 ? (
          <nav className="flex items-center justify-between gap-2 border-t border-line px-6 py-3 text-sm" aria-label="Pages">
            <span className="text-muted">Page {page} of {pages}</span>
            <span className="flex gap-2">
              {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={query({ page: String(page - 1) })}>Previous</Link> : null}
              {page < pages ? <Link className={buttonClass("secondary", "sm")} href={query({ page: String(page + 1) })}>Next</Link> : null}
            </span>
          </nav>
        ) : null}
      </Card>
    </>
  );
}
