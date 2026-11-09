"use client";

import { useState } from "react";
import { apiRequest, ConfirmButton, Modal, useAction } from "@/components/ui/client";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Field, Input, NativeSelect } from "@/components/ui/primitives";

export interface ScheduleView { id: string; name: string; frequency: string; sendWeekday: number; sendDay: number; sendTime: string; recipientIds: string[]; sections: string[]; isActive: boolean; nextSendAt: string | null }
export interface RunView {
  id: string; schedule_id: string; period_key: string; trigger: string; status: string; subject: string; created_at: string;
  report_email_schedules: { name: string } | null;
  report_email_deliveries: { id: string; email: string; status: string; error: string | null; attempts: number }[];
}
interface Person { id: string; name: string; email: string }

const SECTIONS = [["HEADLINES", "Headline numbers"], ["RANKING", "Business Unit ranking"], ["TREND", "Trend"], ["HIGHLIGHTS", "Highlights"], ["ATTENTION", "Attention needed"], ["INSIGHTS", "Insights"]] as const;
const FREQ: Record<string, string> = { WEEKLY: "Weekly", MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUAL: "Annual" };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STATUS_TONE: Record<string, "done" | "warn" | "critical" | "info" | "undefined"> = { SENT: "done", PARTIAL: "warn", FAILED: "critical", PENDING: "info", EMPTY: "undefined" };
const blank = (): Omit<ScheduleView, "id" | "nextSendAt"> => ({ name: "", frequency: "WEEKLY", sendWeekday: 1, sendDay: 1, sendTime: "08:00", recipientIds: [], sections: SECTIONS.map((s) => s[0]), isActive: true });

function sendsOn(f: Pick<ScheduleView, "frequency" | "sendWeekday" | "sendDay" | "sendTime">) {
  return f.frequency === "WEEKLY" ? `Every ${DAYS[f.sendWeekday - 1]} at ${f.sendTime}, for the week just ended`
    : `On day ${f.sendDay} of the month at ${f.sendTime}, for the ${f.frequency === "MONTHLY" ? "month" : f.frequency === "QUARTERLY" ? "quarter" : "year"} just ended`;
}

