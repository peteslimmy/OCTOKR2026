"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface MonthPoint { label: string; credit: number; debit: number }
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

/** Money in and money out of the fund, month by month. */
export function FundChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label={`Money in and out of the fund by month: ${data.map((d) => `${d.label} in ${naira(d.credit)}, out ${naira(d.debit)}`).join("; ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} width={44} />
          <Tooltip formatter={(v) => naira(Number(v))} />
          <Legend iconType="circle" iconSize={8} />
          <Bar dataKey="credit" name="Money in" fill="var(--done-fg)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="debit" name="Money out" fill="var(--notdone-fg)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
