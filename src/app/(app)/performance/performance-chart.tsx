"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface WeekPoint { week: string; score: number | null; tasks: number | null; goals: number | null }

/** Weekly score against task and goal completion for the unit on screen, one point per week. */
export function PerformanceChart({ data }: { data: WeekPoint[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Line chart of weekly score, task completion and goal completion by week">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: -8, right: 16, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} width={48} />
          <Tooltip formatter={(v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`)} />
          <Legend iconType="circle" iconSize={8} />
          <Line type="monotone" dataKey="score" name="Weekly score" stroke="var(--brand-700)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="tasks" name="Tasks done" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="goals" name="Goals done" stroke="#15803d" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
