"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";

const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm";
const primary = "rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const secondary = "rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-50";

/** The unit's answer to a case. It is recorded as written, and stops further escalation. */
export function RespondForm({ caseId }: { caseId: string }) {
  const { run, pending } = useAction();
  const [text, setText] = useState("");
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => apiRequest("POST", `ai/cases/${caseId}/respond`, { text: text.trim() }), { success: "Your response was recorded." }); if (r) setText(""); }}>
      <label className="block text-sm font-medium" htmlFor="case-response">Your unit&apos;s response</label>
      <textarea id="case-response" className={field} rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What is happening, what has been done, and what is needed." />
      <button type="submit" disabled={pending || !text.trim()} className={primary}>Send response</button>
    </form>
  );
}

const STATUSES: [string, string][] = [["UNDER_INVESTIGATION", "Under investigation"], ["AWAITING_RESPONSE", "Awaiting response"], ["INTERVENTION_REQUIRED", "Intervention required"], ["CORRECTIVE_ACTION_IN_PROGRESS", "Corrective action in progress"], ["ESCALATED", "Escalated"], ["RESOLVED", "Resolved"], ["CLOSED", "Closed"]];
/** A case manager moves a case along, adds a note, resolves it with a written resolution, or closes it. */
export function ManageForm({ caseId, current }: { caseId: string; current: string }) {
  const { run, pending } = useAction();
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const needsNote = status === "RESOLVED";
  return (
    <div className="space-y-3">
      <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => apiRequest("POST", `ai/cases/${caseId}/status`, { status, note: note.trim() || undefined }), { success: "Case updated." }); if (r) { setStatus(""); setNote(""); } }}>
        <label className="block text-sm font-medium" htmlFor="case-status">Move the case to</label>
        <select id="case-status" className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Choose a status…</option>{STATUSES.filter(([v]) => v !== current && (v !== "CLOSED" || current === "RESOLVED")).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="sr-only" htmlFor="case-note">Note</label>
        <textarea id="case-note" className={field} rows={3} maxLength={8000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={needsNote ? "How was it resolved? (required)" : "A note for the timeline (optional)"} />
        <button type="submit" disabled={pending || !status || (needsNote && !note.trim())} className={primary}>Update case</button>
      </form>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => apiRequest("POST", `ai/cases/${caseId}/note`, { note: note.trim() }), { success: "Note added." }); if (r) setNote(""); }}>
        <button type="submit" disabled={pending || !note.trim() || !!status} className={secondary}>Add the text above as a note only</button>
      </form>
    </div>
  );
}

/** Adds an action to a plan that is still a draft (or in progress). */
export function AddActionForm({ planId, ownerBuId }: { planId: string; ownerBuId: string | null }) {
  const { run, pending } = useAction();
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  return (
    <form className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => apiRequest("POST", `ai/plans/${planId}/actions`, { description: description.trim(), ...(ownerBuId ? { ownerBuId } : {}), ...(due ? { dueDate: due } : {}) }), { success: "Action added." }); if (r) { setDescription(""); setDue(""); } }}>
      <label className="sr-only" htmlFor={`act-${planId}`}>New action</label>
      <input id={`act-${planId}`} className={field} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="A specific action for the unit, with who and what" />
      <label className="sr-only" htmlFor={`due-${planId}`}>Due date</label>
      <input id={`due-${planId}`} type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} />
      <button type="submit" disabled={pending || !description.trim()} className={primary}>Add</button>
    </form>
  );
}

export function SubmitPlanButton({ planId }: { planId: string }) {
  const { run, pending } = useAction();
  return <button type="button" disabled={pending} className={primary} onClick={() => run(() => apiRequest("POST", `ai/plans/${planId}/submit`), { success: "Sent for approval." })}>Send for approval</button>;
}

/** The owning unit marks an action done or blocked. */
export function ActionStatusButtons({ actionId, status }: { actionId: string; status: string }) {
  const { run, pending } = useAction();
  const [blocked, setBlocked] = useState(false);
  const [note, setNote] = useState("");
  if (status === "DONE") return <span className="text-xs text-muted">Done</span>;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <button type="button" disabled={pending} className={secondary} onClick={() => run(() => apiRequest("POST", `ai/actions/${actionId}/status`, { status: "DONE" }), { success: "Marked done." })}>Mark done</button>
        <button type="button" disabled={pending} className={secondary} onClick={() => setBlocked((b) => !b)}>{blocked ? "Cancel" : "Blocked"}</button>
      </div>
      {blocked ? (
        <div className="flex gap-2">
          <label className="sr-only" htmlFor={`b-${actionId}`}>What is blocking it</label>
          <input id={`b-${actionId}`} className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is blocking it?" maxLength={2000} />
          <button type="button" disabled={pending || !note.trim()} className={secondary} onClick={async () => { const r = await run(() => apiRequest("POST", `ai/actions/${actionId}/status`, { status: "BLOCKED", note: note.trim() }), { success: "Marked blocked." }); if (r) { setBlocked(false); setNote(""); } }}>Save</button>
        </div>
      ) : null}
    </div>
  );
}
