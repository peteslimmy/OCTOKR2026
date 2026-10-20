"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Badge, Button, Field, Input, Select } from "@/components/ui/primitives";

interface Props {
  settings: { remindersEnabled: boolean; reminderHours: number[]; maxPerWeek: number; emailEnabled: boolean };
  counts: Record<string, number>;
  problems: { at: string; status: string; attempts: number; error: string | null; subject: string }[];
  transport: string;
  /** When the content lock falls under the schedule in force, for example "Tuesday 18:00". */
  lockText: string;
}

/** Report reminders and the email channel: when reminders go out, how many a person can get, and whether the mail is actually leaving. */
export function ReminderSettings({ settings, counts, problems, transport, lockText }: Props) {
  const [enabled, setEnabled] = useState(settings.remindersEnabled);
  const [hours, setHours] = useState(settings.reminderHours.join(", "));
  const [max, setMax] = useState(String(settings.maxPerWeek));
  const [email, setEmail] = useState(settings.emailEnabled);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction();
  const parsed = hours.split(/[,\s]+/).filter(Boolean).map(Number);
  const hoursOk = parsed.length >= 1 && parsed.length <= 4 && parsed.every((h) => Number.isInteger(h) && h >= 1 && h <= 72) && new Set(parsed).size === parsed.length;
  const provider = transport === "none" ? { tone: "warn" as const, text: "No email provider is configured. Mail is queued for 48 hours and then dropped. Reminders still appear in the application." }
    : { tone: "done" as const, text: `Email goes out through: ${transport}.` };
  return (
    <form className="space-y-4 px-6 py-4 text-sm" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      if (reason.trim() === "") { setError("Say why the settings are changing, so the approver can decide."); return; }
      if (!hoursOk) { setError("Enter one to four different whole numbers of hours between 1 and 72, for example 24, 6."); return; }
      await run(() => apiRequest("PUT", "notification-settings", { remindersEnabled: enabled, reminderHours: parsed, maxRemindersPerWeek: Number(max), emailEnabled: email, reason }), { success: "Sent for approval. The settings change once a different Admin or Super Admin approves." });
    }}>
      <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Send reminders to Business Unit Leads whose report is not submitted</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rem-hours" label="Hours before the content lock" hint={`${lockText} Lagos time. For example 24, 6 sends one reminder a day before and one six hours before.`}>
          <Input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" />
        </Field>
        <Field id="rem-max" label="Most reminders one person gets per week" hint="A frequency limit. Holiday weeks and submitted reports never get reminders.">
          <Select value={max} onChange={(e) => setMax(e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
        </Field>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />Send email for time-sensitive events (people can still turn routine email off for themselves)</label>
      <Field id="rem-reason" label="Reason for the approver"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
      {error ? <p role="alert" className="text-[var(--critical-fg)]">{error}</p> : null}
      <Button type="submit" disabled={pending}>Send for approval</Button>

      <div className="space-y-2 border-t border-line pt-4">
        <p className="flex flex-wrap items-center gap-2"><Badge tone={provider.tone}>{transport === "none" ? "No provider" : "Provider ready"}</Badge>{provider.text}</p>
        <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Email queue">
          {["PENDING", "SENT", "FAILED", "SKIPPED"].map((k) => <li key={k}>{k.charAt(0) + k.slice(1).toLowerCase()}: <span className="tabular-nums text-ink">{counts[k] ?? 0}</span></li>)}
        </ul>
        {problems.length ? (
          <ul className="space-y-1 text-xs text-muted" aria-label="Recent email problems">
            {problems.slice(0, 5).map((p, i) => <li key={i}>{p.status.toLowerCase()}, {p.attempts} attempt{p.attempts === 1 ? "" : "s"}: {p.subject}{p.error ? ` (${p.error})` : ""}</li>)}
          </ul>
        ) : null}
      </div>
    </form>
  );
}
