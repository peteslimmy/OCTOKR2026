"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Button, Label, Textarea } from "@/components/ui/primitives";

function ReasonDialog({ open, onOpenChange, title, description, fieldId, confirmLabel, danger, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; fieldId: string; confirmLabel: string; danger?: boolean;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="space-y-3">
        <div>
          <Label htmlFor={fieldId}>Reason (required)</Label>
          <Textarea id={fieldId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={busy || reason.trim() === ""}
            onClick={async () => { setBusy(true); try { if (await onSubmit(reason)) onOpenChange(false); } finally { setBusy(false); } }}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Authorise a late report for one BU and week. The reason is mandatory and recorded in the audit trail. */
export function AuthoriseButton({ businessUnitId, reportingWeekId, label }: { businessUnitId: string; reportingWeekId: string; label: string }) {
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Authorise late report</Button>
      <ReasonDialog open={open} onOpenChange={setOpen} title="Authorise a late weekly report?" confirmLabel="Authorise"
        fieldId={`lr-${reportingWeekId.slice(0, 8)}-${businessUnitId.slice(0, 8)}`}
        description={`${label}. The BU Lead may file this report late. It is reviewed before any score changes; the original zero and earlier quarterly scores stay on record.`}
        onSubmit={async (reason) => !!(await run(() => apiRequest("POST", "late-report-exceptions", { businessUnitId, reportingWeekId, reason, idempotencyKey: key }), { success: "Late report authorised." }))} />
    </>
  );
}

export function ApplyButton({ id, label }: { id: string; label: string }) {
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Apply score amendment</Button>
      <ReasonDialog open={open} onOpenChange={setOpen} title="Apply the quarterly score amendment?" confirmLabel="Apply amendment" fieldId={`ap-${id}`}
        description={`${label}. This creates a new weekly score version and a new quarterly score version. Nothing earlier is changed or deleted, and this cannot be undone.`}
        onSubmit={async (reason) => !!(await run(() => apiRequest("POST", `late-report-exceptions/${id}/apply`, { reason, idempotencyKey: key }), { success: "Score amended." }))} />
    </>
  );
}

export function RevokeButton({ id, submitted }: { id: string; submitted: boolean }) {
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{submitted ? "Reject late report" : "Withdraw authorisation"}</Button>
      <ReasonDialog open={open} onOpenChange={setOpen} danger confirmLabel="Confirm" fieldId={`rv-${id}`}
        title={submitted ? "Reject this late report?" : "Withdraw this authorisation?"}
        description="The report is locked again and no score changes. The BU Lead is notified with your reason."
        onSubmit={async (reason) => !!(await run(() => apiRequest("POST", `late-report-exceptions/${id}/revoke`, { reason }), { success: "Late report closed." }))} />
    </>
  );
}
