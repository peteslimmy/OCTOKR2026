"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendPoint {
  week: string; label: string; reportId: string | null;
  goals: number | null; tasks: number | null; score: number | null;
  goalsDone: number; goalsTotal: number; tasksDone: number; tasksTotal: number;
}

const SERIES = [
  { key: "goals", name: "Goals done", color: "#7a1420", dash: undefined },
  { key: "tasks", name: "Tasks done", color: "#2563eb", dash: "5 3" },
  { key: "score", name: "Weekly score", color: "#15803d", dash: "2 3" },
] as const;

/**
 * Week by week for one unit: the share of goals done against the share of tasks done (and the weekly score, which can be switched on).
 * Hover for the counts behind a point, click a legend entry to hide or show a line, click a point to open that week's report.
 */
export function WeeklyTrend({ data, currentWeek }: { data: TrendPoint[]; currentWeek?: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<string[]>(["score"]);
  const toggle = (key: string) => setHidden((h) => (h.includes(key) ? h.filter((x) => x !== key) : [...h, key]));
  if (data.length === 0) return <p className="px-6 py-8 text-center text-sm text-muted">No weeks to draw yet. Points appear as weekly reports are filed.</p>;

  return (
    <div className="px-4 py-3">
      <div className="h-72 w-full" role="img" aria-label="Line chart, week by week, of the share of goals done compared with the share of tasks done">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: -8, right: 16, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} width={48} />
            <Tooltip content={({ active, payload }) => {
              const p = (payload?.[0]?.payload ?? null) as TrendPoint | null;
              if (!active || !p) return null;
              return (
                <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-semibold">{p.label}</p>
                  <p>Goals done: <strong>{p.goals === null ? "—" : `${p.goals.toFixed(0)}%`}</strong> <span className="text-muted">({p.goalsDone} of {p.goalsTotal})</span></p>
                  <p>Tasks done: <strong>{p.tasks === null ? "—" : `${p.tasks.toFixed(0)}%`}</strong> <span className="text-muted">({p.tasksDone} of {p.tasksTotal})</span></p>
                  {p.score !== null ? <p>Weekly score: <strong>{p.score.toFixed(1)}%</strong></p> : null}
                  {p.reportId ? <p className="mt-1 text-brand-700">Click to open this week&apos;s report</p> : null}
                </div>
              );
            }} />
            <Legend iconType="circle" iconSize={8}
              onClick={(e) => toggle(String(e.dataKey))}
              formatter={(value, entry) => <span style={{ cursor: "pointer", opacity: hidden.includes(String((entry as { dataKey?: unknown }).dataKey)) ? 0.4 : 1 }}>{value}</span>} />
            {currentWeek ? <ReferenceLine x={currentWeek} stroke="var(--brand-700)" strokeDasharray="2 2" label={{ value: "this report", position: "insideTop", fontSize: 11, fill: "var(--brand-700)" }} /> : null}
            {SERIES.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.25} strokeDasharray={s.dash} hide={hidden.includes(s.key)}
                dot={{ r: 3 }} activeDot={{ r: 6, style: { cursor: "pointer" }, onClick: (_e, p) => { const id = (p as unknown as { payload?: TrendPoint }).payload?.reportId; if (id) router.push(`/weekly/${id}`); } }}
                connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-center text-xs text-muted">Hover a point for the counts. Click a legend name to hide or show a line. Click a point to open that week.</p>
    </div>
  );
}
