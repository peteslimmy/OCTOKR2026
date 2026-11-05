"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Modal, apiRequest, useAction } from "@/components/ui/client";
import { AreaF, SelectF, TextF } from "@/components/session-notes/forms";
import { MODULES, PRIORITIES, priorityLabel } from "@/lib/executive-oversight/constants";
import type { EoCategory, EoPerson } from "@/lib/executive-oversight/types";
import { newKey } from "./common";
import { LinkPicker, PickedChips, type PickedLink } from "./link-picker";

/** What the screen being reviewed already knows. The person never re-types it. */
export interface EoSubject {
  module: string; subjectType: string | null; subjectId: string | null; subjectLabel: string | null; businessUnitId: string | null; quarterId: string | null; reportingWeekId: string | null;
}
export interface Unit { id: string; name: string }

const FORMAT_HINT = "Plain text. **bold**, *italic* and lists starting with - are supported.";

/** A comment: an observation or a question. It starts no response workflow and changes no record. A category is optional. */
export function CommentForm({ subject, units, categories, canOrgWide, onDone }: { subject: EoSubject; units: Unit[]; categories: EoCategory[]; canOrgWide: boolean; onDone: () => void }) {
  const [bu, setBu] = useState(subject.businessUnitId ?? "");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("SHARED");
  const [links, setLinks] = useState<PickedLink[]>([]);
  const [key, setKey] = useState(newKey);        // one key per deliberate act: a retry after a lost connection is recognised and never posts twice
  const { run, pending } = useAction();
  const unitFixed = !!subject.businessUnitId;
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => apiRequest("POST", "executive-comments", {
        businessUnitId: bu || null, category: category || null, title: title.trim() || null, content: content.trim(), visibility: bu ? visibility : "MANAGEMENT", module: subject.module,
        subjectType: subject.subjectType, subjectId: subject.subjectId, quarterId: subject.quarterId, reportingWeekId: subject.reportingWeekId,
        links: links.map((l) => ({ target_type: l.target_type, target_id: l.target_id })), requestKey: key,
      }), { success: "Comment posted." });
      if (r) { setKey(newKey()); setContent(""); setTitle(""); setLinks([]); setCategory(""); onDone(); }
    }}>
      {subject.subjectLabel ? <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">About: <span className="text-ink">{subject.subjectLabel}</span></p> : null}
      {!unitFixed ? (
        <SelectF id="eo-c-bu" label="Business unit" value={bu} onChange={setBu} required={!canOrgWide} placeholder={canOrgWide ? "Organisation-wide (management only)" : "Choose a unit"} options={units.map((u) => [u.id, u.name] as const)} />
      ) : null}
      <SelectF id="eo-c-cat" label="Category (optional)" value={category} onChange={setCategory} placeholder="No category — a simple comment" options={categories.filter((c) => c.active).map((c) => [c.code, c.name] as const)} />
      <TextF id="eo-c-title" label="Title (optional)" value={title} onChange={setTitle} max={200} />
      <AreaF id="eo-c-body" label="Your comment" value={content} onChange={setContent} rows={4} required max={10000} hint={FORMAT_HINT} />
      {bu ? (
        <SelectF id="eo-c-vis" label="Who can read it" value={visibility} onChange={setVisibility} options={[["SHARED", "The business unit and management"], ["MANAGEMENT", "Management only"]]} />
      ) : null}
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">Link related records (optional)</p>
        <PickedChips links={links} onRemove={(l) => setLinks(links.filter((x) => x.target_id !== l.target_id))} />
        <LinkPicker buId={bu || null} weekId={subject.reportingWeekId} exclude={links.map((l) => l.target_id)} onPick={(l) => setLinks([...links, l])} />
      </div>
      <p className="text-xs text-muted">A comment is not a recommendation: it asks for no formal response and changes no goal, task, score or report.</p>
      <div className="flex justify-end"><Button type="submit" disabled={pending || !content.trim() || (!bu && !canOrgWide)}>{pending ? "Posting…" : "Post comment"}</Button></div>
    </form>
  );
}

export interface DraftInit {
  id: string; version: number; title: string; detail: string; background: string | null; reason: string | null; expected_outcome: string | null; proposed_direction: string | null; priority: string; category_code: string | null;
  module: string; response_requested: boolean; response_due: string | null; recommended_owner_role: string | null; recommended_owner_user: string | null; targets: string[]; links: PickedLink[];
}