export function EmailReports({ schedules, people, runs, canManage, canSend, canHistory }: { schedules: ScheduleView[]; people: Person[]; runs: RunView[]; canManage: boolean; canSend: boolean; canHistory: boolean }) {
  const [editing, setEditing] = useState<{ id: string | null; form: ReturnType<typeof blank> } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string; periodLabel: string; empty: boolean; form: ReturnType<typeof blank> } | null>(null);
  const { run, pending } = useAction();
  const body = (f: ReturnType<typeof blank>) => ({ name: f.name, frequency: f.frequency, sendWeekday: f.sendWeekday, sendDay: f.sendDay, sendTime: f.sendTime, recipientIds: f.recipientIds, sections: f.sections, isActive: f.isActive });
  const previewOf = async (f: ReturnType<typeof blank>) => {
    const r = await run(() => apiRequest<{ subject: string; html: string; text: string; periodLabel: string; empty: boolean }>("POST", "report-email/preview", { frequency: f.frequency, sections: f.sections, name: f.name || "Report summary" }), { refresh: false });
    if (r) setPreview({ ...r.value, form: f });
  };
  const test = (f: ReturnType<typeof blank>) => run(() => apiRequest<{ sentTo: string }>("POST", "report-email/test", { frequency: f.frequency, sections: f.sections, name: f.name || "Report summary" }), { success: "Test email sent to you.", refresh: false });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={`Schedules (${schedules.length})`} description="Each schedule sends one email per recipient, so nobody sees who else received it."
          action={canManage ? <Button size="sm" onClick={() => setEditing({ id: null, form: blank() })}>New schedule</Button> : undefined} />
        {schedules.length ? (
          <ul className="divide-y divide-line" aria-label="Email schedules">
            {schedules.map((s) => (
              <li key={s.id} className="space-y-2 px-6 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{s.name} <Badge tone={s.isActive ? "done" : "undefined"}>{s.isActive ? "On" : "Paused"}</Badge> <Badge tone="info">{FREQ[s.frequency]}</Badge></p>
                    <p className="text-muted">{sendsOn(s)}. {s.recipientIds.length} {s.recipientIds.length === 1 ? "recipient" : "recipients"}. {s.nextSendAt ? `Next send: ${s.nextSendAt}.` : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManage ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => previewOf(s)}>Preview</Button> : null}
                    {canManage ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => test(s)}>Send test to me</Button> : null}
                    {canSend ? <ConfirmButton label="Send now" variant="secondary" title={`Send "${s.name}" now?`} description={`The latest finished ${s.frequency === "WEEKLY" ? "week" : s.frequency === "MONTHLY" ? "month" : s.frequency === "QUARTERLY" ? "quarter" : "year"} is emailed to all ${s.recipientIds.length} recipients. A period that was already sent is not sent twice.`} confirmLabel="Send"
                      onConfirm={() => run(() => apiRequest<{ status: string; sent: number; failed: number }>("POST", `report-email/schedules/${s.id}/send`, {}), { success: "The summary was sent. See the delivery history for each recipient." })} /> : null}
                    {canManage ? <Button size="sm" variant="secondary" onClick={() => setEditing({ id: s.id, form: { name: s.name, frequency: s.frequency, sendWeekday: s.sendWeekday, sendDay: s.sendDay, sendTime: s.sendTime, recipientIds: s.recipientIds, sections: s.sections, isActive: s.isActive } })}>Edit</Button> : null}
                    {canManage ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("PUT", `report-email/schedules/${s.id}`, { ...body({ ...s }), isActive: !s.isActive }), { success: s.isActive ? "Schedule paused." : "Schedule switched on." })}>{s.isActive ? "Pause" : "Resume"}</Button> : null}
                    {canManage ? <ConfirmButton label="Delete" variant="secondary" title={`Delete "${s.name}"?`} description="Its delivery history is deleted with it. Emails already sent are not recalled." onConfirm={() => run(() => apiRequest("DELETE", `report-email/schedules/${s.id}`), { success: "Schedule deleted." })} /> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No schedules yet">{canManage ? "Choose New schedule to set up the first automated summary." : "An Admin can set up automated summaries."}</EmptyState>}
      </Card>

      {canHistory ? (
        <Card>
          <CardHeader title="Delivery history" description="The latest sends, with the result for every recipient." />
          {runs.length ? (
            <ul className="divide-y divide-line" aria-label="Delivery history">
              {runs.map((r) => {
                const failed = r.report_email_deliveries.filter((d) => d.status === "FAILED");
                return (
                  <li key={r.id} className="space-y-1 px-6 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium text-ink">{r.subject} <Badge tone={STATUS_TONE[r.status] ?? "undefined"}>{r.status === "SENT" ? "Sent" : r.status === "PARTIAL" ? "Partly sent" : r.status === "FAILED" ? "Failed" : r.status === "EMPTY" ? "No recipients" : "Sending"}</Badge></p>
                      {canSend && failed.length ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", `report-email/runs/${r.id}/retry`), { success: "Retry finished. Check the result below." })}>Retry {failed.length} failed</Button> : null}
                    </div>
                    <p className="text-muted">{r.report_email_schedules?.name ?? "Deleted schedule"} · {r.trigger === "MANUAL" ? "sent by a person" : "scheduled"} · {new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} · {r.report_email_deliveries.filter((d) => d.status === "SENT").length} of {r.report_email_deliveries.length} delivered</p>
                    {failed.length ? <ul className="text-xs text-red-700">{failed.map((d) => <li key={d.id}>{d.email}: {d.error ?? "failed"}</li>)}</ul> : null}
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState title="Nothing sent yet">Sent summaries appear here.</EmptyState>}
        </Card>
      ) : null}

      <Modal open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} title={editing?.id ? "Edit schedule" : "New schedule"} description="Choose when the summary goes out, who gets it and what it contains.">
        {editing ? (
          <ScheduleForm form={editing.form} people={people} pending={pending}
            onChange={(form) => setEditing({ ...editing, form })}
            onPreview={() => previewOf(editing.form)}
            onSave={async () => {
              const ok = await run(() => apiRequest(editing.id ? "PUT" : "POST", editing.id ? `report-email/schedules/${editing.id}` : "report-email/schedules", body(editing.form)), { success: "Schedule saved." });
              if (ok) setEditing(null);
            }} />
        ) : null}
      </Modal>

      <Modal open={preview !== null} onOpenChange={(o) => { if (!o) setPreview(null); }} title={preview ? `Preview: ${preview.periodLabel}` : "Preview"} description={preview ? preview.subject : undefined}>
        {preview ? (
          <div className="space-y-3">
            {preview.empty ? <Banner tone="info" title="No data for this period">The email would say there is nothing to summarise.</Banner> : null}
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[60vh] w-full rounded-lg border border-line bg-white" />
            <div className="flex justify-end gap-2">
              {canManage ? <Button variant="secondary" disabled={pending} onClick={() => test(preview.form)}>Send test to me</Button> : null}
              <Button onClick={() => setPreview(null)}>Close</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function ScheduleForm({ form, people, pending, onChange, onSave, onPreview }: { form: ReturnType<typeof blank>; people: Person[]; pending: boolean; onChange: (f: ReturnType<typeof blank>) => void; onSave: () => void; onPreview: () => void }) {
  const [q, setQ] = useState("");
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => onChange({ ...form, [k]: v });
  const toggle = (key: "recipientIds" | "sections", v: string) => set(key, (form[key].includes(v) ? form[key].filter((x) => x !== v) : [...form[key], v]) as never);
  const shown = people.filter((p) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  const valid = form.name.trim() && form.recipientIds.length > 0 && form.sections.length > 0;
  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      <Field id="re-name" label="Name"><Input value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="Weekly leadership summary" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="re-freq" label="Frequency"><NativeSelect value={form.frequency} onChange={(e) => set("frequency", e.target.value)}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
        {form.frequency === "WEEKLY"
          ? <Field id="re-weekday" label="Send on"><NativeSelect value={form.sendWeekday} onChange={(e) => set("sendWeekday", Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</NativeSelect></Field>
          : <Field id="re-day" label="Day of the month" hint="1 to 28"><Input type="number" min={1} max={28} value={form.sendDay} onChange={(e) => set("sendDay", Math.min(28, Math.max(1, Number(e.target.value) || 1)))} /></Field>}
        <Field id="re-time" label="Time (Lagos)"><Input type="time" value={form.sendTime} onChange={(e) => set("sendTime", e.target.value)} /></Field>
      </div>
      <p className="text-xs text-muted">{sendsOn(form)}.</p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Sections</legend>
        <div className="grid gap-1 sm:grid-cols-2">{SECTIONS.map(([k, label]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sections.includes(k)} onChange={() => toggle("sections", k)} />{label}</label>)}</div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Recipients ({form.recipientIds.length} chosen)</legend>
        <Input aria-label="Search people" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
          {shown.length ? shown.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.recipientIds.includes(p.id)} onChange={() => toggle("recipientIds", p.id)} />{p.name} <span className="text-muted">{p.email}</span></label>) : <p className="text-sm text-muted">No one matches.</p>}
        </div>
        <p className="text-xs text-muted">Only people with an active account can be chosen. Up to 50.</p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />Switched on</label>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={pending || form.sections.length === 0} onClick={onPreview}>Preview</Button>
        <Button disabled={pending || !valid} onClick={onSave}>Save schedule</Button>
      </div>
    </div>
  );
}
