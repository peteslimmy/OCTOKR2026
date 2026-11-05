"use client";

import { useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import { CARRY_OUTCOMES, PRIORITIES, RISK_CATEGORIES, RISK_KINDS, RISK_STATUSES, SEVERITIES } from "@/lib/session-notes/constants";
import type { ActionRow, DecisionRow, NoteRow, Outstanding, Person, RiskRow, Workspace } from "@/lib/session-notes/types";
import { ActionCard, type ActionCaps } from "./action-card";
import { AreaF, DialogForm, PersonF, SelectF, TextF } from "./forms";
import { DecisionStatusBadge, LinkChips, SeverityBadge, dateText, newKey } from "./common";
import { LinkPicker } from "./link-picker";
import type { Caps } from "./workspace";

export interface Prefill { kind: "decision" | "action" | "risk"; note: NoteRow }
interface Common { ws: Workspace; caps: Caps; editable: boolean; people: Person[]; prefill: Prefill | null; clearPrefill: () => void }
const today = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);   // Lagos is UTC+1

// ------------------------------------------------------------------ decisions
export function DecisionsPanel({ ws, caps, editable, prefill, clearPrefill }: Common) {
  const s = ws.session;
  const mine = prefill?.kind === "decision" ? prefill.note : null;
  const [title, setTitle] = useState(mine?.title ?? "");
  const [description, setDescription] = useState(mine?.content ?? "");
  const [background, setBackground] = useState("");
  const [justification, setJustification] = useState("");
  const [date, setDate] = useState(today());
  const [outcome, setOutcome] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [authority, setAuthority] = useState("");
  const [involved, setInvolved] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [newText, setNewText] = useState("");
  const canWrite = caps.decisionsCreate && editable;

  return (
    <div className="space-y-4">
      <h2 className="sr-only">Decisions</h2>
      <Card className="p-4 text-sm text-muted">
        A decision is <strong className="text-ink">proposed</strong> when it is recorded, and becomes a <strong className="text-ink">formal decision</strong> only when a person with the approval authority approves it. Something mentioned in discussion is a note, not a decision.
      </Card>
      {canWrite ? (
        <div>
          <DialogForm key={mine?.id ?? "new"} label={mine ? "Propose this note as a decision…" : "Propose a decision…"} title="Propose a decision" description="It stays proposed until it is approved." submitLabel="Record proposal" variant="primary" size="md" success="Decision proposed."
            canSubmit={title.trim().length > 0 && description.trim().length > 0} onOpen={() => undefined}
            onSubmit={async () => { const r = await apiRequest<{ id: string }>("POST", `okr-sessions/${s.id}/decisions`, { title: title.trim(), description: description.trim(), background: background.trim() || undefined, justification: justification.trim() || undefined, decisionDate: date, affectedBuId: s.business_unit_id ?? undefined, involvedUserIds: involved, expectedOutcome: outcome.trim() || undefined, followUp: followUp.trim() || undefined, sourceNoteId: mine?.id, authorityNote: authority.trim() || undefined, clientKey: newKey() }); clearPrefill(); setTitle(""); setDescription(""); return r; }}>
            <TextF id="d-title" label="Decision" value={title} onChange={setTitle} required max={300} />
            <AreaF id="d-desc" label="What was decided" value={description} onChange={setDescription} required rows={4} max={10000} />
            <AreaF id="d-bg" label="Background / context" value={background} onChange={setBackground} max={10000} />
            <AreaF id="d-just" label="Reason or justification" value={justification} onChange={setJustification} max={10000} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextF id="d-date" label="Date of decision" type="date" value={date} onChange={setDate} required />
              <TextF id="d-auth" label="Authority making the decision" value={authority} onChange={setAuthority} max={300} hint="For example “Management committee”." />
            </div>
            <AreaF id="d-out" label="Expected outcome" value={outcome} onChange={setOutcome} max={5000} />
            <AreaF id="d-fu" label="Follow-up required" value={followUp} onChange={setFollowUp} max={5000} />
            <fieldset className="space-y-1"><legend className="text-sm font-medium text-ink">Participants involved</legend>
              <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                {ws.participants.filter((p) => !p.removed_at).map((p) => (
                  <label key={p.user_id} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={involved.includes(p.user_id)} onChange={(e) => setInvolved((l) => (e.target.checked ? [...l, p.user_id] : l.filter((x) => x !== p.user_id)))} /> {p.name}</label>
                ))}
              </div>
            </fieldset>
          </DialogForm>
        </div>
      ) : null}
      {ws.decisions.length === 0 ? <Card><EmptyState title="No decisions recorded in this session" /></Card> : ws.decisions.map((d) => (
        <DecisionCard key={d.id} d={d} caps={caps} editable={editable} buId={s.business_unit_id} weekId={s.reporting_week_id} reason={reason} setReason={setReason} newText={newText} setNewText={setNewText} />
      ))}
    </div>
  );
}

