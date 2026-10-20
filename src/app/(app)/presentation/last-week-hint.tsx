"use client";

import { History } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, ApiFailure, Modal } from "@/components/ui/client";
import { Badge, Button } from "@/components/ui/primitives";
import { formatWeekLabel } from "@/lib/domain/week-label";

interface Hint {
  availability: "OK" | "NO_PREVIOUS_WEEK" | "HOLIDAY" | "NO_REPORT";
  current_week: { week_number: number; week_start_at: string };
  previous_week: { week_number?: number; week_start_at: string; status?: string };
  business_unit: { name: string };
  tasks: { id: string; description: string; status: string; goal_title: string; goal_type: string }[];
  final_locked: boolean | null;
  undefined_tasks: number;
}

/**
 * Quick, read-only aid for a live review: shows the tasks the BU being presented left Not Done in the week before. It opens over the
 * presentation without navigating, keeps the presentation exactly as it is, and cannot change any record (the endpoint only reads).
 * Press L to open it.
 */
export function LastWeekHint({ weekId, buId, buName }: { weekId: string; buId: string; buName: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Hint | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setErr(null); setData(null);
    try {
      const out = await apiRequest<Hint>("GET", `presentation/last-week?weekId=${weekId}&buId=${buId}`);
      if (mine === seq.current) setData(out);
    } catch (e) {
      if (mine === seq.current) setErr((e as ApiFailure).message);
    }
    if (mine === seq.current) setLoading(false);
  }, [weekId, buId]);

  const show = useCallback(() => { setOpen(true); void load(); }, [load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l" || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      show();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [show]);

  const prevLabel = data?.previous_week.week_number !== undefined ? formatWeekLabel({ week_number: data.previous_week.week_number, week_start_at: data.previous_week.week_start_at }) : null;

  return (
    <>
      <Button variant="secondary" onClick={show} aria-keyshortcuts="L" title="Shortcut: L">
        <History className="h-4 w-4" aria-hidden />Last Week — Outstanding Tasks
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Last week's outstanding tasks" description={`${buName}${prevLabel ? ` · ${prevLabel}` : " · previous reporting week"}`}>
        <div className="space-y-3 text-sm" aria-live="polite">
          {loading ? <p role="status" className="text-muted">Loading last week…</p> : null}
          {err ? (
            <div role="alert" className="space-y-2">
              <p className="text-[var(--critical-fg)]">Last week could not be loaded: {err}</p>
              <Button size="sm" onClick={() => void load()}>Try again</Button>
            </div>
          ) : null}
          {data && !loading ? (
            data.availability === "NO_PREVIOUS_WEEK" ? <p>There is no earlier reporting week on the calendar to look back at.</p>
            : data.availability === "HOLIDAY" ? <p>{prevLabel} was an organisation holiday, so no tasks were due.</p>
            : data.availability === "NO_REPORT" ? <p>{buName} filed no report for {prevLabel}, so no tasks were recorded.</p>
            : data.tasks.length === 0 ? (
              <div className="space-y-2">
                <p className="font-medium">No outstanding tasks were recorded for the previous week.</p>
                {data.undefined_tasks > 0 ? <p className="text-muted">{data.undefined_tasks} task{data.undefined_tasks === 1 ? " was" : "s were"} still undefined because that week is not final yet.</p> : null}
              </div>
            ) : (
              <>
                <p className="text-muted">{data.tasks.length} task{data.tasks.length === 1 ? "" : "s"} marked Not Done.{data.final_locked === false ? ` That week is not final yet; ${data.undefined_tasks} undefined task${data.undefined_tasks === 1 ? " is" : "s are"} not listed.` : ""}</p>
                <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Outstanding tasks">
                  <table className="w-full text-left">
                    <caption className="sr-only">Tasks marked Not Done in {prevLabel} for {buName}</caption>
                    <thead className="sticky top-0 bg-panel text-xs text-muted"><tr><th scope="col" className="px-3 py-2 font-medium">Task</th><th scope="col" className="px-3 py-2 font-medium">Goal</th><th scope="col" className="px-3 py-2 font-medium">Status</th></tr></thead>
                    <tbody>
                      {data.tasks.map((t) => (
                        <tr key={t.id} className="border-t border-line align-top">
                          <th scope="row" className="px-3 py-2 font-medium">{t.description}</th>
                          <td className="px-3 py-2 text-muted">{t.goal_title}{t.goal_type === "STRETCH" ? " (stretch)" : ""}</td>
                          <td className="px-3 py-2"><Badge tone="notdone">Not Done</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          ) : null}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted">View only. Nothing here changes any task, report or score.</span>
            <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
