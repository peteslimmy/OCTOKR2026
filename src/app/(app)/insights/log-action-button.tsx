"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Button, Field, Textarea } from "@/components/ui/primitives";

/** Note what was done for a unit (a call, a coaching session, a change of plan). The brief then shows how the unit's weeks went afterwards. */
export function LogActionButton({ businessUnitId, quarterId, unitName, scoreBefore }: { businessUnitId: string; quarterId: string; unitName: string; scoreBefore: number | null }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Log action</Button>
      <Modal open={open} onOpenChange={setOpen} title={`What was done for ${unitName}?`}
        description={`The unit's current weekly average${scoreBefore === null ? "" : ` (${scoreBefore.toFixed(0)}%)`} is saved with the note, so the next weeks can be compared with it.`}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => apiRequest("POST", "insight-actions", { businessUnitId, quarterId, note, scoreBefore }), { success: "Action logged." });
          if (ok) { setOpen(false); setNote(""); }
        }}>
          <Field id={`act-${businessUnitId}`} label="Action"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} required rows={3} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !note.trim()}>Save</Button></div>
        </form>
      </Modal>
    </>
  );
}
