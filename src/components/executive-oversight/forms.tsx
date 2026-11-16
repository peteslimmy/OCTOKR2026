"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Modal, apiRequest, useAction } from "@/components/ui/client";
import { AreaF, SelectF } from "@/components/session-notes/forms";
import type { EoCategory } from "@/lib/executive-oversight/types";
import { newKey } from "./common";
import type { PickedLink } from "./link-picker";

/** What the screen being reviewed already knows. The person never re-types it. */
export interface EoSubject {
  module: string; subjectType: string | null; subjectId: string | null; subjectLabel: string | null; businessUnitId: string | null; quarterId: string | null; reportingWeekId: string | null;
}
export interface Unit { id: string; name: string }

const FORMAT_HINT = "Plain text. **bold**, *italic* and lists starting with - are supported.";

/** A comment: an observation or a question. It starts no response workflow and changes no record. Kept simple: the unit (when the screen does not already know it) and the words. */
export function CommentForm({ subject, units, canOrgWide, onDone }: { subject: EoSubject; units: Unit[]; categories?: EoCategory[]; canOrgWide: boolean; onDone: () => void }) {
  const [bu, setBu] = useState(subject.businessUnitId ?? "");
  const [content, setContent] = useState("");
  const [key, setKey] = useState(newKey);        // one key per deliberate act: a retry after a lost connection is recognised and never posts twice
  const { run, pending } = useAction();
  const unitFixed = !!subject.businessUnitId;
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => apiRequest("POST", "executive-comments", {
        businessUnitId: bu || null, category: null, title: null, content: content.trim(), visibility: bu ? "SHARED" : "MANAGEMENT", module: subject.module,
        subjectType: subject.subjectType, subjectId: subject.subjectId, quarterId: subject.quarterId, reportingWeekId: subject.reportingWeekId,
        links: [], requestKey: key,
      }), { success: "Comment posted." });
      if (r) { setKey(newKey()); setContent(""); onDone(); }
    }}>
      {subject.subjectLabel ? <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">About: <span className="text-ink">{subject.subjectLabel}</span></p> : null}
      {!unitFixed ? (
        <SelectF id="eo-c-bu" label="Business unit" value={bu} onChange={setBu} required={!canOrgWide} placeholder={canOrgWide ? "Organisation-wide (management only)" : "Choose a unit"} options={units.map((u) => [u.id, u.name] as const)} />
      ) : null}
      <AreaF id="eo-c-body" label="Your comment" value={content} onChange={setContent} rows={4} required max={10000} hint={FORMAT_HINT} />
      <p className="text-xs text-muted">A comment is not a recommendation: it asks for no formal response and changes no goal, task, score or report.</p>
      <div className="flex justify-end"><Button type="submit" disabled={pending || !content.trim() || (!bu && !canOrgWide)}>{pending ? "Posting…" : "Post comment"}</Button></div>
    </form>
  );
}

export interface DraftInit {
  id: string; version: number; title: string; detail: string; background: string | null; reason: string | null; expected_outcome: string | null; proposed_direction: string | null; priority: string; category_code: string | null;
  module: string; response_requested: boolean; response_due: string | null; recommended_owner_role: string | null; recommended_owner_user: string | null; targets: string[]; links: PickedLink[];
}

/** The title is made from the first line of the recommendation (the form no longer asks for one). */
export const titleFromDetail = (detail: string): string => {
  const line = detail.trim().split(/\r?\n/)[0].replace(/\s+/g, " ");
  if (!line) return "Recommendation";
  if (line.length <= 80) return line;
  const cut = line.slice(0, 80);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}…`;
};

/**
 * A formal recommendation: advice addressed to one or more units, each of which answers separately. It is not an instruction and changes no record.
 * The form asks only who it is for and what is recommended (and the outcome expected). Priority, category, module, owner, response and links keep their
 * defaults for a new recommendation; an existing draft keeps whatever it already holds.
 */
export function RecommendationDialog({ subject, units, open, onOpenChange, draft, onDone }: {
  subject: EoSubject; units: Unit[]; categories?: EoCategory[]; open: boolean; onOpenChange: (o: boolean) => void; draft?: DraftInit; onDone: (id: string) => void;
}) {
  const [detail, setDetail] = useState(draft?.detail ?? "");
  const [outcome, setOutcome] = useState(draft?.expected_outcome ?? "");
  const [targets, setTargets] = useState<string[]>(draft?.targets ?? (subject.businessUnitId ? [subject.businessUnitId] : []));
  const [key, setKey] = useState(newKey);
  const { run, pending } = useAction();

  const body = (publish: boolean) => ({
    title: draft?.title?.trim() || titleFromDetail(detail), detail: detail.trim(), background: draft?.background ?? null, reason: draft?.reason ?? null, expectedOutcome: outcome.trim() || null, proposedDirection: draft?.proposed_direction ?? null,
    priority: draft?.priority ?? "NORMAL", category: draft?.category_code ?? null, module: draft?.module ?? subject.module, subjectType: subject.subjectType, subjectId: subject.subjectId, quarterId: subject.quarterId, reportingWeekId: subject.reportingWeekId,
    recommendedOwnerRole: draft?.recommended_owner_role ?? null, recommendedOwnerUser: draft?.recommended_owner_user ?? null, responseRequested: draft?.response_requested ?? true, responseDue: draft?.response_due ?? null, targets,
    links: (draft?.links ?? []).map((l: PickedLink) => ({ target_type: l.target_type, target_id: l.target_id })), publish, ...(draft ? { expectedVersion: draft.version } : { requestKey: key }),
  });
  const save = async (publish: boolean) => {
    const r = await run(() => (draft ? apiRequest<{ id: string }>("PATCH", `executive-recommendations/${draft.id}`, body(publish)) : apiRequest<{ id: string }>("POST", "executive-recommendations", body(publish))),
      { success: publish ? "Recommendation issued." : "Draft saved." });
    if (r) { setKey(newKey()); onOpenChange(false); onDone(r.value.id); }
  };
  const ready = detail.trim() && targets.length > 0;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={draft ? "Edit draft recommendation" : "Make a recommendation"} description="Advice to the business units you choose. They accept, partly accept or decline it with a reason; it changes nothing in their records.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        {subject.subjectLabel ? <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">About: <span className="text-ink">{subject.subjectLabel}</span></p> : null}
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-ink">Addressed to <span className="text-[var(--critical-fg)]">*</span></legend>
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
            {units.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={targets.includes(u.id)} onChange={(e) => setTargets(e.target.checked ? [...targets, u.id] : targets.filter((t) => t !== u.id))} />{u.name}</label>
            ))}
          </div>
          <p className="text-xs text-muted">Each unit has its own acknowledgement and response.</p>
        </fieldset>
        <AreaF id="eo-r-detail" label="Recommendation" value={detail} onChange={setDetail} rows={5} required max={10000} hint={FORMAT_HINT} />
        <AreaF id="eo-r-out" label="Expected outcome" value={outcome} onChange={setOutcome} rows={2} max={5000} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" type="submit" disabled={pending || !ready}>Save as draft</Button>
          <Button disabled={pending || !ready} onClick={() => void save(true)}>{pending ? "Working…" : "Issue recommendation"}</Button>
        </div>
      </form>
    </Modal>
  );
}
