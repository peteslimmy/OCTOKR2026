"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Field, Input, NativeSelect, Select } from "@/components/ui/primitives";
import { contentLockPhrase, finalLockPhrase, openPhrase, WEEKDAYS, type LockSchedule } from "@/lib/domain/schedule";

const hhmm = (t: string) => t.slice(0, 5);
type Version = LockSchedule & { id: string; reason: string | null; created_at: string };

/** When reports lock and finalise. A change is a request a different person approves, and it applies only to weeks not yet generated. */
export function LockScheduleForm({ active, history, firstAffected, canChange, reapplicable = 0 }: { active: Version; history: Version[]; firstAffected: string | null; canChange: boolean; reapplicable?: number }) {
  const [f, setF] = useState({
    oDay: String(active.open_dow ?? 1), oTime: hhmm(active.open_time ?? "00:00"), oOff: String(active.open_week_offset ?? 0),
    cDay: String(active.content_lock_dow), cTime: hhmm(active.content_lock_time), cOff: String(active.content_lock_week_offset),
    fDay: String(active.final_lock_dow), fTime: hhmm(active.final_lock_time), fOff: String(active.final_lock_week_offset), reason: "",
  });
  const { run, pending } = useAction();
  const changed = f.oDay !== String(active.open_dow ?? 1) || f.oTime !== hhmm(active.open_time ?? "00:00") || f.oOff !== String(active.open_week_offset ?? 0)
    || f.cDay !== String(active.content_lock_dow) || f.cTime !== hhmm(active.content_lock_time) || f.cOff !== String(active.content_lock_week_offset)
    || f.fDay !== String(active.final_lock_dow) || f.fTime !== hhmm(active.final_lock_time) || f.fOff !== String(active.final_lock_week_offset);
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(f.oTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(f.cTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(f.fTime);
  const when = firstAffected ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Africa/Lagos" }).format(new Date(`${firstAffected}T12:00:00Z`)) : null;
  const dayOptions = WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>);
  const openOffsetOptions = [-1, 0, 1].map((n) => <option key={n} value={n}>{n === -1 ? "In the week before" : n === 0 ? "In the week itself" : "The week after"}</option>);
  const offsetOptions = [0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? "In the week itself" : n === 1 ? "The week after" : `${n} weeks after`}</option>);
  return (
    <div className="space-y-4 px-6 py-4 text-sm">
      <dl className="grid gap-2 sm:grid-cols-3">
        <div><dt className="text-muted">Reporting opens</dt><dd className="font-medium">{openPhrase(active)} WAT</dd></div>
        <div><dt className="text-muted">Goals and tasks lock (content lock)</dt><dd className="font-medium">{contentLockPhrase(active)} WAT</dd></div>
        <div><dt className="text-muted">The week is scored (final lock)</dt><dd className="font-medium">{finalLockPhrase(active)} WAT</dd></div>
      </dl>
      <p className="text-muted">Version {active.version}. Weeks start on Monday 00:00 in Africa/Lagos; that cannot be changed, but reporting can open before or after it. {when
        ? `A change applies to weeks generated from ${when} onward; weeks already generated keep the times they have.`
        : "A change applies to weeks generated after it is approved, that is from the next quarter you activate."}</p>
      {canChange ? (
        <form className="space-y-3 border-t border-line pt-4" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => apiRequest("POST", "config-changes", { topic: "LOCK_SCHEDULE", target: null, reason: f.reason, idempotencyKey: crypto.randomUUID(),
            proposed: { openDay: Number(f.oDay), openTime: f.oTime, openWeekOffset: Number(f.oOff), contentLockDay: Number(f.cDay), contentLockTime: f.cTime, contentLockWeekOffset: Number(f.cOff), finalLockDay: Number(f.fDay), finalLockTime: f.fTime, finalLockWeekOffset: Number(f.fOff) } }),
            { success: "Sent for approval. A different Admin or Super Admin must approve the new lock times." });
          if (ok) setF({ ...f, reason: "" });
        }}>
          <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-1 font-medium">Reporting opens</legend>
            <Field id="ls-oday" label="Day"><Select value={f.oDay} onChange={(e) => setF({ ...f, oDay: e.target.value })}>{dayOptions}</Select></Field>
            <Field id="ls-otime" label="Time (HH:MM)"><Input value={f.oTime} onChange={(e) => setF({ ...f, oTime: e.target.value })} inputMode="numeric" maxLength={5} /></Field>
            <Field id="ls-ooff" label="Which week"><Select value={f.oOff} onChange={(e) => setF({ ...f, oOff: e.target.value })}>{openOffsetOptions}</Select></Field>
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-1 font-medium">Content lock</legend>
            <Field id="ls-cday" label="Day"><Select value={f.cDay} onChange={(e) => setF({ ...f, cDay: e.target.value })}>{dayOptions}</Select></Field>
            <Field id="ls-ctime" label="Time (HH:MM)"><Input value={f.cTime} onChange={(e) => setF({ ...f, cTime: e.target.value })} inputMode="numeric" maxLength={5} /></Field>
            <Field id="ls-coff" label="Which week"><Select value={f.cOff} onChange={(e) => setF({ ...f, cOff: e.target.value })}>{offsetOptions}</Select></Field>
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-1 font-medium">Final lock</legend>
            <Field id="ls-fday" label="Day"><Select value={f.fDay} onChange={(e) => setF({ ...f, fDay: e.target.value })}>{dayOptions}</Select></Field>
            <Field id="ls-ftime" label="Time (HH:MM)"><Input value={f.fTime} onChange={(e) => setF({ ...f, fTime: e.target.value })} inputMode="numeric" maxLength={5} /></Field>
            <Field id="ls-foff" label="Which week"><Select value={f.fOff} onChange={(e) => setF({ ...f, fOff: e.target.value })}>{offsetOptions}</Select></Field>
          </fieldset>
          <Field id="ls-reason" label="Reason for the approver"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={2000} /></Field>
          {!timeOk ? <p role="alert" className="text-[var(--critical-fg)]">Enter times as HH:MM, for example 18:00.</p> : null}
          <Button type="submit" disabled={pending || !changed || !timeOk || f.reason.trim() === ""}>Send for approval</Button>
        </form>
      ) : null}
      {canChange ? <ReapplyPolicy count={reapplicable} /> : null}
      {history.length > 1 ? (
        <details className="border-t border-line pt-3"><summary className="cursor-pointer font-medium">History ({history.length} versions)</summary>
          <ul className="mt-2 space-y-1 text-muted" aria-label="Lock schedule history">
            {history.map((v) => (
              <li key={v.id}><Badge tone={v.version === active.version ? "done" : "undefined"}>v{v.version}</Badge> opens {openPhrase(v)}, content lock {contentLockPhrase(v)}, final lock {finalLockPhrase(v)}{v.reason ? ` — ${v.reason}` : ""}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Bring weeks that already exist (and have not final-locked) onto the policy now in force. */
function ReapplyPolicy({ count }: { count: number }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3">
      <p>{count > 0 ? `${count} existing ${count === 1 ? "week is" : "weeks are"} still on an older policy.` : "Every open or upcoming week is already on the policy in force."}</p>
      <Button size="sm" variant="secondary" disabled={count === 0} onClick={() => setOpen(true)}>Apply to existing weeks</Button>
      <Modal open={open} onOpenChange={setOpen} title="Apply the current policy to existing weeks?"
        description={`The opening time, content lock and final lock of ${count} week(s) that have not final-locked will move to the policy now in force. Weeks with suspended locks and weeks that have final-locked are left alone. If a new lock time has already passed, that week locks at the next scheduled run.`}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => apiRequest("POST", "lock-schedule/apply", { reason }), { success: "The current policy now applies to the existing weeks." });
          if (ok) { setOpen(false); setReason(""); }
        }}>
          <Field id="reapply-reason" label="Reason" hint="Recorded in the audit trail."><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !reason.trim()}>Apply</Button></div>
        </form>
      </Modal>
    </div>
  );
}
