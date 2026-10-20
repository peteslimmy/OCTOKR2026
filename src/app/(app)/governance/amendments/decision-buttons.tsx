"use client";

import { useState } from "react";
import { apiRequest, ConfirmButton, Modal, useAction } from "@/components/ui/client";
import { Button, Textarea, Field } from "@/components/ui/primitives";

export function DecisionButtons({ id }: { id: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmButton label="Approve" title="Approve this amendment?" description="The effective attendance status changes. The original roster value stays unchanged and the decision is audited."
        onConfirm={() => run(() => apiRequest("POST", `attendance-amendment-requests/${id}/approve`, { idempotencyKey: key }), { success: "Amendment approved." })} />
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(true)}>Reject</Button>
      <Modal open={open} onOpenChange={setOpen} title="Reject this amendment?" description="The requester is notified. A comment is helpful but not required.">
        <div className="space-y-3">
          <Field id={`rj-${id}`} label="Comment (optional)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending} onClick={async () => { const ok = await run(() => apiRequest("POST", `attendance-amendment-requests/${id}/reject`, { idempotencyKey: key + "-r", reason: reason || null }), { success: "Amendment rejected." }); if (ok) setOpen(false); }}>Reject</Button></div>
        </div>
      </Modal>
    </div>
  );
}
