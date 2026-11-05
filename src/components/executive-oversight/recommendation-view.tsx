"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Banner, Button, Card, CardHeader, Textarea } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import { AreaF, DialogForm, PersonF, SelectF } from "@/components/session-notes/forms";
import { RESPONSES, eventLabel, moduleLabel } from "@/lib/executive-oversight/constants";
import type { EoCaps } from "@/lib/executive-oversight/caps";
import type { EoPerson, EoRecFull, EoTarget } from "@/lib/executive-oversight/types";
import type { EoCategory } from "@/lib/executive-oversight/types";
import { Attachments } from "./attachments";
import { AwaitingBadge, KindBadge, Links, OverdueBadge, PriorityBadge, RichText, StatusBadge, dateText, dateTimeText, newKey } from "./common";
import { RecommendationDialog, type DraftInit, type Unit } from "./forms";
import { LinkPicker } from "./link-picker";

const RESPONSE_PHASE = ["SUBMITTED", "ACKNOWLEDGED", "RESPONSE_REQUESTED", "UNDER_CONSIDERATION", "RESPONSE_SUBMITTED"];
const PROGRESS_PHASE = ["ACCEPTED_FOR_ACTION", "PARTIALLY_ACCEPTED", "IMPLEMENTATION_IN_PROGRESS"];
const OPEN = ["SUBMITTED", "ACKNOWLEDGED", "RESPONSE_REQUESTED", "RESPONSE_SUBMITTED", "UNDER_CONSIDERATION", "ACCEPTED_FOR_ACTION", "PARTIALLY_ACCEPTED", "NOT_ACCEPTED", "IMPLEMENTATION_IN_PROGRESS", "IMPLEMENTATION_REPORTED"];

