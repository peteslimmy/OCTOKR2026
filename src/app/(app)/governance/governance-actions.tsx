"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
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

export function QuoteForm({ weekId, bus }: { weekId: string; bus: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ businessUnitId: "", speaker: "", quote: "" });
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record quote</Button>
      <Modal open={open} onOpenChange={setOpen} title="Quote of the week" description="Recorded with the speaker and their BU.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", `reporting-weeks/${weekId}/quote`, f), { success: "Quote recorded." }); if (ok) setOpen(false); }}>
          <Field id="q-quote" label="Quote"><Textarea value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} maxLength={1000} required /></Field>
          <Field id="q-speaker" label="Speaker"><Input value={f.speaker} onChange={(e) => setF({ ...f, speaker: e.target.value })} required /></Field>
          <div><Label htmlFor="q-bu">Speaker&apos;s BU</Label>
            <Select id="q-bu" value={f.businessUnitId} onChange={(e) => setF({ ...f, businessUnitId: e.target.value })} required><option value="">Select…</option>{bus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>Save quote</Button></div>
        </form>
      </Modal>
    </>
  );
}
