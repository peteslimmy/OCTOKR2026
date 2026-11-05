"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Badge, Banner } from "@/components/ui/primitives";

export const REASONS: { code: string; label: string; help: string }[] = [
  { code: "EXECUTION", label: "Not finished: execution", help: "The work was planned and was not completed in the week." },
  { code: "RESOURCES", label: "Not enough people, time or budget", help: "A resource we needed was not there." },
  { code: "DEPENDENCY", label: "Waiting on another team or unit", help: "Someone else had to deliver first." },
  { code: "AWAITING_DECISION", label: "Waiting for a decision", help: "A decision or approval had not been given." },
  { code: "PRIORITY_CHANGE", label: "Priorities changed", help: "It was overtaken by something more important." },
  { code: "UNREALISTIC_TIMELINE", label: "The timeline was unrealistic", help: "It could not have been done in a week." },
  { code: "TECHNICAL", label: "A technical problem", help: "A tool, system or technical issue blocked it." },
  { code: "COMPLETED_NOT_RECORDED", label: "It was done but not marked", help: "The work was completed; the status was not recorded." },
  { code: "OTHER", label: "Other (please explain)", help: "Say what happened." },
];
export interface FormTask { id: string; description: string; goal: string; reasonCode: string | null; remark: string | null }

export function RemarkForm({ requestId, tasks, canAnswer }: { requestId: string; tasks: FormTask[]; canAnswer: boolean }) {
  const { run, pending } = useAction();
  const open = tasks.filter((t) => !t.reasonCode);
  const [vals, setVals] = useState<Record<string, { reasonCode: string; remark: string }>>({});
  const [done, setDone] = useState(false);
  const set = (id: string, patch: Partial<{ reasonCode: string; remark: string }>) => setVals((v) => ({ ...v, [id]: { ...(v[id] ?? { reasonCode: "", remark: "" }), ...patch } }));
  const items = open.filter((t) => vals[t.id]?.reasonCode).map((t) => ({ taskId: t.id, reasonCode: vals[t.id].reasonCode, remark: vals[t.id].remark.trim() }));
  const missingText = items.some((i) => i.reasonCode === "OTHER" && !i.remark);

  return (
    <div className="space-y-4 px-6 py-4">
      {done ? <Banner tone="done" title="Remarks recorded">Thank you. They are kept with the tasks as the unit&apos;s explanation.</Banner> : null}
      <ul className="divide-y divide-line">
        {tasks.map((t) => {
          const answered = !!t.reasonCode;
          const reason = REASONS.find((r) => r.code === t.reasonCode);
          return (
            <li key={t.id} className="grid gap-3 py-4 md:grid-cols-[1fr_20rem]">
              <div><p className="font-medium">{t.description}</p><p className="mt-0.5 text-xs text-muted">Goal: {t.goal}</p></div>
              {answered ? (
                <div className="text-sm"><Badge tone="done">Remark given</Badge><p className="mt-1 font-medium">{reason?.label ?? t.reasonCode}</p>{t.remark ? <p className="mt-0.5 text-muted">{t.remark}</p> : null}</div>
              ) : canAnswer ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium" htmlFor={`r-${t.id}`}>Why was it not done?</label>
                  <select id={`r-${t.id}`} value={vals[t.id]?.reasonCode ?? ""} onChange={(e) => set(t.id, { reasonCode: e.target.value })} className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm">
                    <option value="">Choose a reason…</option>{REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                  {vals[t.id]?.reasonCode ? <p className="text-xs text-muted">{REASONS.find((r) => r.code === vals[t.id].reasonCode)?.help}</p> : null}
                  <label className="sr-only" htmlFor={`t-${t.id}`}>Explanation for this task</label>
                  <textarea id={`t-${t.id}`} rows={2} maxLength={2000} value={vals[t.id]?.remark ?? ""} onChange={(e) => set(t.id, { remark: e.target.value })} placeholder="Anything that helps management understand (optional, required for Other)"
                    className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
                </div>
              ) : <p className="text-sm text-muted">No remark yet.</p>}
            </li>
          );
        })}
      </ul>
      {canAnswer && open.length ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button type="button" disabled={pending || items.length === 0 || missingText} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={async () => { const r = await run(() => apiRequest("POST", `ai/remarks/${requestId}`, { items }), { success: "Remarks recorded." }); if (r) { setDone(true); setVals({}); } }}>
            {pending ? "Saving…" : `Record ${items.length || ""} remark${items.length === 1 ? "" : "s"}`.replace("  ", " ")}
          </button>
          <p className="text-xs text-muted">You can answer some now and the rest later. A recorded remark cannot be edited.</p>
          {missingText ? <p className="text-xs text-[var(--critical-fg)]">Explain each task you marked Other.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
