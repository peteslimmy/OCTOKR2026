"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Field, Textarea } from "@/components/ui/primitives";
import { WEEKDAYS } from "@/lib/domain/schedule";

export interface ChangeView {
  id: string; topic: string; description: string; target: string | null; proposed: Record<string, unknown>; current: Record<string, unknown> | null;
  reason: string; status: "PENDING" | "APPLIED" | "REJECTED" | "WITHDRAWN"; emergency: boolean; requestedBy: string; requestedById: string;
  decidedBy: string | null; comment: string | null; when: string; protectedTopic: boolean;
}

const LABELS: Record<string, string> = {
  code: "Code", name: "Name", criticality: "Criticality", defaultFine: "Default fine (₦)", active: "Active", rate: "Penalty rate",
  remindersEnabled: "Reminders on", reminderHours: "Hours before the lock", maxRemindersPerWeek: "Most reminders per person per week", emailEnabled: "Email on",
  status: "Status", reportsWeekly: "Reports weekly",
  contentLockDay: "Content lock day", contentLockTime: "Content lock time", contentLockWeekOffset: "Content lock: weeks after the week starts",
  finalLockDay: "Final lock day", finalLockTime: "Final lock time", finalLockWeekOffset: "Final lock: weeks after the week starts",
  enabled: "Purging on", readNotificationsMonths: "Keep read notifications (months)", emailDays: "Keep finished emails (days)",
  description: "Description", permissions: "Permissions", requiresMfa: "Authenticator required", moveTo: "People move to",
};
// the request uses camelCase, the stored setting snake_case
const STORED: Record<string, string> = { defaultFine: "default_fine", reminderHours: "reminder_hours", maxRemindersPerWeek: "max_reminders_per_week", remindersEnabled: "reminders_enabled", emailEnabled: "email_enabled", reportsWeekly: "reports_weekly" };
const show = (v: unknown) => Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : v === null || v === undefined ? "—" : String(v);

/** An integration: setting by setting, with secrets shown only as "changed" or "removed". The request holds ciphertext, which is never displayed. */
function integrationRows(v: ChangeView): { label: string; now: string; next: string }[] {
  const cur = (v.current ?? {}) as { name?: string; enabled?: boolean; settings?: Record<string, unknown>; secretsSet?: string[]; kind?: string };
  const p = v.proposed as { action?: string; kind?: string; name?: string; enabled?: boolean; settings?: Record<string, unknown>; secrets?: Record<string, string | null> };
  if (p.action === "DELETE") return [{ label: "Integration", now: cur.name ?? "—", next: "Remove it" }];
  const rows: { label: string; now: string; next: string }[] = [];
  if (p.action === "CREATE") rows.push({ label: "Kind", now: "—", next: p.kind ?? "—" });
  if (p.name !== undefined && p.name !== cur.name) rows.push({ label: "Name", now: cur.name ?? "—", next: p.name });
  if (p.enabled !== undefined && p.enabled !== cur.enabled) rows.push({ label: "In use", now: show(cur.enabled ?? false), next: show(p.enabled) });
  for (const [k, val] of Object.entries(p.settings ?? {})) {
    const before = cur.settings?.[k];
    if (p.action === "UPDATE" && JSON.stringify(before) === JSON.stringify(val)) continue;
    rows.push({ label: k, now: show(before), next: show(val) });
  }
  for (const [k, val] of Object.entries(p.secrets ?? {})) rows.push({ label: `Secret: ${k}`, now: cur.secretsSet?.includes(k) ? "saved" : "—", next: val === null ? "removed" : "changed (hidden)" });
  return rows.length ? rows : [{ label: "Integration", now: cur.name ?? "—", next: "No visible change" }];
}

/** Only the values the request proposes are listed, next to what is in force now. */
function changes(v: ChangeView): { label: string; now: string; next: string }[] {
  if (v.topic === "INTEGRATION") return integrationRows(v);
  const cur = v.current ?? {};
  return Object.entries(v.proposed).filter(([k, val]) => k !== "action" && val !== undefined).map(([k, val]) => {
    if (k === "permissions" && Array.isArray(val)) {                       // a role: show what is added and removed, not two long lists
      const before = new Set(Array.isArray(cur.permissions) ? (cur.permissions as string[]) : []); const after = new Set(val as string[]);
      const added = [...after].filter((x) => !before.has(x)); const removed = [...before].filter((x) => !after.has(x));
      return { label: LABELS[k], now: `${before.size} permissions`, next: [added.length ? `Add: ${added.join(", ")}` : "", removed.length ? `Remove: ${removed.join(", ")}` : "", !added.length && !removed.length ? "No change" : ""].filter(Boolean).join(". ") };
    }
    if (k.endsWith("LockDay")) return { label: LABELS[k], now: typeof cur[k] === "number" ? WEEKDAYS[(cur[k] as number) - 1] : "—", next: WEEKDAYS[Number(val) - 1] ?? String(val) };
    return { label: LABELS[k] ?? k, now: show(cur[STORED[k] ?? k]), next: show(val) };
  });
}

type Mode = "APPROVE" | "REJECT" | "EMERGENCY";

