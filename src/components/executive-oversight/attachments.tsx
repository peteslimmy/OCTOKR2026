"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/primitives";
import { apiUpload, apiRequest, useAction } from "@/components/ui/client";
import { DialogForm, AreaF } from "@/components/session-notes/forms";
import { useState } from "react";
import type { EoAttachment } from "@/lib/executive-oversight/types";
import { dateText } from "./common";

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files attached to a comment or recommendation. Uploading runs the same checks as every other upload (type, content, size, malware scan); a file is withdrawn, never deleted. */
export function Attachments({ owner, files, viewerId, canAttach }: { owner: { kind: "comment" | "recommendation"; id: string }; files: EoAttachment[]; viewerId: string; canAttach: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const { run, pending } = useAction();
  const [reason, setReason] = useState("");
  const base = owner.kind === "comment" ? "executive-comments" : "executive-recommendations";
  return (
    <section aria-label="Attached files" className="space-y-2">
      {files.length === 0 ? <p className="text-sm text-muted">No files attached.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><a className="font-medium text-brand-700 underline" href={`/api/v1/executive-attachments/${f.id}`}>{f.file_name}</a> <span className="text-xs text-muted">{size(f.size_bytes)} · {f.uploaded_by} · {dateText(f.uploaded_at)}</span></span>
              {f.uploaded_by_id === viewerId ? (
                <DialogForm label="Withdraw" title={`Withdraw ${f.file_name}`} description="The file is hidden from the list; the record of it and the reason stay in the history." submitLabel="Withdraw file" success="File withdrawn."
                  canSubmit={reason.trim().length > 0} onSubmit={() => apiRequest("POST", `executive-attachments/${f.id}/remove`, { reason: reason.trim() })} variant="ghost">
                  <AreaF id={`why-${f.id}`} label="Why is it being withdrawn?" required value={reason} onChange={setReason} max={1000} />
                </DialogForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canAttach ? (
        <div>
          <input ref={input} type="file" className="sr-only" aria-label="Choose a file to attach" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.txt,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) await run(() => apiUpload(`${base}/${owner.id}/attachments`, file), { success: "File attached." });
            }} />
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => input.current?.click()}>{pending ? "Uploading…" : "Attach a file"}</Button>
          <span className="ml-2 text-xs text-muted">PDF, image, Word, Excel or text; checked before it is stored.</span>
        </div>
      ) : null}
    </section>
  );
}
