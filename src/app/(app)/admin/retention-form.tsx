"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Button, Field, Input } from "@/components/ui/primitives";

/** How long read notifications and finished emails are kept. A change is a request a different person approves. */
export function RetentionForm({ current }: { current: { enabled: boolean; months: number; days: number } }) {
  const [f, setF] = useState({ enabled: current.enabled, months: String(current.months), days: String(current.days), reason: "" });
  const { run, pending } = useAction();
  const months = Number(f.months); const days = Number(f.days);
  const valid = Number.isInteger(months) && months >= 3 && months <= 120 && Number.isInteger(days) && days >= 7 && days <= 730;
  const changed = f.enabled !== current.enabled || months !== current.months || days !== current.days;
  return (
    <form className="space-y-3 px-6 py-4 text-sm" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => apiRequest("POST", "config-changes", { topic: "RETENTION", target: null, reason: f.reason, idempotencyKey: crypto.randomUUID(), proposed: { enabled: f.enabled, readNotificationsMonths: months, emailDays: days } }),
        { success: "Sent for approval. A different Admin or Super Admin must approve the new retention periods." });
      if (ok) setF({ ...f, reason: "" });
    }}>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Remove old read notifications and finished emails automatically, once a day</label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="rt-months" label="Keep read notifications (months)" hint="3 to 120. Notifications nobody has read are never removed."><Input type="number" min={3} max={120} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>
        <Field id="rt-days" label="Keep finished emails (days)" hint="7 to 730. Sent, failed and expired messages."><Input type="number" min={7} max={730} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
        <Field id="rt-reason" label="Reason for the approver"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={2000} /></Field>
      </div>
      {!valid ? <p role="alert" className="text-[var(--critical-fg)]">Months must be 3 to 120 and days 7 to 730, whole numbers.</p> : null}
      <Button type="submit" disabled={pending || !valid || !changed || f.reason.trim() === ""}>Send for approval</Button>
    </form>
  );
}