/** The approvals queue. Buttons appear only where the person may act; the database enforces the same rules whatever the screen shows. */
export function ChangeQueue({ items, me, canApprove, canProtected, canEmergency }: { items: ChangeView[]; me: string; canApprove: boolean; canProtected: boolean; canEmergency: boolean }) {
  const [target, setTarget] = useState<{ item: ChangeView; mode: Mode } | null>(null);
  const [comment, setComment] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const open = (item: ChangeView, mode: Mode) => { setTarget({ item, mode }); setComment(""); setKey(crypto.randomUUID()); };
  if (items.length === 0) return <p className="px-6 py-4 text-sm text-muted">No configuration changes have been requested yet.</p>;
  const mode = target?.mode;
  return (
    <>
      <ul className="divide-y divide-line" aria-label="Configuration changes">
        {items.map((r) => (
          <li key={r.id} className="space-y-1 px-6 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.description}</span>
              {r.emergency ? <Badge tone="critical">Emergency</Badge> : null}
              <Badge tone={r.status === "PENDING" ? "warn" : r.status === "APPLIED" ? "done" : r.status === "REJECTED" ? "critical" : "info"}>
                {r.status === "PENDING" ? "Waiting for approval" : r.status === "APPLIED" ? "Approved and applied" : r.status === "REJECTED" ? "Rejected" : "Withdrawn"}</Badge>
            </div>
            <p className="text-muted">Requested by {r.requestedBy} · {r.when}. Reason: {r.reason}</p>
            <table className="text-xs">
              <caption className="sr-only">Proposed values for {r.description}</caption>
              <thead className="text-left text-muted"><tr><th scope="col" className="pr-4 font-normal">Setting</th><th scope="col" className="pr-4 font-normal">Now</th><th scope="col" className="font-normal">Proposed</th></tr></thead>
              <tbody>{changes(r).map((c) => <tr key={c.label}><th scope="row" className="pr-4 text-left font-normal">{c.label}</th><td className="pr-4 tabular-nums">{c.now}</td><td className="tabular-nums">{c.next}</td></tr>)}</tbody>
            </table>
            {r.decidedBy ? <p className="text-muted">{r.status === "REJECTED" ? "Rejected" : r.status === "WITHDRAWN" ? "Withdrawn" : "Approved"} by {r.decidedBy}{r.comment ? `: ${r.comment}` : ""}</p> : null}
            {r.status === "PENDING" ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {r.requestedById === me ? (
                  <>
                    <p className="text-xs text-muted">You made this request, so someone else must decide it.</p>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", `config-changes/${r.id}/withdraw`), { success: "Request withdrawn." })}>Withdraw<span className="sr-only"> request: {r.description}</span></Button>
                  </>
                ) : canApprove && (!r.protectedTopic || canProtected) ? (
                  <>
                    <Button size="sm" onClick={() => open(r, "APPROVE")}>Approve<span className="sr-only"> change: {r.description}</span></Button>
                    <Button size="sm" variant="danger" onClick={() => open(r, "REJECT")}>Reject<span className="sr-only"> change: {r.description}</span></Button>
                  </>
                ) : canApprove ? <p className="text-xs text-muted">This change touches protected settings: a Super Admin must decide it.</p> : null}
                {canEmergency ? <Button size="sm" variant="secondary" onClick={() => open(r, "EMERGENCY")}>Apply in an emergency<span className="sr-only">: {r.description}</span></Button> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <Modal open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }}
        title={mode === "APPROVE" ? "Approve this change?" : mode === "REJECT" ? "Reject this change?" : "Apply this change now?"}
        description={mode === "APPROVE" ? `${target?.item.description}. Approving applies it immediately.`
          : mode === "REJECT" ? `${target?.item.description}. The requester is told why.`
          : `${target?.item.description}. This applies the change WITHOUT a second approver. It is audited as an emergency and the other approvers are alerted.`}>
        <div className="space-y-3">
          <Field id="cc-comment" label={mode === "REJECT" ? "Reason for rejecting (required)" : mode === "EMERGENCY" ? "Reason (required, at least 10 characters)" : "Comment (optional)"}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={mode === "APPROVE" ? "primary" : "danger"} disabled={pending || (mode === "REJECT" && !comment.trim()) || (mode === "EMERGENCY" && comment.trim().length < 10)}
              onClick={async () => {
                if (!target) return;
                const { item } = target;
                const ok = await run(() => target.mode === "EMERGENCY"
                  ? apiRequest("POST", "config-changes/emergency", { topic: item.topic, target: item.target, proposed: item.proposed, reason: comment.trim(), idempotencyKey: key, confirm: true })
                  : apiRequest("POST", `config-changes/${item.id}/decision`, { decision: target.mode, comment: comment.trim() || undefined, idempotencyKey: key }),
                  { success: target.mode === "APPROVE" ? "Approved and applied." : target.mode === "REJECT" ? "Request rejected." : "Change applied. The other approvers were alerted." });
                if (ok) setTarget(null);
              }}>{mode === "APPROVE" ? "Approve and apply" : mode === "REJECT" ? "Reject request" : "Apply now"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
