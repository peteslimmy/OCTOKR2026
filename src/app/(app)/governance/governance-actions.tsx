"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, ConfirmButton, Modal, useAction } from "@/components/ui/client";
import { Button, Input, Label, Select, Textarea, Field } from "@/components/ui/primitives";

export function CreateSessionButton({ weekId }: { weekId: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button size="sm" disabled={pending}
      onClick={() => run(async () => {
        const id = await apiRequest<string>("POST", "governance-sessions", { reportingWeekId: weekId });
        router.push(`/governance/sessions/${id}`);
      }, { refresh: false })}>
      {pending ? "Opening…" : "Create session"}
    </Button>
  );
}

const QUOTE_STEPS = {
  submit: { label: "Submit for approval", title: "Submit this quote for approval", description: "A different person with approval rights must approve it before it can be published.", done: "Quote submitted." },
  approve: { label: "Approve", title: "Approve this quote", description: "You cannot approve a quote you recorded or submitted.", done: "Quote approved." },
  publish: { label: "Publish", title: "Publish this quote", description: "It will show on every dashboard for the week.", done: "Quote published." },
  archive: { label: "Archive", title: "Archive this quote", description: "It is removed from the dashboard. The record is kept.", done: "Quote archived." },
} as const;

export function QuoteStepButton({ quoteId, step }: { quoteId: string; step: keyof typeof QUOTE_STEPS }) {
  const { run } = useAction();
  const s = QUOTE_STEPS[step];
  return (
    <ConfirmButton label={s.label} title={s.title} description={s.description} variant={step === "archive" ? "secondary" : "primary"}
      onConfirm={() => run(() => apiRequest("POST", `quotes/${quoteId}/${step}`), { success: s.done })} />
  );
}

export function QuoteForm({ weekId, people }: { weekId: string; people: { id: string; name: string; unit: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ speakerEmployeeId: "", quote: "" });
  const { run, pending } = useAction();
  const who = people.find((p) => p.id === f.speakerEmployeeId);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record quote</Button>
      <Modal open={open} onOpenChange={setOpen} title="Quote of the week" description="Recorded with the speaker and their BU.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", `reporting-weeks/${weekId}/quote`, f), { success: "Quote recorded." }); if (ok) { setOpen(false); setF({ speakerEmployeeId: "", quote: "" }); } }}>
          <Field id="q-quote" label="Quote"><Textarea value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} maxLength={1000} required /></Field>
          <div><Label htmlFor="q-speaker">Speaker</Label>
            <Select id="q-speaker" value={f.speakerEmployeeId} onChange={(e) => setF({ ...f, speakerEmployeeId: e.target.value })} required><option value="">Select a person…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</Select></div>
          <Field id="q-bu" label="Speaker's BU"><Input value={who?.unit ?? ""} placeholder="Filled in from the speaker" readOnly disabled /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !f.speakerEmployeeId}>Save quote</Button></div>
        </form>
      </Modal>
    </>
  );
}