/** One recommendation: the advice, each addressed unit's own record and actions, the conversation and the full history. Every button mirrors a rule the database enforces. */
export function RecommendationView({ rec, caps, units, categories, unitPeople }: { rec: EoRecFull; caps: EoCaps; units: Unit[]; categories: EoCategory[]; unitPeople: Record<string, EoPerson[]> }) {
  const isAuthor = rec.author_id === caps.viewerId;
  const active = rec.status === "ACTIVE";
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const draftInit: DraftInit | undefined = rec.status === "DRAFT" ? {
    id: rec.id, version: rec.version, title: rec.title, detail: rec.detail, background: rec.background, reason: rec.reason, expected_outcome: rec.expected_outcome, proposed_direction: rec.proposed_direction,
    priority: rec.priority, category_code: rec.category_code, module: rec.module, response_requested: rec.response_requested, response_due: rec.response_due, recommended_owner_role: rec.recommended_owner_role,
    recommended_owner_user: rec.recommended_owner_user, targets: rec.targets.map((t) => t.business_unit_id), links: rec.links.map((l) => ({ target_type: l.target_type, target_id: l.target_id, label: l.label })),
  } : undefined;
  const canLink = (isAuthor && caps.recommend) || (active && (caps.respond || caps.progress) && rec.targets.some((t) => t.business_unit_id === caps.viewerBu));
  const targetUnit = rec.targets[0]?.business_unit_id ?? null;
  return (
    <div className="space-y-4">
      <Banner tone="info" title="This is advice, not an instruction">
        A recommendation changes no goal, task, score, report or compliance record. A unit that agrees makes the change through its own normal workflow and can link it here.
      </Banner>

      <Card>
        <CardHeader title={<span className="flex flex-wrap items-center gap-2">{rec.title}</span>}
          description={<span className="flex flex-wrap items-center gap-2"><KindBadge kind="RECOMMENDATION" /><PriorityBadge priority={rec.priority} /><span className="font-mono text-xs">{rec.reference ?? "Draft"}</span>{rec.status === "WITHDRAWN" ? <Badge tone="locked">Withdrawn</Badge> : null}{rec.status === "DRAFT" ? <Badge tone="undefined">Draft</Badge> : null}</span>}
          action={isAuthor ? (
            <div className="flex flex-wrap gap-2">
              {rec.status === "DRAFT" && caps.recommend ? <><Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit draft</Button>
                <Button size="sm" disabled={pending || !rec.reason} onClick={() => void run(() => apiRequest("POST", `executive-recommendations/${rec.id}/publish`, { expectedVersion: rec.version, requestKey: newKey() }), { success: "Recommendation issued." })}>Issue recommendation</Button></> : null}
              {(rec.status === "DRAFT" || active) && caps.withdraw ? <ReasonDialog label="Withdraw" title="Withdraw this recommendation" description="Every addressed unit's record becomes withdrawn. The recommendation and everything said about it stay in the history." field="Why are you withdrawing it?" submit="Withdraw recommendation"
                path={`executive-recommendations/${rec.id}/withdraw`} success="Recommendation withdrawn." variant="danger" /> : null}
              {active && caps.close ? <ReasonDialog label="Close all" title="Close this recommendation" description="Closing says you have finished following it up. It does not mean the underlying matter is resolved, and it changes nothing in the unit's records." field="Why are you closing it?" submit="Close recommendation"
                path={`executive-recommendations/${rec.id}/close`} success="Recommendation closed." /> : null}
            </div>
          ) : !isAuthor && active && caps.close && !rec.author_active ? (
            <ReasonDialog label="Close all" title="Close this recommendation" description="The author is no longer active, so another executive may close it." field="Why are you closing it?" submit="Close recommendation" path={`executive-recommendations/${rec.id}/close`} success="Recommendation closed." />
          ) : undefined} />
        <div className="space-y-3 p-6 text-sm">
          <RichText md={rec.detail} />
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Background or observation" value={rec.background} rich />
            <Field label="Why it is recommended" value={rec.reason} rich />
            <Field label="Expected outcome" value={rec.expected_outcome} rich />
            <Field label="Suggested improvement direction" value={rec.proposed_direction} rich />
            <Field label="Issued by" value={`${rec.author_name} (${rec.author_role.replace(/_/g, " ").toLowerCase()})`} />
            <Field label="Issued" value={rec.published_at ? dateTimeText(rec.published_at) : `Draft started ${dateTimeText(rec.created_at)}`} />
            <Field label="Module" value={moduleLabel(rec.module)} />
            <Field label="Related record" value={rec.subject_label} />
            <Field label="Quarter and week" value={[rec.quarter, rec.week].filter(Boolean).join(" · ") || null} />
            <Field label="Suggested responsible" value={[rec.recommended_owner_role, rec.recommended_owner_name].filter(Boolean).join(" · ") || null} />
            <Field label="Response" value={rec.response_requested ? `Requested${rec.response_due ? ` by ${dateText(rec.response_due)}` : ""}` : "Not requested (for information and consideration)"} />
          </dl>
          <div className="space-y-2"><Links links={rec.links} />
            {canLink ? <LinkAdder rec={rec} buId={caps.viewAll || isAuthor ? targetUnit : caps.viewerBu} /> : null}
          </div>
        </div>
      </Card>

      {rec.targets.map((t) => <TargetCard key={t.target_id} t={t} rec={rec} caps={caps} isAuthor={isAuthor} people={unitPeople[t.business_unit_id] ?? []} />)}

      <Card>
        <CardHeader title="Conversation and files" description="Messages from the Executive and the unit, in the order they were written." />
        <div className="space-y-4 p-6">
          <Timeline rec={rec} />
          {active && caps.reply ? <MessageBox rec={rec} /> : null}
          <Attachments owner={{ kind: "recommendation", id: rec.id }} files={rec.attachments} viewerId={caps.viewerId}
            canAttach={(rec.status === "DRAFT" || active) && ((isAuthor && caps.recommend) || ((caps.respond || caps.progress) && rec.targets.some((t) => t.business_unit_id === caps.viewerBu)))} />
        </div>
      </Card>

      {editing && draftInit ? <RecommendationDialog open onOpenChange={setEditing} draft={draftInit} units={units} categories={categories}
        subject={{ module: rec.module, subjectType: rec.subject_type, subjectId: rec.subject_id, subjectLabel: rec.subject_label, businessUnitId: null, quarterId: rec.quarter_id, reportingWeekId: rec.reporting_week_id }} onDone={() => undefined} /> : null}
      <p className="text-xs text-muted"><Link className="underline" href="/executive-oversight?tab=recommendations">Back to the recommendation register</Link></p>
    </div>
  );
}

