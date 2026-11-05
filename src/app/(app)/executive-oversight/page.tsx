import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MetricCard } from "@/components/ui/metric-card";
import { AwaitingBadge, CommentLink, KindBadge, OverdueBadge, PriorityBadge, RecLink, StatusBadge } from "@/components/executive-oversight/common";
import { NewButtons } from "@/components/executive-oversight/new-buttons";
import { requireActor } from "@/lib/auth/actor";
import { activeWeeks, listBusinessUnits, listQuarters, recentFinalWeeks } from "@/lib/data";
import { getDashboard, listCategories, searchComments, searchRecommendations } from "@/lib/data/executive-oversight";
import { eoCaps } from "@/lib/executive-oversight/caps";
import { MODULES, PRIORITIES, TARGET_STATUSES, moduleLabel, priorityLabel, statusLabel } from "@/lib/executive-oversight/constants";
import { formatWeekLabel } from "@/lib/domain/week-label";
import type { EoRecLine } from "@/lib/executive-oversight/types";

export const metadata: Metadata = { title: "Executive oversight" };
const PAGE = 25;
const sel = "mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2";
const date = (d: string | null) => (d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(d.length === 10 ? `${d}T12:00:00+01:00` : d)) : "—");

export default async function ExecutiveOversightPage({ searchParams }: PageProps<"/executive-oversight">) {
  const actor = await requireActor();
  const caps = eoCaps(actor);
  if (!caps.dashboard && !caps.viewComments && !caps.viewRecs) return <Card><EmptyState title="Executive oversight is not available for your role" /></Card>;
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) || undefined; };
  const tab = one("tab") === "recommendations" ? "recommendations" : one("tab") === "comments" ? "comments" : "overview";
  const page = Math.max(1, Number(one("page")) || 1);
  const f = { q: one("q"), bu: one("bu"), quarter: one("quarter"), week: one("week"), from: one("from"), to: one("to"), priority: one("priority"), status: one("status"), category: one("category"), module: one("module"), overdue: one("overdue") === "true",
    awaiting: one("awaiting"), dueFrom: one("dueFrom"), dueTo: one("dueTo"), mine: one("mine") === "true" };
  const author = f.mine ? actor.id : undefined;

  const [units, quarters, weeksA, weeksB, categories] = await Promise.all([listBusinessUnits(), listQuarters(), activeWeeks().catch(() => []), recentFinalWeeks(52).catch(() => []), listCategories().catch(() => [])]);
  const weeks = [...weeksA, ...weeksB].filter((w, i, a) => a.findIndex((x) => x.id === w.id) === i).sort((a, b) => b.week_start_at.localeCompare(a.week_start_at));
  const activeUnits = units.filter((u) => u.status === "ACTIVE");
  const dash = caps.dashboard ? await getDashboard({ bu: f.bu, quarter: f.quarter, from: f.from, to: f.to }) : null;
  const recs = tab === "recommendations" ? await searchRecommendations({ ...f, author, limit: PAGE, offset: (page - 1) * PAGE }) : null;
  const comments = tab === "comments" ? await searchComments({ q: f.q, bu: f.bu, quarter: f.quarter, week: f.week, from: f.from, to: f.to, category: f.category, module: f.module, author, limit: PAGE, offset: (page - 1) * PAGE }) : null;

  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === true ? "true" : v === false ? undefined : v])), ...over })) if (v) p.set(k, String(v));
    return `/executive-oversight?${p.toString()}`;
  };
  const total = recs?.total ?? comments?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtered = Object.values(f).some(Boolean);
  const unitsLite = activeUnits.map((u) => ({ id: u.id, name: u.name }));
  const exportHref = (kind: string, fmt: string) => `/api/v1/executive-oversight/export?kind=${kind}&format=${fmt}${f.bu ? `&bu=${f.bu}` : ""}${f.quarter ? `&quarter=${f.quarter}` : ""}${f.from ? `&from=${f.from}` : ""}${f.to ? `&to=${f.to}` : ""}${f.status ? `&status=${f.status}` : ""}`;

  return (
    <>
      <PageHeader title="Executive oversight" description="Executive and Director observations and formal recommendations, the business units' responses, and what followed. Advice and conversation only: nothing here changes an OKR record."
        actions={<NewButtons caps={caps} units={unitsLite} categories={categories} />} />

      <nav aria-label="Sections" className="mb-4 flex flex-wrap gap-2">
        {[["overview", "Overview"], ["recommendations", "Recommendations"], ["comments", "Comments"]].map(([k, l]) => (
          <Link key={k} href={href({ tab: k, page: undefined })} aria-current={tab === k ? "page" : undefined} className={buttonClass(tab === k ? "primary" : "secondary", "sm")}>{l}</Link>
        ))}
        {caps.exportOk && tab !== "overview" ? (
          <span className="ml-auto flex gap-2 text-sm">
            <span className="self-center text-muted">Export</span>
            {["csv", "xlsx", "pdf"].map((fmt) => <a key={fmt} className={buttonClass("secondary", "sm")} href={exportHref(tab, fmt)}>{fmt.toUpperCase()}</a>)}
          </span>
        ) : null}
      </nav>

      <Card className="mb-4">
        <form method="get" action="/executive-oversight" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter">
          <input type="hidden" name="tab" value={tab} />
          <label className="text-sm">Search<input name="q" defaultValue={f.q} placeholder="Words, reference…" className={sel} /></label>
          <label className="text-sm">Business unit<select name="bu" defaultValue={f.bu ?? ""} className={sel}><option value="">All I may see</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="text-sm">Quarter<select name="quarter" defaultValue={f.quarter ?? ""} className={sel}><option value="">All</option>{quarters.map((q) => <option key={q.id} value={q.id}>Q{q.quarter_number} {q.year}</option>)}</select></label>
          {tab !== "overview" ? <label className="text-sm">Reporting week<select name="week" defaultValue={f.week ?? ""} className={sel}><option value="">All</option>{weeks.map((w) => <option key={w.id} value={w.id}>{formatWeekLabel(w)}</option>)}</select></label> : null}
          <label className="text-sm">From<input type="date" name="from" defaultValue={f.from} className={sel} /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={f.to} className={sel} /></label>
          {tab !== "overview" ? <label className="text-sm">Category<select name="category" defaultValue={f.category ?? ""} className={sel}><option value="">Any</option>{categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label> : null}
          {tab !== "overview" ? <label className="text-sm">Related module<select name="module" defaultValue={f.module ?? ""} className={sel}><option value="">Any</option>{MODULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label> : null}
          {tab === "recommendations" ? (
            <>
              <label className="text-sm">Priority<select name="priority" defaultValue={f.priority ?? ""} className={sel}><option value="">Any</option>{PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel[p]}</option>)}</select></label>
              <label className="text-sm">Status<select name="status" defaultValue={f.status ?? ""} className={sel}><option value="">Any</option>{TARGET_STATUSES.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}</select></label>
              <label className="text-sm">Waiting for<select name="awaiting" defaultValue={f.awaiting ?? ""} className={sel}><option value="">Anyone</option><option value="BU">The business unit</option><option value="EXECUTIVE">The Executive</option></select></label>
              <label className="text-sm">Response due from<input type="date" name="dueFrom" defaultValue={f.dueFrom} className={sel} /></label>
              <label className="text-sm">Response due to<input type="date" name="dueTo" defaultValue={f.dueTo} className={sel} /></label>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="overdue" value="true" defaultChecked={f.overdue} /> Overdue only</label>
            </>
          ) : null}
          {caps.comment || caps.recommend ? <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="mine" value="true" defaultChecked={f.mine} /> Written by me</label> : null}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonClass("primary")}>Apply filters</button>
            {filtered ? <Link className={buttonClass("secondary")} href={`/executive-oversight?tab=${tab}`}>Clear</Link> : null}
          </div>
        </form>
      </Card>

      {tab === "overview" ? (dash ? <Overview dash={dash} href={href} caps={caps} /> : <Card><EmptyState title="The overview is not available for your role">Use the Recommendations and Comments tabs.</EmptyState></Card>) : null}

      {recs ? (
        <Card>
          <CardHeader title="Recommendation register" description={`${recs.total} record${recs.total === 1 ? "" : "s"}${filtered ? " match your filters" : ""}. One line per addressed unit, most urgent first.`} />
          {recs.rows.length === 0 ? <EmptyState title={filtered ? "No recommendations match" : "No recommendations yet"}>{filtered ? "Try fewer filters." : caps.recommend ? "Make a recommendation to a business unit from here or from any record you are reviewing." : "Recommendations addressed to your unit will appear here."}</EmptyState> : (
            <DataTable caption="Executive recommendations" maxHeight={null} columns={[{ label: "Recommendation" }, { label: "Unit" }, { label: "Module" }, { label: "Issued" }, { label: "Priority" }, { label: "Status" }, { label: "Contact" }, { label: "Due" }, { label: "Latest update" }]}>
              {recs.rows.map((r) => <RecRow key={r.target_id} r={r} />)}
            </DataTable>
          )}
          <Pager page={page} pages={pages} href={href} />
        </Card>
      ) : null}

      {comments ? (
        <Card>
          <CardHeader title="Comment register" description={`${comments.total} comment${comments.total === 1 ? "" : "s"}${filtered ? " match your filters" : ""}.`} />
          {comments.rows.length === 0 ? <EmptyState title={filtered ? "No comments match" : "No comments yet"}>{filtered ? "Try fewer filters." : "Comments about your unit will appear here."}</EmptyState> : (
            <DataTable caption="Executive comments" maxHeight={null} columns={[{ label: "Comment" }, { label: "Unit" }, { label: "Related record" }, { label: "Category" }, { label: "Author" }, { label: "Posted" }, { label: "Replies", align: "right" }, { label: "Last activity" }]}>
              {comments.rows.map((c) => (
                <tr key={c.id}>
                  <td><KindBadge kind="COMMENT" /> <CommentLink id={c.id}>{c.title ?? c.summary.slice(0, 80)}</CommentLink><p className="font-mono text-xs text-muted">{c.reference}{c.visibility === "MANAGEMENT" ? " · management only" : ""}{c.status === "WITHDRAWN" ? " · withdrawn" : ""}</p></td>
                  <td>{c.business_unit_name}</td>
                  <td className="text-xs">{c.subject_label ?? moduleLabel(c.module)}</td>
                  <td>{c.category ? <Badge tone="info">{c.category}</Badge> : <span className="text-muted">—</span>}</td>
                  <td>{c.author_name}<p className="text-xs text-muted">{c.author_role.replace(/_/g, " ").toLowerCase()}</p></td>
                  <td className="whitespace-nowrap">{date(c.created_at)}</td>
                  <td className="text-right tabular-nums">{c.replies}</td>
                  <td className="whitespace-nowrap">{date(c.last_activity_at)}</td>
                </tr>
              ))}
            </DataTable>
          )}
          <Pager page={page} pages={pages} href={href} />
        </Card>
      ) : null}
    </>
  );
}

