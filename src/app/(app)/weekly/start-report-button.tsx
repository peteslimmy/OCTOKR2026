"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Button, Select } from "@/components/ui/primitives";

export function StartReportButton({ weekId, businessUnitId }: { weekId: string; businessUnitId?: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button size="sm" disabled={pending}
      onClick={() => run(async () => {
        const id = await apiRequest<string>("POST", "weekly-reports", { reportingWeekId: weekId, businessUnitId });
        router.push(`/weekly/${id}`);
      }, { refresh: false })}>
      {pending ? "Starting…" : "Start report"}
    </Button>
  );
}

/**
 * The one obvious way to begin a week: "Add weekly report" opens the report (where goals and tasks are added) for a week that is open.
 * With several open weeks the person picks one; with none the button says why, instead of hiding.
 */
export function AddWeeklyReportButton({ weeks, whyNot, businessUnitId }: { weeks: { id: string; label: string }[]; whyNot?: string; businessUnitId?: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [week, setWeek] = useState(weeks[0]?.id ?? "");
  if (weeks.length === 0) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" disabled title={whyNot}>Add weekly report</Button>
        {whyNot ? <p className="max-w-sm text-right text-xs text-muted">{whyNot}</p> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {weeks.length > 1 ? (
        <>
          <label htmlFor="add-week" className="sr-only">Week</label>
          <Select id="add-week" value={week} onChange={(e) => setWeek(e.target.value)} className="min-w-52">{weeks.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select>
        </>
      ) : <span className="text-sm text-muted">{weeks[0].label}</span>}
      <Button disabled={pending || !week}
        onClick={() => run(async () => {
          const id = await apiRequest<string>("POST", "weekly-reports", { reportingWeekId: week, businessUnitId });
          router.push(`/weekly/${id}`);
        }, { refresh: false })}>
        {pending ? "Starting…" : "Add weekly report"}
      </Button>
    </div>
  );
}
