"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import type { AccessReviews, ReviewItem } from "@/lib/data/access";

const dText = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(new Date(iso)) : "—");

/** Limit this person's hands-on work (violations, a person's attendance) to chosen units. No units chosen means no limit. */
export function ScopeForm({ userId, units, current }: { userId: string; units: { id: string; name: string }[]; current: string[] }) {
  const { run, pending } = useAction();
  const [chosen, setChosen] = useState<string[]>(current);
  const [reason, setReason] = useState("");
  const same = chosen.length === current.length && chosen.every((c) => current.includes(c));
  return (
    <form className="space-y-3 px-6 py-4" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => apiRequest("PUT", `users/${userId}/unit-scope`, { unitIds: chosen, reason }), { success: chosen.length ? "Unit scope saved." : "Limit removed." });
      if (ok) setReason("");
    }}>
      <p className="text-sm text-muted">{current.length ? `Limited to ${current.length} ${current.length === 1 ? "unit" : "units"}.` : "Not limited: this person can act for every unit."} Tick the units this person may act for, or clear them all to remove the limit.</p>
      <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2" aria-label="Units">
        {units.map((u) => (
          <li key={u.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chosen.includes(u.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, u.id] : chosen.filter((x) => x !== u.id))} />{u.name}</label></li>
        ))}
      </ul>
      <Field id="scope-reason" label="Reason" hint="Recorded in the audit trail."><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
      <div className="flex justify-end gap-2">
        {chosen.length ? <Button type="button" variant="ghost" onClick={() => setChosen([])}>Clear all</Button> : null}
        <Button type="submit" disabled={pending || same || !reason.trim()}>Save scope</Button>
      </div>
    </form>
  );
}

/** The access review: set the schedule, open a review, decide for every person, sign it off. */
export function ReviewPanel({ data, me }: { data: AccessReviews; me: string }) {
  const { run, pending } = useAction();
  const [months, setMonths] = useState(String(data.settings.months));
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [note, setNote] = useState<Record<string, string>>({});
  const [attestation, setAttestation] = useState("");
  const open = data.open;
  const decided = open ? open.items.filter((i) => i.decision).length : 0;
  const todo = open ? open.items.filter((i) => !i.decision && i.userId !== me).length : 0;
  const decide = (i: ReviewItem, decision: "KEEP" | "CHANGE") =>
    run(() => apiRequest("POST", `access-reviews/${open!.review.id}/decide`, { userId: i.userId, decision, comment: note[i.userId] || undefined }), { success: decision === "KEEP" ? "Marked as right." : "Marked for change." });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 px-6 py-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Open a review automatically</label>
        <Field id="rev-months" label="Every"><Select value={months} onChange={(e) => setMonths(e.target.value)}>{[1, 2, 3, 4, 6, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? "month" : "months"}</option>)}</Select></Field>
        <Button size="sm" variant="secondary" disabled={pending || (enabled === data.settings.enabled && Number(months) === data.settings.months)}
          onClick={() => run(() => apiRequest("PUT", "access-reviews/schedule", { enabled, months: Number(months) }), { success: "Schedule saved." })}>Save schedule</Button>
        {!open ? <Button size="sm" disabled={pending} onClick={() => run(() => apiRequest("POST", "access-reviews", {}), { success: "Review opened." })}>Start a review now</Button> : null}
      </div>

      {open ? (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
            <p><span className="font-medium">{open.review.label}</span> <span className="text-muted">· due {dText(open.review.dueAt)} · {decided} of {open.items.length} decided{todo ? `, ${todo} to go` : ""}</span></p>
          </div>
          <ul className="divide-y divide-line">
            {open.items.map((i) => (
              <li key={i.userId} className="space-y-2 px-6 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{i.snapshot.name} <span className="text-xs font-normal text-muted">{i.snapshot.email}{i.snapshot.unit ? ` · ${i.snapshot.unit}` : ""}</span></p>
                    <p className="text-xs text-muted">{i.snapshot.roles.join(", ")} · {i.snapshot.permissions} permissions{i.snapshot.critical ? ` (${i.snapshot.critical} critical)` : ""}{i.snapshot.grants.length ? ` · ${i.snapshot.grants.length} direct ${i.snapshot.grants.length === 1 ? "grant" : "grants"}` : ""}{i.snapshot.units ? ` · limited to ${i.snapshot.units} units` : ""} · last sign-in {dText(i.snapshot.last_login_at)}</p>
                  </div>
                  {i.userId === me ? <span className="text-xs text-muted">Your own access is not reviewed by you</span> : i.decision ? (
                    <span className="text-xs"><strong>{i.decision === "KEEP" ? "Right as it is" : "Needs a change"}</strong>{i.comment ? ` · ${i.comment}` : ""}</span>
                  ) : null}
                </div>
                {i.userId !== me ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input aria-label={`Note for ${i.snapshot.name}`} placeholder="Note (needed if a change is required)" value={note[i.userId] ?? ""} onChange={(e) => setNote({ ...note, [i.userId]: e.target.value })} className="max-w-sm" maxLength={2000} />
                    <Button size="sm" variant={i.decision === "KEEP" ? "primary" : "secondary"} disabled={pending} onClick={() => decide(i, "KEEP")}>Right as it is</Button>
                    <Button size="sm" variant={i.decision === "CHANGE" ? "danger" : "secondary"} disabled={pending || !(note[i.userId] ?? "").trim()} onClick={() => decide(i, "CHANGE")}>Needs a change</Button>
                    <a href={`/admin/access/${i.userId}`} className="text-xs text-brand-700 underline">See their access</a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <form className="space-y-2 border-t border-line px-6 py-4" onSubmit={async (e) => { e.preventDefault(); await run(() => apiRequest("POST", `access-reviews/${open.review.id}/sign-off`, { attestation }), { success: "Review signed off." }); }}>
            <Field id="rev-attest" label="Sign-off statement" hint="For example: I reviewed every person's roles, grants and unit limits and recorded a decision for each."><Input value={attestation} onChange={(e) => setAttestation(e.target.value)} maxLength={2000} /></Field>
            <div className="flex justify-end"><Button type="submit" disabled={pending || todo > 0 || attestation.trim().length < 10}>{todo ? `${todo} people still need a decision` : "Sign off the review"}</Button></div>
          </form>
        </div>
      ) : null}

      {data.reviews.filter((r) => r.status === "SIGNED_OFF").length ? (
        <div className="border-t border-line px-6 py-3">
          <h3 className="mb-1 text-sm font-semibold">Signed-off reviews</h3>
          <ul className="space-y-1 text-sm">{data.reviews.filter((r) => r.status === "SIGNED_OFF").map((r) => (
            <li key={r.id}><span className="font-medium">{r.label}</span> <span className="text-muted">· signed off {dText(r.signedOffAt)} by {r.signedOffBy ?? "unknown"} · {r.summary ? `${r.summary.people} people: ${r.summary.keep} right, ${r.summary.change} to change` : ""}</span>{r.attestation ? <span className="block text-xs text-muted">“{r.attestation}”</span> : null}</li>
          ))}</ul>
        </div>
      ) : null}
    </div>
  );
}