function RecRow({ r }: { r: EoRecLine }) {
  return (
    <tr>
      <td><KindBadge kind="RECOMMENDATION" /> <RecLink id={r.id}>{r.title}</RecLink><p className="font-mono text-xs text-muted">{r.reference ?? "Draft"} · {r.author_name}</p></td>
      <td>{r.business_unit_name}</td>
      <td className="text-xs">{r.subject_label ?? moduleLabel(r.module)}</td>
      <td className="whitespace-nowrap">{date(r.issued_at)}</td>
      <td><PriorityBadge priority={r.priority} /></td>
      <td><div className="flex flex-col items-start gap-1"><StatusBadge status={r.status} /><OverdueBadge overdue={r.overdue} /><AwaitingBadge awaiting={r.awaiting} /></div></td>
      <td>{r.responsible_name ?? <span className="text-muted">—</span>}{r.responsible_unavailable ? <p className="text-xs text-[var(--warn-fg)]">no longer active</p> : null}</td>
      <td className="whitespace-nowrap">{r.response_requested ? date(r.response_due) : <span className="text-muted">none</span>}</td>
      <td className="max-w-[16rem] text-xs text-muted">{r.latest_update ? <>{r.latest_update.actor_name ?? "System"}: {r.latest_update.excerpt || r.latest_update.event_type.toLowerCase().replace(/_/g, " ")}<p>{date(r.latest_update.occurred_at)}</p></> : "—"}</td>
    </tr>
  );
}

