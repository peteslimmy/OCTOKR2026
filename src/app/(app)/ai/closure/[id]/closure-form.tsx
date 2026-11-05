"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Badge, Banner } from "@/components/ui/primitives";

export const OPTIONS: { code: string; label: string; help: string; needsText: boolean; decides: boolean }[] = [
  { code: "COMPLETED_NOT_RECORDED", label: "Finished, but not recorded", help: "The work was done; the record was not updated. A different person will verify it.", needsText: false, decides: true },
  { code: "IN_PROGRESS", label: "Still in progress: keep it", help: "It remains an active commitment. This is noted and changes nothing.", needsText: false, decides: false },
  { code: "PARTIALLY_COMPLETED", label: "Partly done: the rest needs a new commitment", help: "Say what is left and by when it can be done.", needsText: true, decides: true },
  { code: "STEPPED_DOWN", label: "Stepped down into a smaller activity", help: "Say what it becomes. The original stays linked.", needsText: true, decides: true },
  { code: "NO_LONGER_REQUIRED", label: "No longer required", help: "Say why. It is not cancelled until a different person approves.", needsText: true, decides: true },
  { code: "DEFERRED", label: "Deferred to a later period", help: "Say to when and why.", needsText: true, decides: true },
  { code: "BLOCKED", label: "Blocked or waiting", help: "Say who or what it is waiting for. This is noted and changes nothing.", needsText: true, decides: false },
  { code: "SCOPE_CHANGED", label: "The scope or expected outcome changed", help: "Say what changed.", needsText: true, decides: true },
];
const DISPOSITION: Record<string, { label: string; tone: "done" | "warn" | "critical" | "info" }> = { APPLIED: { label: "Noted", tone: "done" }, PROPOSED: { label: "Waiting for approval", tone: "warn" }, APPROVED: { label: "Approved", tone: "done" }, REJECTED: { label: "Not approved", tone: "critical" }, WITHDRAWN: { label: "Withdrawn", tone: "info" } };
export interface Item { goalId: string; title: string; weeksSet: number; firstWeek: number; lastWeek: number; history: { week: number; done: boolean; tasksDone: number; tasksTotal: number }[]; option: string | null; explanation: string | null; dispositionStatus: string | null }

export function ClosureForm({ requestId, items, canAnswer }: { requestId: string; items: Item[]; canAnswer: boolean }) {
  const { run, pending } = useAction();
  const open = items.filter((i) => !i.option);
  const [vals, setVals] = useState<Record<string, { option: string; explanation: string }>>({});
  const [done, setDone] = useState(false);
  const set = (id: string, patch: Partial<{ option: string; explanation: string }>) => setVals((v) => ({ ...v, [id]: { ...(v[id] ?? { option: "", explanation: "" }), ...patch } }));
  const chosen = open.filter((i) => vals[i.goalId]?.option);
  const missing = chosen.some((i) => { const o = OPTIONS.find((x) => x.code === vals[i.goalId].option); return o?.needsText && vals[i.goalId].explanation.trim().length < 5; });
  return (
    <div className="space-y-4 px-6 py-4">
      {done ? <Banner tone="done" title="Answers recorded">Anything that changes a goal now waits for a different person to approve it.</Banner> : null}
      <ul className="divide-y divide-line">
        {items.map((i) => {
          const opt = OPTIONS.find((o) => o.code === i.option);
          const disp = i.dispositionStatus ? DISPOSITION[i.dispositionStatus] : null;
          return (
            <li key={i.goalId} className="grid gap-3 py-4 md:grid-cols-[1fr_22rem]">
              <div>
                <p className="font-medium">{i.title}</p>
                <p className="mt-0.5 text-xs text-muted">Set in {i.weeksSet} finished weeks (week {i.firstWeek} to week {i.lastWeek}).</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Weeks it was set">{i.history.map((h) => <li key={h.week} className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs">W{h.week}: {h.done ? "done" : `${h.tasksDone} of ${h.tasksTotal} tasks`}</li>)}</ul>
              </div>
              {i.option ? (
                <div className="text-sm">{disp ? <Badge tone={disp.tone}>{disp.label}</Badge> : null}<p className="mt-1 font-medium">{opt?.label ?? i.option}</p>{i.explanation ? <p className="mt-0.5 text-muted">{i.explanation}</p> : null}</div>
              ) : canAnswer ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium" htmlFor={`o-${i.goalId}`}>What should happen to it?</label>
                  <select id={`o-${i.goalId}`} className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" value={vals[i.goalId]?.option ?? ""} onChange={(e) => set(i.goalId, { option: e.target.value })}>
                    <option value="">Choose…</option>{OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                  {vals[i.goalId]?.option ? <p className="text-xs text-muted">{OPTIONS.find((o) => o.code === vals[i.goalId].option)?.help}</p> : null}
                  <label className="sr-only" htmlFor={`e-${i.goalId}`}>Explanation</label>
                  <textarea id={`e-${i.goalId}`} rows={2} maxLength={4000} className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" value={vals[i.goalId]?.explanation ?? ""} onChange={(e) => set(i.goalId, { explanation: e.target.value })} placeholder="Explanation (required for most choices)" />
                </div>
              ) : <p className="text-sm text-muted">No answer yet.</p>}
            </li>
          );
        })}
      </ul>
      {canAnswer && open.length ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button type="button" disabled={pending || chosen.length === 0 || missing} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={async () => { const r = await run(() => apiRequest("POST", `ai/closure/${requestId}`, { items: chosen.map((i) => ({ goalId: i.goalId, option: vals[i.goalId].option, explanation: vals[i.goalId].explanation.trim() })) }), { success: "Answers recorded." }); if (r) { setDone(true); setVals({}); } }}>
            {pending ? "Saving…" : `Record ${chosen.length || ""} answer${chosen.length === 1 ? "" : "s"}`.replace("  ", " ")}
          </button>
          <p className="text-xs text-muted">You can answer some now and the rest later. An answer cannot be edited once recorded.</p>
          {missing ? <p className="text-xs text-[var(--critical-fg)]">Explain each choice that asks for it.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
