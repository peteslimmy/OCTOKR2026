"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";

/** Super Admin only (the database refuses anyone else). Rolls an import back inside its window: created records are deactivated, changed ones restored. */
export function VoidImportButton({ batchId, fileName, until, endpoint, extra }: { batchId: string; fileName: string; until: string; endpoint?: string; extra?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>Roll back</Button>
      <Modal open={open} onOpenChange={setOpen} title="Roll back this import"
        description={`This undoes the import of ${fileName}. ${extra ?? "Records it added are deactivated (never deleted) and records it changed go back to how they were."} It is refused, with the reasons, if anything has changed or depends on it since. You can do this until ${until}. It is audited and the administrators are told.`}>
        <div className="space-y-3">
          <Field id={`void-${batchId}`} label="Reason (required, at least 10 characters)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <Field id={`void-confirm-${batchId}`} label="Type VOID IMPORT to confirm"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending || reason.trim().length < 10 || confirm !== "VOID IMPORT"}
              onClick={async () => {
                const ok = await run(() => apiRequest("POST", endpoint ?? `imports/batches/${batchId}/void`, { reason, confirm, idempotencyKey: key }), { success: "The import was rolled back." });
                if (ok) { setOpen(false); setReason(""); setConfirm(""); setKey(crypto.randomUUID()); router.refresh(); }
              }}>Roll back the import</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