function Pager({ page, pages, href }: { page: number; pages: number; href: (o: Record<string, string | undefined>) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-2 border-t border-line px-6 py-3 text-sm" aria-label="Pages">
      <span className="text-muted">Page {page} of {pages}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={href({ page: String(page - 1) })}>Previous</Link> : null}
        {page < pages ? <Link className={buttonClass("secondary", "sm")} href={href({ page: String(page + 1) })}>Next</Link> : null}
      </span>
    </nav>
  );
}

function Overview({ dash, href, caps }: { dash: Awaited<ReturnType<typeof getDashboard>>; href: (o: Record<string, string | undefined>) => string; caps: ReturnType<typeof eoCaps> }) {
  const reg = (status?: string, extra: Record<string, string | undefined> = {}) => href({ tab: "recommendations", page: undefined, status, ...extra });
  return (
    <div className="space-y-4" data-testid="eo-overview">
      <section aria-label="Overview metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Comments posted" value={dash.comments_total} href={href({ tab: "comments", page: undefined })} hrefLabel="Comment register" definition="Every executive comment you may read, for the filters chosen. A comment asks for no formal response." />
        <MetricCard label="Recommendations issued" value={dash.recommendations_total} note={`${dash.recommendation_units_total} unit record${dash.recommendation_units_total === 1 ? "" : "s"}`} href={reg()} hrefLabel="Register" definition="Recommendations issued (not drafts). A recommendation to several units counts once here and once per unit below." />
        <MetricCard label="Awaiting acknowledgement" value={dash.awaiting_acknowledgement} href={reg("SUBMITTED")} hrefLabel="See them" />
        <MetricCard label="Awaiting a business unit response" value={dash.awaiting_response} href={reg(undefined, { awaiting: "BU" })} hrefLabel="See them" definition="A response was requested and the unit has not yet decided." />
        <MetricCard label="Overdue responses" value={dash.overdue} note={dash.overdue ? "Past the requested date" : "None overdue"} href={reg(undefined, { overdue: "true" })} hrefLabel="See overdue" definition="Overdue is communication only: it never marks a unit non-compliant." />
        <MetricCard label="Accepted for action" value={dash.accepted_for_action} note="Accepted or partially accepted" href={reg("ACCEPTED_FOR_ACTION")} hrefLabel="See them" />
        <MetricCard label="Not accepted" value={dash.declined} note="Declined, with a reason" href={reg("NOT_ACCEPTED")} hrefLabel="See them" />
        <MetricCard label="Under implementation" value={dash.under_implementation} href={reg("IMPLEMENTATION_IN_PROGRESS")} hrefLabel="See them" />
        <MetricCard label="Reported implemented" value={dash.implementation_reported} note="Reported by the unit; not verified here" href={reg("IMPLEMENTATION_REPORTED")} hrefLabel="See them" />
        <MetricCard label="Closed" value={dash.closed} href={reg("CLOSED")} hrefLabel="See them" definition="Closed means the follow-up has finished. It does not mean the underlying matter was resolved." />
        <MetricCard label="Waiting for an Executive" value={dash.awaiting_executive} note="A unit asked for clarification or proposed an alternative" href={reg(undefined, { awaiting: "EXECUTIVE" })} hrefLabel="See them" />
        {caps.recommend ? <MetricCard label="My drafts" value={dash.my_drafts} href={reg("DRAFT", { mine: "true" })} hrefLabel="Open drafts" /> : <MetricCard label="Escalated reminders" value={dash.escalated} />}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard title="Pending business unit responses" empty="Nothing is waiting for a unit." rows={dash.pending_responses} />
        <ListCard title="Overdue responses" empty="No response is overdue." rows={dash.overdue_list} />
        <ListCard title="Recent recommendations" empty="No recommendations yet." rows={dash.recent_recommendations} />
        <Card>
          <CardHeader title="Recent comments" />
          <div className="p-4 text-sm">
            {dash.recent_comments.length === 0 ? <p className="text-muted">No comments yet.</p> : (
              <ul className="space-y-2">
                {dash.recent_comments.map((c) => (
                  <li key={c.id}><KindBadge kind="COMMENT" /> <CommentLink id={c.id}>{c.title ?? c.summary.slice(0, 80)}</CommentLink><p className="text-xs text-muted">{c.business_unit_name} · {c.author_name} · {c.replies} repl{c.replies === 1 ? "y" : "ies"}</p></li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="By business unit" description="Open and overdue recommendation records" />
          <div className="p-4 text-sm">
            {dash.by_unit.length === 0 ? <p className="text-muted">Nothing to show.</p> : (
              <ul className="space-y-1">{dash.by_unit.map((u) => <li key={u.business_unit_id} className="flex justify-between gap-2"><Link className="underline" href={href({ tab: "recommendations", bu: u.business_unit_id, page: undefined })}>{u.name}</Link><span className="tabular-nums text-muted">{u.open} open{u.overdue ? ` · ${u.overdue} overdue` : ""}</span></li>)}</ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Open by priority" />
          <div className="p-4 text-sm">
            <ul className="space-y-1">{PRIORITIES.slice().reverse().map((p) => <li key={p} className="flex justify-between"><PriorityBadge priority={p} /><span className="tabular-nums">{dash.by_priority[p] ?? 0}</span></li>)}</ul>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ListCard({ title, rows, empty }: { title: string; rows: EoRecLine[]; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="p-4 text-sm">
        {rows.length === 0 ? <p className="text-muted">{empty}</p> : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.target_id}><RecLink id={r.id}>{r.title}</RecLink> <PriorityBadge priority={r.priority} />
                <p className="text-xs text-muted">{r.business_unit_name} · <StatusBadge status={r.status} /> {r.response_due ? ` · due ${date(r.response_due)}` : ""} <OverdueBadge overdue={r.overdue} /></p></li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