/** A formal recommendation: advice addressed to one or more units, each of which answers separately. It is not an instruction and changes no record. */
export function RecommendationDialog({ subject, units, categories, open, onOpenChange, draft, onDone }: {
  subject: EoSubject; units: Unit[]; categories: EoCategory[]; open: boolean; onOpenChange: (o: boolean) => void; draft?: DraftInit; onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState(draft?.title ?? "");
  const [detail, setDetail] = useState(draft?.detail ?? "");
  const [background, setBackground] = useState(draft?.background ?? "");
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [outcome, setOutcome] = useState(draft?.expected_outcome ?? "");
  const [direction, setDirection] = useState(draft?.proposed_direction ?? "");
  const [priority, setPriority] = useState(draft?.priority ?? "NORMAL");
  const [category, setCategory] = useState(draft?.category_code ?? "");
  const [module, setModule] = useState(draft?.module ?? subject.module);
  const [targets, setTargets] = useState<string[]>(draft?.targets ?? (subject.businessUnitId ? [subject.businessUnitId] : []));
  const [ownerRole, setOwnerRole] = useState(draft?.recommended_owner_role ?? "");
  const [ownerUser, setOwnerUser] = useState(draft?.recommended_owner_user ?? "");
  const [requested, setRequested] = useState(draft?.response_requested ?? true);
  const [due, setDue] = useState(draft?.response_due ?? "");
  const [links, setLinks] = useState<PickedLink[]>(draft?.links ?? []);
  const [people, setPeople] = useState<(EoPerson & { unit: string })[]>([]);
  const [key, setKey] = useState(newKey);
  const { run, pending } = useAction();

  useEffect(() => {
    let live = true;
    Promise.all(targets.map((t) => apiRequest<EoPerson[]>("GET", `executive-oversight/people?bu=${t}`).then((p) => p.map((x) => ({ ...x, unit: units.find((u) => u.id === t)?.name ?? "" })), () => [] as (EoPerson & { unit: string })[])))
      .then((lists) => live && setPeople(lists.flat()));
    return () => { live = false; };
  }, [targets, units]);

  const body = (publish: boolean) => ({
    title: title.trim(), detail: detail.trim(), background: background.trim() || null, reason: reason.trim() || null, expectedOutcome: outcome.trim() || null, proposedDirection: direction.trim() || null, priority,
    category: category || null, module, subjectType: subject.subjectType, subjectId: subject.subjectId, quarterId: subject.quarterId, reportingWeekId: subject.reportingWeekId,
    recommendedOwnerRole: ownerRole.trim() || null, recommendedOwnerUser: ownerUser || null, responseRequested: requested, responseDue: requested && due ? due : null, targets,
    links: links.map((l) => ({ target_type: l.target_type, target_id: l.target_id })), publish, ...(draft ? { expectedVersion: draft.version } : { requestKey: key }),
  });
  const save = async (publish: boolean) => {
    const r = await run(() => (draft ? apiRequest<{ id: string }>("PATCH", `executive-recommendations/${draft.id}`, body(publish)) : apiRequest<{ id: string }>("POST", "executive-recommendations", body(publish))),
      { success: publish ? "Recommendation issued." : "Draft saved." });
    if (r) { setKey(newKey()); onOpenChange(false); onDone(r.value.id); }
  };
  const ready = title.trim() && detail.trim() && targets.length > 0;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={draft ? "Edit draft recommendation" : "Make a recommendation"} description="Advice to the business units you choose. They accept, partly accept or decline it with a reason; it changes nothing in their records.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        {subject.subjectLabel ? <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">About: <span className="text-ink">{subject.subjectLabel}</span></p> : null}
        <TextF id="eo-r-title" label="Title" value={title} onChange={setTitle} required max={200} />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-ink">Addressed to <span className="text-[var(--critical-fg)]">*</span></legend>
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
            {units.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={targets.includes(u.id)} onChange={(e) => setTargets(e.target.checked ? [...targets, u.id] : targets.filter((t) => t !== u.id))} />{u.name}</label>
            ))}
          </div>
          <p className="text-xs text-muted">Each unit has its own acknowledgement and response.</p>
        </fieldset>
        <AreaF id="eo-r-detail" label="Recommendation" value={detail} onChange={setDetail} rows={4} required max={10000} hint={FORMAT_HINT} />
        <AreaF id="eo-r-bg" label="Background or observation" value={background} onChange={setBackground} rows={2} max={10000} />
        <AreaF id="eo-r-why" label="Why you recommend it" value={reason} onChange={setReason} rows={2} max={10000} hint="Needed to issue it." />
        <AreaF id="eo-r-out" label="Expected outcome" value={outcome} onChange={setOutcome} rows={2} max={5000} />
        <AreaF id="eo-r-dir" label="Suggested improvement direction" value={direction} onChange={setDirection} rows={2} max={5000} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectF id="eo-r-pri" label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((p) => [p, priorityLabel[p]] as const)} hint="Affects sorting and notification urgency only." />
          <SelectF id="eo-r-cat" label="Category" value={category} onChange={setCategory} placeholder="None" options={categories.filter((c) => c.active).map((c) => [c.code, c.name] as const)} />
          <SelectF id="eo-r-mod" label="Affected module" value={module} onChange={setModule} options={MODULES} />
          <TextF id="eo-r-role" label="Suggested responsible role" value={ownerRole} onChange={setOwnerRole} max={100} placeholder="e.g. Finance manager" />
        </div>
        <SelectF id="eo-r-person" label="Suggested responsible person (optional)" value={ownerUser} onChange={setOwnerUser} placeholder="The unit decides" options={people.map((p) => [p.id, `${p.name} — ${p.unit}`] as const)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requested} onChange={(e) => setRequested(e.target.checked)} /> A response is requested</label>
        {requested ? <Field id="eo-r-due" label="Respond by (optional)" hint="After this date the response shows as overdue and the configured reminders start. It has no compliance consequence."><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field> : null}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink">Link related records (optional)</p>
          <PickedChips links={links} onRemove={(l) => setLinks(links.filter((x) => x.target_id !== l.target_id))} />
          <LinkPicker buId={targets[0] ?? null} weekId={subject.reportingWeekId} exclude={links.map((l) => l.target_id)} onPick={(l) => setLinks([...links, l])} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" type="submit" disabled={pending || !ready}>Save as draft</Button>
          <Button disabled={pending || !ready || !reason.trim()} onClick={() => void save(true)}>{pending ? "Working…" : "Issue recommendation"}</Button>
        </div>
      </form>
    </Modal>
  );
}
