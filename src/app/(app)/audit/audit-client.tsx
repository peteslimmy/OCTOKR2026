"use client";

import { useState } from "react";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import type { AuditRule } from "@/lib/data/audit";

/** Investigation status of one indicator. Closing it (explained, escalated, dismissed) needs a note. */
export function AlertActions({ id, status }: { id: string; status: string }) {
  const { run, pending } = useAction();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const set = (next: string) => run(() => apiRequest("POST", `audit/alerts/${id}/status`, { status: next, note: note.trim() || undefined }), { success: "Status saved.", refresh: true });
  if (!open) return <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Update status</Button></div>;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface p-3">
      <Field id={`note-${id}`} label="Note (required to explain, escalate or dismiss)" hint={`Current status: ${status.toLowerCase().replace("_", " ")}`}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("UNDER_REVIEW")}>Under review</Button>
        <Button size="sm" variant="secondary" disabled={pending || !note.trim()} onClick={() => set("EXPLAINED")}>Explained</Button>
        <Button size="sm" variant="secondary" disabled={pending || !note.trim()} onClick={() => set("ESCALATED")}>Escalate</Button>
        <Button size="sm" variant="secondary" disabled={pending || !note.trim()} onClick={() => set("DISMISSED")}>Dismiss</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** Threshold, window, severity and switch of one rule (Super Admin; a reason is mandatory and the change is audited). */
export function RuleEditor({ rule }: { rule: AuditRule }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [threshold, setThreshold] = useState(String(rule.threshold));
  const [windowMinutes, setWindow] = useState(String(rule.window_minutes));
  const [severity, setSeverity] = useState(rule.severity);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [reason, setReason] = useState("");
  if (!open) return <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Edit<span className="sr-only"> {rule.name}</span></Button>;
  const save = async () => {
    const done = await run(() => apiRequest("POST", `audit/rules/${rule.code}`, { enabled, threshold: Number(threshold), windowMinutes: Number(windowMinutes), severity, reason: reason.trim() }), { success: "Rule saved.", refresh: true });
    if (done) setOpen(false);
  };
  return (
    <div className="grid min-w-64 gap-2">
      <Field id={`t-${rule.code}`} label="Threshold"><Input type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
      <Field id={`w-${rule.code}`} label="Window (minutes)"><Input type="number" min={1} value={windowMinutes} onChange={(e) => setWindow(e.target.value)} /></Field>
      <Field id={`s-${rule.code}`} label="Severity"><Select value={severity} onChange={(e) => setSeverity(e.target.value)}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Rule is on</label>
      <Field id={`r-${rule.code}`} label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
      <div className="flex gap-2"><Button size="sm" disabled={pending || !reason.trim()} onClick={save}>Save</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}

/** Re-computes the hash chain on demand and shows the answer in words. */
export function VerifyChain() {
  const { run, pending } = useAction();
  const [result, setResult] = useState<{ ok: boolean; checked: number; problem?: string; broken_chain_seq?: number } | null>(null);
  const verify = async () => {
    const r = await run(() => apiRequest<{ ok: boolean; checked: number; problem?: string; broken_chain_seq?: number }>("POST", "audit/verify"), { refresh: false });
    if (r) setResult(r.value);
  };
  return (
    <div className="mt-4 space-y-2">
      <Button onClick={verify} disabled={pending}>{pending ? "Checking…" : "Verify the chain now"}</Button>
      {result ? (result.ok
        ? <p role="status"><Badge tone="done">Intact</Badge> <span className="text-sm">{result.checked.toLocaleString("en-GB")} chained events checked; every link and hash matches.</span></p>
        : <p role="alert"><Badge tone="critical">Mismatch</Badge> <span className="text-sm">The chain is broken at event #{result.broken_chain_seq} ({result.problem?.toLowerCase().replace("_", " ")}). This has been recorded as a critical event. Report it to the security owner.</span></p>) : null}
    </div>
  );
}
