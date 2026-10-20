"use client";

import { useEffect, useState } from "react";
import { ApiFailure, apiRequest, Modal, useAction } from "@/components/ui/client";
import { Banner, Button, Textarea, Field } from "@/components/ui/primitives";
import { TaskStatusBadge } from "@/components/status";
import { formatPercent, formatFraction } from "@/lib/format";

interface Preview {
  task_status: string; target_status: string; total_goals: number; done_goals_before: number; done_goals_after: number;
  base_score_before: number; base_score_after: number; configured_penalty_rate: number | null; already_applied_rate: number;
  final_if_waived: number; final_if_applied: number | null; penalty_applicable: boolean;
}

/** Governed integrity correction (UJ-10): reason, confirmation, penalty decision. No bypass for any role. */
export function IntegrityDialog({ task, open, onOpenChange }: {
  task: { id: string; description: string; status: "DONE" | "NOT_DONE" | "UNDEFINED" }; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const target = task.status === "DONE" ? "NOT_DONE" : "DONE";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"APPLY" | "WAIVE" | "">("");
  const [waiver, setWaiver] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [key] = useState(() => crypto.randomUUID()); // one idempotency key per dialog instance (callers mount it fresh each time)
  const { run, pending } = useAction();

  useEffect(() => {
    if (!open) return;
    apiRequest<Preview>("GET", `integrity-corrections/preview?taskId=${task.id}&target=${target}`)
      .then(setPreview).catch((e: ApiFailure) => setLoadErr(e.message));
  }, [open, task.id, target]);

  const needsDecision = task.status === "DONE";
  const valid = reason.trim().length > 0 && confirm && (!needsDecision || (decision === "APPLY" || (decision === "WAIVE" && waiver.trim().length > 0)));
  const fmt = (n: number | null) => (n === null ? "—" : formatPercent(n));

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Integrity correction"
      description="Every correction is recorded with your reason and cannot be silently changed. SuperAdmin, Admin and Presenter use this same workflow.">
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-surface p-3">
          <p className="font-medium">{task.description}</p>
          <p className="mt-2 flex items-center gap-2">Current <TaskStatusBadge status={task.status} /> → proposed <TaskStatusBadge status={target} /></p>
        </div>
        {loadErr ? <Banner tone="critical" title="Cannot prepare this correction">{loadErr}</Banner> : null}
        {preview ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted">Base score now</dt><dd className="text-right tabular-nums">{fmt(preview.base_score_before)}</dd>
            <dt className="text-muted">Base score after correction</dt><dd className="text-right tabular-nums">{fmt(preview.base_score_after)}</dd>
            {preview.penalty_applicable ? (<>
              <dt className="text-muted">Configured penalty rate</dt><dd className="text-right tabular-nums">{preview.configured_penalty_rate === null ? "not configured" : formatFraction(preview.configured_penalty_rate)}</dd>
              <dt className="text-muted">Already applied this week</dt><dd className="text-right tabular-nums">{formatFraction(preview.already_applied_rate)}</dd>
              <dt className="text-muted">Final score if waived</dt><dd className="text-right tabular-nums">{fmt(preview.final_if_waived)}</dd>
              <dt className="text-muted">Final score if applied</dt><dd className="text-right font-semibold tabular-nums">{fmt(preview.final_if_applied)}</dd>
            </>) : (<><dt className="text-muted">Final score after correction</dt><dd className="text-right tabular-nums">{fmt(preview.final_if_waived)}</dd></>)}
          </dl>
        ) : !loadErr ? <p className="text-muted">Calculating impact…</p> : null}
        {preview?.penalty_applicable ? <p className="text-xs text-muted">Penalty rates are summed and applied once to the original base score, floored at 0.0% and stored to two decimals (shown to one).</p> : null}

        <Field id="ic-reason" label="Reason (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>

        {needsDecision ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">Penalty decision (required)</legend>
            <label className="flex items-center gap-2"><input type="radio" name="decision" checked={decision === "APPLY"} onChange={() => setDecision("APPLY")} /> Apply penalty</label>
            <label className="flex items-center gap-2"><input type="radio" name="decision" checked={decision === "WAIVE"} onChange={() => setDecision("WAIVE")} /> Waive penalty</label>
            {decision === "WAIVE" ? <Field id="ic-waiver" label="Waiver reason (required)"><Textarea value={waiver} onChange={(e) => setWaiver(e.target.value)} maxLength={2000} /></Field> : null}
            {decision === "APPLY" && preview?.configured_penalty_rate === null ? <Banner tone="warn" title="No penalty rate is configured">An Admin must configure it before a penalty can be applied. You can waive instead.</Banner> : null}
          </fieldset>
        ) : <p className="text-muted">NOT_DONE → DONE carries no penalty.</p>}

        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>I confirm this correction is accurate and understand it is permanently recorded.</span></label>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" disabled={!valid || pending || !preview}
            onClick={async () => {
              const ok = await run(() => apiRequest("POST", "integrity-corrections", {
                taskId: task.id, targetStatus: target, reason, penaltyDecision: needsDecision ? decision : null,
                waiverReason: decision === "WAIVE" ? waiver : null, confirm: true, idempotencyKey: key,
              }), { success: "Correction recorded and audited." });
              if (ok) onOpenChange(false);
            }}>{pending ? "Recording…" : "Record correction"}</Button>
        </div>
      </div>
    </Modal>
  );
}