function Field({ label, value, rich }: { label: string; value: string | null; rich?: boolean }) {
  if (!value) return null;
  return <div><dt className="text-xs font-medium text-muted">{label}</dt><dd className="text-ink">{rich ? <RichText md={value} /> : value}</dd></div>;
}

function ReasonDialog({ label, title, description, field, submit, path, success, variant = "secondary", extra }: {
  label: string; title: string; description: string; field: string; submit: string; path: string; success: string; variant?: "secondary" | "danger"; extra?: Record<string, unknown>;
}) {
  const [reason, setReason] = useState("");
  return (
    <DialogForm label={label} title={title} description={description} submitLabel={submit} success={success} variant={variant} canSubmit={!!reason.trim()} onOpen={() => setReason("")}
      onSubmit={() => apiRequest("POST", path, { ...extra, reason: reason.trim(), requestKey: newKey() })}>
      <AreaF id={`why-${path}`} label={field} value={reason} onChange={setReason} rows={3} max={2000} required />
    </DialogForm>
  );
}

function LinkAdder({ rec, buId }: { rec: EoRecFull; buId: string | null }) {
  const { run } = useAction();
  return (
    <div className="space-y-1">
      <LinkPicker buId={buId} weekId={rec.reporting_week_id} exclude={rec.links.map((l) => l.target_id)}
        onPick={async (l) => { await run(() => apiRequest("POST", `executive-recommendations/${rec.id}/links`, { targetType: l.target_type, targetId: l.target_id }), { success: "Linked." }); }} />
      <p className="text-xs text-muted">Linking is a reference only. The linked record is not changed.</p>
    </div>
  );
}

function TargetCard({ t, rec, caps, isAuthor, people }: { t: EoTarget; rec: EoRecFull; caps: EoCaps; isAuthor: boolean; people: EoPerson[] }) {
  const mineUnit = t.business_unit_id === caps.viewerBu;
  const active = rec.status === "ACTIVE";
  const { run, pending } = useAction();
  const respondOk = active && mineUnit && caps.respond;
  return (
    <Card data-testid={`target-${t.business_unit_id}`}>
      <CardHeader title={t.business_unit_name} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={t.status} /><OverdueBadge overdue={t.overdue} /><AwaitingBadge awaiting={t.awaiting} />{!t.business_unit_active ? <Badge tone="locked">Unit archived</Badge> : null}</span>} />
      <div className="space-y-3 p-6 text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
          <div><dt className="text-xs font-medium text-muted">Responsible contact</dt><dd>{t.responsible_name ?? "Not yet named"}{t.responsible_unavailable ? <> <Badge tone="warn">No longer active</Badge></> : null}</dd></div>
          <div><dt className="text-xs font-medium text-muted">Response due</dt><dd>{rec.response_requested ? (t.response_due ? dateText(t.response_due) : "No deadline") : "Not requested"}</dd></div>
          <div><dt className="text-xs font-medium text-muted">Acknowledged</dt><dd>{t.acknowledged_at ? `${dateText(t.acknowledged_at)}${t.acknowledged_by ? ` by ${t.acknowledged_by}` : ""}` : "Not yet"}</dd></div>
        </dl>
        {t.status === "CLOSED" ? <p className="text-muted">Closed {dateText(t.closed_at)} by {t.closed_by}: {t.close_reason}{t.closed_without_response ? " — closed before the unit responded." : ""}</p> : null}
        {t.escalation_level > 0 && !["CLOSED", "WITHDRAWN"].includes(t.status) ? <p className="text-xs text-muted">Reminders have been escalated (stage {t.escalation_level}). This is communication only; it has no compliance effect.</p> : null}
        <div className="flex flex-wrap gap-2">
          {respondOk && t.status === "SUBMITTED" ? <Button size="sm" disabled={pending} onClick={() => void run(() => apiRequest("POST", `executive-recommendation-targets/${t.target_id}/acknowledge`, { expectedVersion: t.target_version, requestKey: newKey() }), { success: "Receipt acknowledged." })}>Acknowledge receipt</Button> : null}
          {respondOk && RESPONSE_PHASE.includes(t.status) ? <RespondDialog t={t} /> : null}
          {active && mineUnit && caps.progress && PROGRESS_PHASE.includes(t.status) ? <ProgressDialog t={t} /> : null}
          {respondOk && !["CLOSED", "WITHDRAWN"].includes(t.status) ? <ReassignDialog t={t} people={people} /> : null}
          {active && isAuthor && caps.recommend && OPEN.filter((s) => s !== "SUBMITTED").includes(t.status) ? <FollowUpDialog t={t} /> : null}
          {active && isAuthor && caps.close && OPEN.includes(t.status) && rec.targets.length > 1 ? <ReasonDialog label="Close this unit" title={`Close for ${t.business_unit_name}`} description="Closing says you have finished following this unit up. It does not mean the matter is resolved." field="Why are you closing it?" submit="Close for this unit"
            path={`executive-recommendations/${rec.id}/close`} success="Closed for this unit." extra={{ targetId: t.target_id }} /> : null}
        </div>
      </div>
    </Card>
  );
}