function DecisionCard({ d, caps, editable, buId, weekId, reason, setReason, newText, setNewText }: { d: DecisionRow; caps: Caps; editable: boolean; buId: string | null; weekId: string | null; reason: string; setReason: (v: string) => void; newText: string; setNewText: (v: string) => void }) {
  const { run } = useAction();
  const [title, setTitle] = useState(d.title);
  const [desc, setDesc] = useState(d.description);
  const [authority, setAuthority] = useState(d.authority_note ?? "");
  const proposed = d.status === "PROPOSED", approved = d.status === "APPROVED";
  const post = (outcome: string, extra: Record<string, unknown> = {}) => apiRequest("POST", `okr-decisions/${d.id}/decide`, { outcome, expectedVersion: d.version, key: newKey(), ...extra });
  return (
    <Card className="p-4" data-testid="decision-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">{d.reference}</span><DecisionStatusBadge status={d.status} />
        {proposed ? <Badge tone="warn">Not a formal decision yet</Badge> : null}
        {d.supersedes_reference ? <Badge tone="info">Replaces {d.supersedes_reference}</Badge> : null}
        {d.superseded_by_reference ? <Badge tone="locked">Replaced by {d.superseded_by_reference}</Badge> : null}
      </div>
      <h3 className="mt-1 text-base font-semibold text-ink">{d.title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{d.description}</p>
      {d.background ? <p className="mt-2 text-sm"><span className="text-muted">Background:</span> {d.background}</p> : null}
      {d.justification ? <p className="mt-1 text-sm"><span className="text-muted">Reason:</span> {d.justification}</p> : null}
      {d.expected_outcome ? <p className="mt-1 text-sm"><span className="text-muted">Expected outcome:</span> {d.expected_outcome}</p> : null}
      {d.follow_up ? <p className="mt-1 text-sm"><span className="text-muted">Follow-up:</span> {d.follow_up}</p> : null}
      <p className="mt-2 text-xs text-muted">
        Dated {dateText(d.decision_date)} · recorded by {d.created_by_name ?? "—"}{d.decided_by_name ? ` · ${d.status === "REJECTED" ? "rejected" : "approved"} by ${d.decided_by_name} ${dateText(d.decided_at)}` : ""}{d.authority_note ? ` · ${d.authority_note}` : ""}{d.affected_bu_name ? ` · unit: ${d.affected_bu_name}` : ""}
        {d.involved.length ? ` · involved: ${d.involved.filter(Boolean).join(", ")}` : ""}{d.status_reason ? ` · ${d.status_reason}` : ""}
      </p>
      <div className="mt-2 space-y-2">
        <LinkChips links={d.links} onRemove={caps.decisionsCreate && editable && (proposed) ? (l) => void run(() => apiRequest("POST", "okr-links", { ownerType: "DECISION", ownerId: d.id, targetType: l.target_type, targetId: l.target_id, remove: true }), { success: "Link removed." }) : undefined} />
        {caps.decisionsCreate && editable && buId && (proposed || approved) ? <LinkPicker buId={buId} weekId={weekId} exclude={d.links.map((l) => l.target_id)}
          onPick={async (l) => { await run(() => apiRequest("POST", "okr-links", { ownerType: "DECISION", ownerId: d.id, targetType: l.target_type, targetId: l.target_id }), { success: "Linked." }); }} /> : null}
      </div>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {proposed && caps.decisionsApprove ? (
            <>
              <DialogForm label="Approve…" variant="primary" title={`Approve ${d.reference}`} description="Once approved this is a formal decision. To change it later it must be superseded; its history is kept." submitLabel="Approve decision" success="Decision approved."
                canSubmit onOpen={() => setAuthority(d.authority_note ?? "")} onSubmit={() => post("APPROVE", { authorityNote: authority.trim() || undefined })}>
                <TextF id={`aa-${d.id}`} label="Authority (optional)" value={authority} onChange={setAuthority} max={300} />
              </DialogForm>
              <DialogForm label="Reject…" variant="danger" title={`Reject ${d.reference}`} submitLabel="Reject" success="Decision rejected." canSubmit={reason.trim().length > 0} onOpen={() => setReason("")} onSubmit={() => post("REJECT", { reason: reason.trim() })}>
                <TextF id={`rj-${d.id}`} label="Reason" value={reason} onChange={setReason} required max={2000} />
              </DialogForm>
            </>
          ) : null}
          {proposed && caps.decisionsCreate ? (
            <DialogForm label="Amend…" title={`Amend ${d.reference}`} description="The earlier wording is kept in the session timeline." submitLabel="Save amendment" success="Decision amended." canSubmit={reason.trim().length > 0 && title.trim().length > 0 && desc.trim().length > 0}
              onOpen={() => { setTitle(d.title); setDesc(d.description); setReason(""); }}
              onSubmit={() => apiRequest("PATCH", `okr-decisions/${d.id}`, { expectedVersion: d.version, title: title.trim(), description: desc.trim(), reason: reason.trim() })}>
              <TextF id={`at-${d.id}`} label="Decision" value={title} onChange={setTitle} required max={300} />
              <AreaF id={`ad-${d.id}`} label="What was decided" value={desc} onChange={setDesc} required rows={4} max={10000} />
              <TextF id={`ar-${d.id}`} label="Why is it being amended?" value={reason} onChange={setReason} required max={2000} />
            </DialogForm>
          ) : null}
          {approved && caps.decisionsApprove ? (
            <DialogForm label="Supersede…" title={`Supersede ${d.reference}`} description="Records a new approved decision that replaces this one. This one is kept and marked superseded." submitLabel="Supersede" success="Decision superseded." canSubmit={reason.trim().length > 0 && newText.trim().length > 0}
              onOpen={() => { setReason(""); setNewText(d.description); }} onSubmit={() => apiRequest("POST", `okr-decisions/${d.id}/supersede`, { description: newText.trim(), reason: reason.trim(), key: newKey() })}>
              <AreaF id={`sn-${d.id}`} label="The corrected decision" value={newText} onChange={setNewText} required rows={4} max={10000} />
              <TextF id={`sr-${d.id}`} label="Why is it being corrected?" value={reason} onChange={setReason} required max={2000} />
            </DialogForm>
          ) : null}
          {(proposed || approved) && (caps.decisionsApprove || (caps.decisionsCreate && d.created_by === caps.viewerId)) ? (
            <DialogForm label="Withdraw…" variant="ghost" title={`Withdraw ${d.reference}`} submitLabel="Withdraw" success="Decision withdrawn." canSubmit={reason.trim().length > 0} onOpen={() => setReason("")} onSubmit={() => post("WITHDRAW", { reason: reason.trim() })}>
              <TextF id={`wd-${d.id}`} label="Reason" value={reason} onChange={setReason} required max={2000} />
            </DialogForm>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ actions
export function ActionsPanel({ ws, caps, editable, people, outstanding, prefill, clearPrefill }: Common & { outstanding: Outstanding | null }) {
  const s = ws.session;
  const mine = prefill?.kind === "action" ? prefill.note : null;
  const ac: ActionCaps = { assign: caps.actionsAssign, update: caps.actionsUpdate, verify: caps.actionsVerify, viewerId: ws.viewer.id, viewerBuId: caps.buId };
  const [desc, setDesc] = useState(mine ? (mine.title ?? mine.content).slice(0, 500) : "");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [due, setDue] = useState("");
  const [verify, setVerify] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const canWrite = caps.actionsCreate && editable;
  const reviewed = new Map(ws.reviewed_here.filter((r) => r.item_type === "ACTION").map((r) => [r.item_id, r]));

  return (
    <div className="space-y-6">
      {outstanding && (outstanding.actions.length > 0) ? (
        <section aria-labelledby="prev-actions" className="space-y-3">
          <div>
            <h2 id="prev-actions" className="text-base font-semibold text-ink">Commitments from earlier sessions ({outstanding.actions.length})</h2>
            <p className="text-sm text-muted">Review each with the unit. Recording a review keeps the same action (no copy) and notes that it was discussed here.</p>
          </div>
          {outstanding.actions.map((a) => <ReviewRow key={a.id} a={a} ws={ws} reviewed={reviewed.get(a.id)} ac={ac} people={people} canReview={caps.update && editable && (ws.viewer.is_facilitator || ws.viewer.is_creator || caps.finalise)} />)}
        </section>
      ) : null}

      <section aria-labelledby="this-actions" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="this-actions" className="text-base font-semibold text-ink">Action items from this session ({ws.actions.length})</h2>
          {canWrite ? (
            <DialogForm key={mine?.id ?? "new"} label={mine ? "Create action from this note…" : "Create an action…"} variant="primary" size="md" title="Create an action item" description="A commitment with an owner and a due date. The owner is notified." submitLabel="Create action" success="Action created and assigned."
              canSubmit={desc.trim().length > 0 && !!assignee && !!due} onOpen={() => undefined}
              onSubmit={async () => { const r = await apiRequest("POST", `okr-sessions/${s.id}/actions`, { description: desc.trim(), assigneeId: assignee, buId: s.business_unit_id ?? undefined, priority, dueDate: due, sourceNoteId: mine?.id, requiresVerification: verify, evidenceRequired: evidence, clientKey: newKey() }); clearPrefill(); setDesc(""); return r; }}>
              <AreaF id="a-desc" label="What needs to be done" value={desc} onChange={setDesc} required rows={3} max={5000} />
              <PersonF id="a-who" label="Responsible person" people={people} value={assignee} onChange={setAssignee} unit={s.business_unit_id} required />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectF id="a-pri" label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((p) => [p, p.charAt(0) + p.slice(1).toLowerCase()] as const)} />
                <TextF id="a-due" label="Due date" type="date" value={due} onChange={setDue} required />
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> Someone else must verify its completion</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.target.checked)} /> Evidence of completion is required</label>
            </DialogForm>
          ) : null}
        </div>
        {ws.actions.length === 0 ? <Card><EmptyState title="No action items from this session yet" /></Card> : ws.actions.map((a) => <ActionCard key={a.id} a={a} caps={ac} people={people} contextSessionId={s.id} readOnly={s.status === "ARCHIVED"} />)}
      </section>
    </div>
  );
}

function ReviewRow({ a, ws, reviewed, ac, people, canReview }: { a: ActionRow; ws: Workspace; reviewed?: Workspace["reviewed_here"][number]; ac: ActionCaps; people: Person[]; canReview: boolean }) {
  const { run } = useAction();
  const [outcome, setOutcome] = useState<string>("UPDATE_REQUESTED");
  const [remarks, setRemarks] = useState("");
  return (
    <div className="space-y-2">
      <ActionCard a={a} caps={ac} people={people} contextSessionId={ws.session.id} />
      {canReview ? (
        <Card className="flex flex-wrap items-end gap-2 bg-surface p-3">
          {reviewed ? <p className="w-full text-xs text-muted">Reviewed here as “{reviewed.outcome.replace(/_/g, " ").toLowerCase()}” by {reviewed.reviewed_by_name}{reviewed.remarks ? `: ${reviewed.remarks}` : ""}. Recording again updates that review.</p> : null}
          <div className="min-w-[12rem]"><SelectF id={`co-${a.id}`} label="Outcome of today's review" value={outcome} onChange={setOutcome} options={CARRY_OUTCOMES.map((c) => [c.code, c.label] as const)} /></div>
          <div className="min-w-[14rem] flex-1"><TextF id={`cr-${a.id}`} label="Remarks (the explanation given)" value={remarks} onChange={setRemarks} max={3000} /></div>
          <Button size="sm" onClick={() => void run(() => apiRequest("POST", `okr-sessions/${ws.session.id}/carry-forward`, { items: [{ type: "ACTION", id: a.id, outcome, remarks: remarks.trim() || undefined }], key: newKey() }), { success: "Review recorded." })}>Record review</Button>
        </Card>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ risks
export function RisksPanel({ ws, caps, editable, people, outstanding, prefill, clearPrefill }: Common & { outstanding: Outstanding | null }) {
  const s = ws.session;
  const mine = prefill?.kind === "risk" ? prefill.note : null;
  const [kind, setKind] = useState("RISK");
  const [title, setTitle] = useState(mine?.title ?? "");
  const [description, setDescription] = useState(mine?.content ?? "");
  const [category, setCategory] = useState("OPERATIONAL");
  const [severity, setSeverity] = useState("MEDIUM");
  const [impact, setImpact] = useState("");
  const [cause, setCause] = useState("");
  const [mitigation, setMitigation] = useState("");
  const [owner, setOwner] = useState("");
  const [target, setTarget] = useState("");
  const canWrite = caps.risksManage && editable;
  const reviewed = new Map(ws.reviewed_here.filter((r) => r.item_type === "RISK").map((r) => [r.item_id, r]));
  return (
    <div className="space-y-6">
      <Card className="p-4 text-sm text-muted">A risk, blocker or issue here is a <strong className="text-ink">formal record</strong> with an owner and a status. An observation made in discussion stays a note until someone with the authority records it here.</Card>
      {outstanding && outstanding.risks.length > 0 ? (
        <section aria-labelledby="prev-risks" className="space-y-3">
          <h2 id="prev-risks" className="text-base font-semibold text-ink">Open risks from earlier sessions ({outstanding.risks.length})</h2>
          {outstanding.risks.map((r) => <RiskCard key={r.id} r={r} ws={ws} caps={caps} editable={editable} people={people} reviewed={reviewed.get(r.id)} />)}
        </section>
      ) : null}
      <section aria-labelledby="this-risks" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="this-risks" className="text-base font-semibold text-ink">Recorded in this session ({ws.risks.length})</h2>
          {canWrite ? (
            <DialogForm key={mine?.id ?? "new"} label={mine ? "Record this note as a risk…" : "Record a risk or blocker…"} variant="primary" size="md" title="Record a risk, blocker or issue" submitLabel="Record" success="Recorded."
              canSubmit={title.trim().length > 0 && description.trim().length > 0}
              onSubmit={async () => { const r = await apiRequest("POST", `okr-sessions/${s.id}/risks`, { kind, title: title.trim(), description: description.trim(), buId: s.business_unit_id ?? undefined, category, severity, businessImpact: impact.trim() || undefined, rootCause: cause.trim() || undefined, mitigation: mitigation.trim() || undefined, ownerId: owner || undefined, targetDate: target || undefined, sourceNoteId: mine?.id, clientKey: newKey() }); clearPrefill(); setTitle(""); setDescription(""); return r; }}>
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectF id="r-kind" label="Kind" value={kind} onChange={setKind} options={RISK_KINDS.map((k) => [k, k.charAt(0) + k.slice(1).toLowerCase()] as const)} />
                <SelectF id="r-cat" label="Category" value={category} onChange={setCategory} options={RISK_CATEGORIES.map((k) => [k, k.charAt(0) + k.slice(1).toLowerCase()] as const)} />
                <SelectF id="r-sev" label="Severity" value={severity} onChange={setSeverity} options={SEVERITIES.map((k) => [k, k.charAt(0) + k.slice(1).toLowerCase()] as const)} />
              </div>
              <TextF id="r-title" label="Title" value={title} onChange={setTitle} required max={300} />
              <AreaF id="r-desc" label="Description" value={description} onChange={setDescription} required rows={3} max={10000} />
              <AreaF id="r-imp" label="Business impact" value={impact} onChange={setImpact} max={5000} />
              <AreaF id="r-cause" label="Root cause (if known)" value={cause} onChange={setCause} max={5000} />
              <AreaF id="r-mit" label="Mitigation or proposed resolution" value={mitigation} onChange={setMitigation} max={5000} />
              <div className="grid gap-3 sm:grid-cols-2">
                <PersonF id="r-own" label="Responsible person" people={people} value={owner} onChange={setOwner} unit={s.business_unit_id} placeholder="Not assigned yet" />
                <TextF id="r-tgt" label="Target resolution date" type="date" value={target} onChange={setTarget} />
              </div>
            </DialogForm>
          ) : null}
        </div>
        {ws.risks.length === 0 ? <Card><EmptyState title="No risks or blockers recorded in this session" /></Card> : ws.risks.map((r) => <RiskCard key={r.id} r={r} ws={ws} caps={caps} editable={editable} people={people} reviewed={reviewed.get(r.id)} />)}
      </section>
    </div>
  );
}

export function RiskCard({ r, ws, caps, editable, people, reviewed }: { r: RiskRow; ws: Workspace; caps: Caps; editable: boolean; people: Person[]; reviewed?: Workspace["reviewed_here"][number] }) {
  const { run } = useAction();
  const [status, setStatus] = useState<string>(r.status);
  const [sev, setSev] = useState(r.severity);
  const [mit, setMit] = useState(r.mitigation ?? "");
  const [res, setRes] = useState("");
  const [owner, setOwner] = useState(r.owner_id ?? "");
  const [outcome, setOutcome] = useState("STILL_OPEN");
  const [remarks, setRemarks] = useState("");
  const open = r.status === "OPEN" || r.status === "MITIGATING";
  const fromEarlier = r.session_id !== ws.session.id;
  return (
    <Card className="p-4" data-testid="risk-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">{r.reference}</span><Badge tone="brand">{r.kind.charAt(0) + r.kind.slice(1).toLowerCase()}</Badge><SeverityBadge severity={r.severity} /><Badge tone={open ? "info" : "done"}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
        {r.overdue ? <Badge tone="critical">Past target date</Badge> : null}
        {r.raised_in_sessions > 1 ? <Badge tone="warn">Raised in {r.raised_in_sessions} sessions</Badge> : null}
        {r.reviews > 0 ? <Badge tone="info">Reviewed {r.reviews}×</Badge> : null}
      </div>
      <h3 className="mt-1 text-base font-semibold text-ink">{r.title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{r.description}</p>
      {r.business_impact ? <p className="mt-1 text-sm"><span className="text-muted">Impact:</span> {r.business_impact}</p> : null}
      {r.root_cause ? <p className="mt-1 text-sm"><span className="text-muted">Root cause:</span> {r.root_cause}</p> : null}
      {r.mitigation ? <p className="mt-1 text-sm"><span className="text-muted">Mitigation:</span> {r.mitigation}</p> : null}
      {r.resolution_note ? <p className="mt-1 text-sm"><span className="text-muted">Resolution:</span> {r.resolution_note}</p> : null}
      <p className="mt-2 text-xs text-muted">{r.business_unit_name} · {r.category.toLowerCase()} · owner {r.owner_name ?? "not assigned"} · target {dateText(r.target_date)} · recorded in {r.session_reference} by {r.created_by_name ?? "—"}</p>
      <div className="mt-2"><LinkChips links={r.links} /></div>
      {editable && caps.risksManage ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <DialogForm label="Update…" title={`Update ${r.reference}`} description="Each earlier state is kept in the session timeline." submitLabel="Save update" success="Updated." canSubmit={(status === r.status || status !== "RESOLVED" && status !== "CLOSED" || res.trim().length > 0)}
            onOpen={() => { setStatus(r.status); setSev(r.severity); setMit(r.mitigation ?? ""); setRes(""); setOwner(r.owner_id ?? ""); }}
            onSubmit={() => apiRequest("PATCH", `okr-risks/${r.id}`, { expectedVersion: r.version, status: status === r.status ? undefined : status, severity: sev === r.severity ? undefined : sev, mitigation: mit.trim() || undefined, ownerId: owner || undefined, resolutionNote: res.trim() || undefined, contextSessionId: ws.session.id, reason: (r.status === "RESOLVED" || r.status === "CLOSED") && status === "OPEN" ? res.trim() || undefined : undefined })}>
            <SelectF id={`rs-${r.id}`} label="Status" value={status} onChange={setStatus} options={RISK_STATUSES.map((k) => [k, k.charAt(0) + k.slice(1).toLowerCase()] as const)} />
            <SelectF id={`rv-${r.id}`} label="Severity" value={sev} onChange={setSev} options={SEVERITIES.map((k) => [k, k.charAt(0) + k.slice(1).toLowerCase()] as const)} />
            <AreaF id={`rm-${r.id}`} label="Mitigation" value={mit} onChange={setMit} max={5000} />
            <PersonF id={`ro-${r.id}`} label="Owner" people={people} value={owner} onChange={setOwner} unit={r.business_unit_id} placeholder="Not assigned" />
            {status !== r.status && (status === "RESOLVED" || status === "CLOSED" || status === "OPEN") ? <AreaF id={`rr-${r.id}`} label={status === "OPEN" ? "Why is it being reopened?" : "How was it resolved?"} value={res} onChange={setRes} required max={5000} /> : null}
          </DialogForm>
          {fromEarlier && open && ws.session.status !== "ARCHIVED" && (ws.viewer.is_facilitator || ws.viewer.is_creator || caps.finalise) ? (
            <div className="flex flex-wrap items-end gap-2">
              <SelectF id={`ro2-${r.id}`} label="Review in this session" value={outcome} onChange={setOutcome} options={CARRY_OUTCOMES.filter((c) => ["STILL_OPEN", "EXPLAINED", "ESCALATED", "RESOLVED"].includes(c.code)).map((c) => [c.code, c.label] as const)} />
              <TextF id={`rr2-${r.id}`} label="Remarks" value={remarks} onChange={setRemarks} max={3000} />
              <Button size="sm" onClick={() => void run(() => apiRequest("POST", `okr-sessions/${ws.session.id}/carry-forward`, { items: [{ type: "RISK", id: r.id, outcome, remarks: remarks.trim() || undefined }], key: newKey() }), { success: "Review recorded." })}>Record review</Button>
              {reviewed ? <span className="text-xs text-muted">Reviewed here: {reviewed.outcome.replace(/_/g, " ").toLowerCase()}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

