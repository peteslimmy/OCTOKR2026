"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";

/** Approve or reject a proposal. A reason is needed to reject. Never the person who proposed it (the database refuses). */
export function DecideButtons({ approvalId, mine }: { approvalId: string; mine: boolean }) {
  const { run, pending } = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  if (mine) return <span className="text-xs text-muted">You proposed this: someone else decides it.</span>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" disabled={pending} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={() => run(() => apiRequest("POST", `ai/approvals/${approvalId}`, { approve: true }), { success: "Approved." })}>Approve</button>
        <button type="button" disabled={pending} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium hover:bg-surface" onClick={() => setRejecting((r) => !r)}>{rejecting ? "Cancel" : "Reject"}</button>
      </div>
      {rejecting ? (
        <div className="flex gap-2">
          <label className="sr-only" htmlFor={`rj-${approvalId}`}>Reason for rejecting</label>
          <input id={`rj-${approvalId}`} className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Why is it not approved?" />
          <button type="button" disabled={pending || !note.trim()} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-50" onClick={() => run(() => apiRequest("POST", `ai/approvals/${approvalId}`, { approve: false, note: note.trim() }), { success: "Rejected." })}>Reject</button>
        </div>
      ) : null}
    </div>
  );
}