function RespondDialog({ t }: { t: EoTarget }) {
  const [decision, setDecision] = useState("ACCEPT");
  const [body, setBody] = useState("");
  const r = RESPONSES.find((x) => x.value === decision)!;
  return (
    <DialogForm label="Respond" title={`Respond for ${t.business_unit_name}`} description="Your response is recorded with your name and goes to the Executive who made the recommendation." submitLabel="Send response" success="Response sent."
      canSubmit={r.needs === "optional" || !!body.trim()} onOpen={() => { setDecision("ACCEPT"); setBody(""); }}
      onSubmit={() => apiRequest("POST", `executive-recommendation-targets/${t.target_id}/respond`, { decision, body: body.trim() || null, expectedVersion: t.target_version, requestKey: newKey() })}>
      <SelectF id={`dec-${t.target_id}`} label="Your response" value={decision} onChange={setDecision} options={RESPONSES.map((x) => [x.value, x.label] as const)} hint={r.help} />
      <AreaF id={`resp-${t.target_id}`} label={r.needs === "required" ? "Explanation (required)" : "Remarks (optional)"} value={body} onChange={setBody} rows={4} max={10000} required={r.needs === "required"} />
    </DialogForm>
  );
}

function ProgressDialog({ t }: { t: EoTarget }) {
  const [kind, setKind] = useState("PROGRESS");
  const [body, setBody] = useState("");
  return (
    <DialogForm label="Report progress" title={`Implementation update for ${t.business_unit_name}`} description="Say what has been done. The change itself is made through your normal workflow; this update does not change any OKR record." submitLabel="Send update" success="Update recorded."
      canSubmit={!!body.trim()} onOpen={() => { setKind("PROGRESS"); setBody(""); }}
      onSubmit={() => apiRequest("POST", `executive-recommendation-targets/${t.target_id}/progress`, { kind, body: body.trim(), expectedVersion: t.target_version, requestKey: newKey() })}>
      <SelectF id={`pk-${t.target_id}`} label="Update" value={kind} onChange={setKind} options={[["PROGRESS", "Work is in progress"], ["IMPLEMENTED", "Reported as implemented"]]} />
      <AreaF id={`pb-${t.target_id}`} label="What has happened" value={body} onChange={setBody} rows={4} max={10000} required />
    </DialogForm>
  );
}

