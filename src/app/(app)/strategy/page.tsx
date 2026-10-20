import type { Metadata } from "next";
import Link from "next/link";
import { ScoreText, watDate } from "@/components/status";
import { Badge, Banner, Card, CardHeader, EmptyState, PageHeader, ScoreBar } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { currentQuarter, getAnnualTheme, getStrategyHistory, getStrategyTree, getThemeChanges, listQuarters, listStrategyChanges } from "@/lib/data";
import { ChangeQueue, RequestChange } from "./strategy-change-actions";
import { ActivateButton, AddKeyResult, AddSubKr, CreateQuarters, CreateTheme, ChangeTheme, EditText, ObjectiveForm } from "./strategy-actions";

export const metadata: Metadata = { title: "Strategy" };

export default async function StrategyPage({ searchParams }: PageProps<"/strategy">) {
  const sp = await searchParams;
  const actor = await requireActor();
  const quarters = await listQuarters();
  const wantedId = typeof sp.quarter === "string" ? sp.quarter : undefined;
  const quarter = quarters.find((q) => q.id === wantedId) ?? (await currentQuarter());
  const year = quarter?.year ?? new Date().getUTCFullYear();
  const theme = await getAnnualTheme(year);
  const changes = theme ? await getThemeChanges(theme.id) : [];
  const tree = quarter ? await getStrategyTree(quarter.id) : null;
  const baselined = quarter?.status === "ACTIVE";                       // an active quarter is a controlled baseline: changes are requested, not made
  const editable = quarter && quarter.status !== "LOCKED" && !baselined;
  const canRequest = baselined && can(actor, "strategy.change.request");
  const changes2 = quarter && quarter.status !== "PLANNED" ? await listStrategyChanges(quarter.id) : [];
  const history = quarter && quarter.status !== "PLANNED" ? await getStrategyHistory(quarter.id) : [];
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));
  const describeChange = (c: (typeof changes2)[number]) => `${c.change_type === "EDIT" ? "Edit" : c.change_type === "ADD" ? "Add" : "Retire"} ${c.item_type === "OBJECTIVE" ? "objective" : c.item_type === "KR" ? "key result" : "Sub-KR"}: ${c.new_title ?? c.current_title ?? ""}`;
  const canObj = can(actor, "strategy.objective.create");

  return (
    <>
      <PageHeader title="Strategy" description="Annual Theme → Quarterly Objective → Key Results → Sub-KRs. Strategy is organisation-wide: every BU maps its weekly goals to the same Sub-KRs." />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Annual Theme ${year}`}
            action={theme && can(actor, "strategy.annual_theme.change_exception") ? <ChangeTheme themeId={theme.id} current={theme.theme} /> : undefined} />
          <div className="space-y-3 px-6 py-4">
            {theme ? <p className="text-xl font-semibold">{theme.theme}</p> : (
              <EmptyState title="No annual theme for this year">
                {can(actor, "strategy.annual_theme.create") ? "Set the single theme that frames the year's quarterly objectives." : "A SuperAdmin or Admin sets the annual theme."}
                {can(actor, "strategy.annual_theme.create") ? <CreateTheme year={year} /> : null}
              </EmptyState>
            )}
            {changes.length ? (
              <details className="text-sm"><summary className="cursor-pointer text-muted">Exceptional change history ({changes.length})</summary>
                <ul className="mt-2 space-y-2">{changes.map((c, i) => (
                  <li key={i} className="rounded-lg bg-surface p-3"><p><s className="text-muted">{c.old_theme}</s> → {c.new_theme}</p><p className="text-muted">Reason: {c.reason} · {watDate(c.changed_at)}</p></li>))}</ul></details>
            ) : null}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2" role="navigation" aria-label="Quarters">
          {quarters.length === 0 ? <span className="text-sm text-muted">No quarters yet.</span> : null}
          {quarters.map((q) => (
            <Link key={q.id} href={`/strategy?quarter=${q.id}`} aria-current={quarter?.id === q.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${quarter?.id === q.id ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel hover:bg-surface"}`}>
              Q{q.quarter_number} {q.year} · {q.status.toLowerCase()}
            </Link>
          ))}
          {can(actor, "strategy.quarter.manage") ? <CreateQuarters year={year} /> : null}
        </div>

        {quarter && tree ? (
          <Card>
            <CardHeader
              title={`Q${quarter.quarter_number} ${quarter.year} objective`}
              description={`${watDate(quarter.starts_on)} – ${watDate(quarter.ends_on)}`}
              action={<Badge tone={quarter.status === "ACTIVE" ? "done" : quarter.status === "LOCKED" ? "locked" : "info"}>{quarter.status === "LOCKED" ? "Locked · read-only" : quarter.status.charAt(0) + quarter.status.slice(1).toLowerCase()}</Badge>} />
            <div className="space-y-5 px-6 py-4">
              {quarter.status === "LOCKED" ? <Banner tone="locked" title="This quarter is locked">Its objective, key results, Sub-KRs and scores are historical records and cannot be edited.</Banner> : null}
              {tree.objective ? (
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-lg font-semibold">{tree.objective.title}</p>{tree.objective.description ? <p className="mt-1 text-sm text-muted">{tree.objective.description}</p> : null}</div>
                  {editable && can(actor, "strategy.objective.edit") ? <EditText kind="objectives" id={tree.objective.id} title={tree.objective.title} description={tree.objective.description} label="objective" /> : null}
                  {canRequest ? <RequestChange mode="EDIT" itemType="OBJECTIVE" itemId={tree.objective.id} current={{ title: tree.objective.title, description: tree.objective.description }} label="objective" /> : null}
                </div>
              ) : canObj && editable ? <ObjectiveForm quarterId={quarter.id} /> : <EmptyState title="No objective yet">An Admin creates the single objective for this quarter.</EmptyState>}

              {tree.objective ? (
                <ol className="space-y-4">
                  {tree.key_results.map((kr) => (
                    <li key={kr.id} className="rounded-lg border border-line">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-surface px-4 py-3">
                        <div><p className={kr.status === "RETIRED" ? "font-semibold text-muted line-through" : "font-semibold"}>{kr.code} · {kr.title}{kr.status === "RETIRED" ? <> <Badge tone="locked">Retired</Badge></> : null}</p>{kr.description ? <p className="text-sm text-muted">{kr.description}</p> : null}</div>
                        {editable && can(actor, "strategy.kr.edit") ? <EditText kind="key-results" id={kr.id} title={kr.title} description={kr.description} label="key result" /> : null}
                        {canRequest && kr.status !== "RETIRED" ? <span className="flex gap-2"><RequestChange mode="EDIT" itemType="KR" itemId={kr.id} current={{ title: kr.title, description: kr.description }} label={`key result ${kr.code}`} /><RequestChange mode="RETIRE" itemType="KR" itemId={kr.id} label={`key result ${kr.code}`} /></span> : null}
                      </div>
                      <ul className="divide-y divide-line">
                        {kr.sub_key_results.map((s) => (
                          <li key={s.id} className="grid items-center gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_180px_auto]">
                            <span className={s.status === "RETIRED" ? "text-muted line-through" : undefined}><strong className="font-medium">{s.code}</strong> {s.title}{s.status === "RETIRED" ? <> <Badge tone="locked">Retired</Badge></> : null}</span>
                            {s.execution === null ? <span className="text-muted">No finalised goals yet</span> : <ScoreBar value={Number(s.execution)} label={`${s.code} goal execution`} />}
                            <span className="flex items-center justify-end gap-2 text-muted"><span className="tabular-nums">{s.done_goals}/{s.mapped_goals} goals</span>
                              {editable && can(actor, "strategy.subkr.edit") ? <EditText kind="sub-key-results" id={s.id} title={s.title} description={s.description} label="Sub-KR" /> : null}
                              {canRequest && s.status !== "RETIRED" ? <><RequestChange mode="EDIT" itemType="SUBKR" itemId={s.id} current={{ title: s.title, description: s.description }} label={`Sub-KR ${s.code}`} /><RequestChange mode="RETIRE" itemType="SUBKR" itemId={s.id} label={`Sub-KR ${s.code}`} /></> : null}</span>
                          </li>
                        ))}
                        {kr.sub_key_results.length === 0 ? <li className="px-4 py-3 text-sm text-[var(--critical-fg)]">This key result needs at least one Sub-KR.</li> : null}
                      </ul>
                      {editable && can(actor, "strategy.subkr.create") ? <div className="border-t border-line px-4 py-2"><AddSubKr krId={kr.id} /></div> : null}
                      {canRequest && kr.status !== "RETIRED" ? <div className="border-t border-line px-4 py-2"><RequestChange mode="ADD" itemType="SUBKR" parentId={kr.id} label={`under ${kr.code}`} /></div> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              {tree.objective && editable && can(actor, "strategy.kr.create") && tree.key_results.length < 4 ? <AddKeyResult objectiveId={tree.objective.id} count={tree.key_results.length} /> : null}
              {tree.objective && canRequest && tree.key_results.length < 4 ? <RequestChange mode="ADD" itemType="KR" parentId={tree.objective.id} label="key result" /> : null}
              {baselined ? <Banner tone="info" title="This quarter is a controlled baseline">Its strategy is no longer edited directly. Ask for a change; a different person approves it, a new version is recorded and earlier versions are kept. Items are retired, never deleted.</Banner> : null}

              {quarter.status === "PLANNED" ? (
                <div className="space-y-2 rounded-lg bg-surface p-4">
                  <p className="font-medium">Activation checklist</p>
                  {tree.readiness.length === 0 ? <p className="text-sm text-[var(--done-fg)]">Ready: 3–4 key results, each with at least one Sub-KR.</p> : (
                    <ul className="list-disc pl-5 text-sm text-muted">{tree.readiness.map((r) => <li key={r}>{r}</li>)}</ul>)}
                  {can(actor, "strategy.quarter.manage") ? <ActivateButton quarterId={quarter.id} disabled={tree.readiness.length > 0} /> : null}
                  <p className="text-xs text-muted">The quarter also activates automatically when it starts, if it is complete. It locks automatically when the next quarter begins.</p>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}
        {quarter && quarter.status !== "PLANNED" ? (
          <Card>
            <CardHeader title="Strategy change requests" description="Changes to an active quarter: one person asks, a different person approves, and approval applies the change." />
            <ChangeQueue me={actor.id} canApprove={can(actor, "strategy.change.approve")} items={changes2.map((c) => ({ id: c.id, status: c.status, summary: describeChange(c), reason: c.reason, requestedBy: c.requested_by, requestedById: c.requested_by_id, decidedBy: c.decided_by, comment: c.decision_comment, when: when(c.created_at) }))} />
            {history.some((h) => h.version > 1) ? (
              <details className="border-t border-line px-6 py-3 text-sm"><summary className="cursor-pointer font-medium">Version history</summary>
                <ul className="mt-2 space-y-1">{history.filter((h) => h.version > 1 || history.some((x) => x.item_id === h.item_id && x.version > 1)).map((h) => (
                  <li key={`${h.item_id}-${h.version}`} className="text-muted">v{h.version}{h.baseline ? " (baseline)" : ""} · {h.item_type === "OBJECTIVE" ? "objective" : h.item_type === "KR" ? "key result" : "Sub-KR"}: <span className="text-ink">{h.title}</span>{h.status === "RETIRED" ? " · retired" : ""} · {when(h.recorded_at)}</li>))}</ul></details>
            ) : null}
          </Card>
        ) : null}
        {quarter && quarter.status !== "PLANNED" && tree?.key_results.length ? <p className="text-xs text-muted">Sub-KR execution = done mapped goals ÷ total mapped goals in finalised, submitted reports (<ScoreText value={null} /> until data exists). It measures goal execution, not KR outcome attainment.</p> : null}
      </div>
    </>
  );
}
