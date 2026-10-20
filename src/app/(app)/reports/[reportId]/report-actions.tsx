"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Button, Input, Textarea, Field } from "@/components/ui/primitives";
import type { ReportParams } from "@/lib/reports/types";

/** Save this view as a personal report, and (organisation-wide holders only) freeze an official snapshot. Neither stores data you cannot see. */
export function ReportActions({ reportId, params, title, canSnapshot, canSave }: { reportId: string; params: ReportParams; title: string; canSnapshot: boolean; canSave: boolean }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [mode, setMode] = useState<null | "save" | "snapshot">(null);
  const [name, setName] = useState(title);
  const [note, setNote] = useState("");
  if (!canSnapshot && !canSave) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canSave ? <Button size="sm" variant="secondary" onClick={() => { setName(title); setMode("save"); }}>Save this view</Button> : null}
      {canSnapshot ? <Button size="sm" variant="secondary" onClick={() => { setName(`${title}: official snapshot`); setMode("snapshot"); }}>Create official snapshot</Button> : null}
      <Modal open={mode !== null} onOpenChange={(o) => !o && setMode(null)} title={mode === "snapshot" ? "Create an official snapshot?" : "Save this view"}
        description={mode === "snapshot"
          ? "The results are frozen with their filters, definition version and a checksum. Snapshots cannot be edited or deleted, and show organisation-wide data."
          : "Saves the report and filters (not the data). Whoever opens it sees their own permitted data."}>
        <div className="space-y-3">
          <Field id="rep-name" label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={mode === "snapshot" ? 160 : 120} /></Field>
          {mode === "snapshot" ? <Field id="rep-note" label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button disabled={pending || !name.trim()} onClick={async () => {
              const ok = mode === "snapshot"
                ? await run(() => apiRequest<{ id: string }>("POST", `reports/${reportId}/snapshots`, { title: name, note: note || null, params }), { success: "Snapshot created.", refresh: false })
                : await run(() => apiRequest("POST", "saved-reports", { name, reportId, params, sharedWith: [] }), { success: "View saved.", refresh: false });
              if (ok) { setMode(null); if (mode === "snapshot") router.push(`/reports/snapshots/${(ok.value as { id: string }).id}`); }
            }}>{mode === "snapshot" ? "Create snapshot" : "Save"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
