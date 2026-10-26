"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/components/ui/client";
import { Card, CardHeader, ScoreBar, Badge, EmptyState } from "@/components/ui/primitives";
import { formatPercent } from "@/lib/format";
import { wat, watDate } from "@/components/status";

interface SubKrExecutionWeek {
  key_result_id: string;
  kr_code: string;
  kr_title: string;
  kr_sequence: number;
  sub_key_result_id: string;
  sub_code: string;
  sub_title: string;
  sub_sequence: number;
  reporting_week_id: string;
  week_number: number;
  week_start_at: string;
  mapped_goals: number;
  done_goals: number;
}

interface SubKrSummary {
  sub_key_result_id: string;
  kr_code: string;
  kr_title: string;
  sub_code: string;
  sub_title: string;
  total_mapped_goals: number;
  total_done_goals: number;
  overall_execution: number | null;
  weekly_trend: "improving" | "declining" | "stable" | null;
  last_week_execution: number | null;
}

async function fetchSubKrExecution(quarterId: string): Promise<SubKrExecutionWeek[]> {
  const result = await apiRequest<{ data: SubKrExecutionWeek[] }>("GET", `reports/kr-execution?quarterId=${encodeURIComponent(quarterId)}`);
  return result.data;
}

function computeSummaries(weeks: SubKrExecutionWeek[]): SubKrSummary[] {
  const bySubKr = new Map<string, SubKrExecutionWeek[]>();
  for (const w of weeks) {
    const key = w.sub_key_result_id;
    if (!bySubKr.has(key)) bySubKr.set(key, []);
    bySubKr.get(key)!.push(w);
  }

  const summaries: SubKrSummary[] = [];
  for (const [subId, entries] of bySubKr) {
    entries.sort((a, b) => new Date(a.week_start_at).getTime() - new Date(b.week_start_at).getTime());

    const totalMapped = entries.reduce((sum, e) => sum + e.mapped_goals, 0);
    const totalDone = entries.reduce((sum, e) => sum + e.done_goals, 0);
    const overallExecution = totalMapped > 0 ? (totalDone / totalMapped) * 100 : null;

    const lastEntry = entries[entries.length - 1];
    const lastWeekExecution = lastEntry.mapped_goals > 0 ? (lastEntry.done_goals / lastEntry.mapped_goals) * 100 : null;

    const prevEntry = entries[entries.length - 2];
    const prevWeekExecution = prevEntry?.mapped_goals > 0 ? (prevEntry.done_goals / prevEntry.mapped_goals) * 100 : null;

    let trend: "improving" | "declining" | "stable" | null = null;
    if (lastWeekExecution !== null && prevWeekExecution !== null) {
      if (lastWeekExecution > prevWeekExecution + 1) trend = "improving";
      else if (lastWeekExecution < prevWeekExecution - 1) trend = "declining";
      else trend = "stable";
    }

    summaries.push({
      sub_key_result_id: subId,
      kr_code: entries[0].kr_code,
      kr_title: entries[0].kr_title,
      sub_code: entries[0].sub_code,
      sub_title: entries[0].sub_title,
      total_mapped_goals: totalMapped,
      total_done_goals: totalDone,
      overall_execution: overallExecution,
      weekly_trend: trend,
      last_week_execution: lastWeekExecution,
    });
  }

  // Sort by KR sequence then Sub-KR sequence
  summaries.sort((a, b) => {
    const akr = weeks.find((w) => w.sub_key_result_id === a.sub_key_result_id)?.kr_sequence ?? 0;
    const bkr = weeks.find((w) => w.sub_key_result_id === b.sub_key_result_id)?.kr_sequence ?? 0;
    if (akr !== bkr) return akr - bkr;
    const asub = weeks.find((w) => w.sub_key_result_id === a.sub_key_result_id)?.sub_sequence ?? 0;
    const bsub = weeks.find((w) => w.sub_key_result_id === b.sub_key_result_id)?.sub_sequence ?? 0;
    return asub - bsub;
  });

  return summaries;
}

export function SubKrContributionCard({ quarterId }: { quarterId: string }) {
  const [summaries, setSummaries] = useState<SubKrSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const weeks = await fetchSubKrExecution(quarterId);
        if (!cancelled) {
          setSummaries(computeSummaries(weeks));
        }
      } catch (e) {
        if (!cancelled) setError("Failed to load Sub-KR contribution");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [quarterId]);

  if (loading) {
    return (
      <Card>
        <CardHeader title="Sub-KR contribution" description="Goals tagged to each Sub-KR and their execution trend" />
        <div className="px-6 py-4 text-sm text-muted">Loading…</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader title="Sub-KR contribution" description="Goals tagged to each Sub-KR and their execution trend" />
        <div className="px-6 py-4 text-sm text-[var(--critical-fg)]">{error}</div>
      </Card>
    );
  }

  if (summaries.length === 0) {
    return (
      <Card>
        <CardHeader title="Sub-KR contribution" description="Goals tagged to each Sub-KR and their execution trend" />
        <EmptyState title="No Sub-KR execution data yet" />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Sub-KR contribution" description="Goals tagged to each Sub-KR and their execution trend (read-only view; not a stored score)" />
      <div className="space-y-3 px-6 py-4">
        {summaries.map((s) => (
          <div key={s.sub_key_result_id} className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{s.kr_code} → {s.sub_code}</span>
                <span className="text-sm text-muted">{s.kr_title} → {s.sub_title}</span>
              </div>
              <div className="flex items-center gap-2">
                {s.overall_execution !== null && (
                  <Badge tone={s.overall_execution >= 80 ? "done" : s.overall_execution >= 50 ? "info" : "warn"}>
                    {formatPercent(s.overall_execution)}
                  </Badge>
                )}
                {s.last_week_execution !== null && (
                  <Badge tone={s.last_week_execution >= 80 ? "done" : s.last_week_execution >= 50 ? "info" : "warn"}>
                    This week {formatPercent(s.last_week_execution)}
                  </Badge>
                )}
                {s.weekly_trend && (
                  <Badge tone={s.weekly_trend === "improving" ? "done" : s.weekly_trend === "declining" ? "critical" : "info"} >
                    {s.weekly_trend === "improving" ? "↑ Improving" : s.weekly_trend === "declining" ? "↓ Declining" : "→ Stable"}
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-xs text-muted">
              {s.total_done_goals} / {s.total_mapped_goals} goals done overall
              {s.overall_execution !== null && ` (${formatPercent(s.overall_execution)} execution)`}
            </div>
            {s.overall_execution !== null && (
              <ScoreBar value={s.overall_execution} label={`${s.sub_code} overall execution`} />
            )}
          </div>
        ))}
        <p className="text-xs text-muted">
          Execution = done mapped goals ÷ total mapped goals in finalised, submitted reports. This measures goal execution, not KR outcome attainment.
        </p>
      </div>
    </Card>
  );
}