function FollowUpDialog({ t }: { t: EoTarget }) {
  const [body, setBody] = useState("");
  return (
    <DialogForm label="Ask a follow-up question" title={`Follow-up for ${t.business_unit_name}`} description="The unit is asked to answer again." submitLabel="Ask" success="Question sent." canSubmit={!!body.trim()} onOpen={() => setBody("")}
      onSubmit={() => apiRequest("POST", `executive-recommendation-targets/${t.target_id}/follow-up`, { body: body.trim(), expectedVersion: t.target_version, requestKey: newKey() })}>
      <AreaF id={`fu-${t.target_id}`} label="Your question" value={body} onChange={setBody} rows={3} max={10000} required />
    </DialogForm>
  );
}

function ReassignDialog({ t, people }: { t: EoTarget; people: EoPerson[] }) {
  const [user, setUser] = useState("");
  const [reason, setReason] = useState("");
  return (
    <DialogForm label="Change contact" title="Change the responsible contact" description="Choose another active member of your unit." submitLabel="Change contact" success="Contact changed." canSubmit={!!user && !!reason.trim()} onOpen={() => { setUser(""); setReason(""); }}
      onSubmit={() => apiRequest("POST", `executive-recommendation-targets/${t.target_id}/reassign`, { userId: user, reason: reason.trim() })}>
      <PersonF id={`ru-${t.target_id}`} label="New contact" people={people.map((p) => ({ id: p.id, name: p.name, business_unit_id: t.business_unit_id, business_unit_name: t.business_unit_name } as never))} value={user} onChange={setUser} required />
      <AreaF id={`rr-${t.target_id}`} label="Why?" value={reason} onChange={setReason} rows={2} max={2000} required />
    </DialogForm>
  );
}

function Timeline({ rec }: { rec: EoRecFull }) {
  return (
    <ol className="space-y-2" aria-label="History">
      {rec.events.map((e) => (
        <li key={e.id} className={`rounded-lg border p-2 text-sm ${e.event_type === "MESSAGE" || e.body ? "border-line" : "border-transparent bg-surface"}`}>
          <p className="text-xs text-muted"><span className="font-medium text-ink">{e.actor_name ?? "System"}</span> {e.actor_role ? `(${e.actor_role.replace(/_/g, " ").toLowerCase()}) ` : ""}· {eventLabel(e.event_type)}{e.target_unit ? ` · ${e.target_unit}` : ""} · {dateTimeText(e.occurred_at)}</p>
          {e.body ? <RichText md={e.body} className="mt-1" /> : null}
          {e.event_type === "ESCALATED" ? <p className="mt-1 text-xs text-muted">{String(e.details?.days_overdue ?? "")} day(s) past the deadline. Communication only.</p> : null}
          {e.event_type === "LINK_ADDED" ? <p className="mt-1 text-xs text-muted">{String(e.details?.label ?? "")}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function MessageBox({ rec }: { rec: EoRecFull }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [key, setKey] = useState(newKey);
  const { run, pending } = useAction();
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => apiRequest("POST", `executive-recommendations/${rec.id}/replies`, { content: text.trim(), targetId: target || null, requestKey: key }), { success: "Message sent." }); if (r) { setText(""); setKey(newKey()); } }}>
      <label className="sr-only" htmlFor="eo-msg">Write a message</label>
      <Textarea id="eo-msg" rows={3} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {rec.targets.length > 1 ? (
          <select aria-label="Who is the message for" className="rounded-lg border border-line bg-panel px-2 py-1 text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Everyone addressed</option>{rec.targets.map((t) => <option key={t.target_id} value={t.target_id}>{t.business_unit_name}</option>)}
          </select>
        ) : <span />}
        <Button size="sm" type="submit" disabled={pending || !text.trim()}>{pending ? "Sending…" : "Send message"}</Button>
      </div>
    </form>
  );
}
