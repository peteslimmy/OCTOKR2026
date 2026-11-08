"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export type StripWeek = { id: string; label: string; holiday: boolean };

/** One row of weeks that scrolls sideways, however many there are. The chosen week is brought into view and the arrows step through the row. */
export function WeekStrip({ weeks, currentId, view }: { weeks: StripWeek[]; currentId: string; view?: "quote" }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => { row.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" }); }, [currentId]);
  const step = (dir: -1 | 1) => row.current?.scrollBy({ left: dir * Math.max(240, (row.current?.clientWidth ?? 600) * 0.7), behavior: "smooth" });
  const arrow = "shrink-0 rounded-full border border-line bg-panel px-2.5 py-1 text-sm hover:bg-surface";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button type="button" className={arrow} onClick={() => step(-1)} aria-label="Scroll to newer weeks">‹</button>
      <div ref={row} role="navigation" aria-label="Reporting weeks" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1.5">
        {weeks.map((w) => (
          <Link key={w.id} href={`/presentation?week=${w.id}${view ? `&view=${view}` : ""}`} aria-current={w.id === currentId ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm ${w.id === currentId ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel"}`}>
            {w.label}{w.holiday ? " (holiday)" : ""}
          </Link>
        ))}
      </div>
      <button type="button" className={arrow} onClick={() => step(1)} aria-label="Scroll to older weeks">›</button>
    </div>
  );
}
