import { Badge, ScoreBar } from "@/components/ui/primitives";

export interface SmartData {
  overall: number; specific: number; measurable: number; achievable: number; relevant: number; timeBound: number;
  warnings: string[]; suggestions: string[];
}

/** SMART evaluation panel: overall, five dimensions, warnings and suggestions. Guidance only (BR-GOAL-003). */
export function SmartPanel({ data }: { data: SmartData }) {
  const dims: [string, number][] = [
    ["Specific", data.specific], ["Measurable", data.measurable], ["Achievable", data.achievable], ["Relevant", data.relevant], ["Time-bound", data.timeBound],
  ];
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">SMART quality</span>
        <Badge tone={data.overall >= 70 ? "done" : data.overall >= 45 ? "warn" : "notdone"}>{data.overall.toFixed(1)}%</Badge>
      </div>
      <ul className="space-y-1">
        {dims.map(([n, v]) => (
          <li key={n} className="grid grid-cols-[96px_1fr] items-center gap-2"><span className="text-muted">{n}</span><ScoreBar value={v} label={n} /></li>
        ))}
      </ul>
      {data.warnings.length ? (
        <div><p className="font-medium">Warnings</p><ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
      ) : null}
      {data.suggestions.length ? (
        <div><p className="font-medium">Suggestions</p><ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{data.suggestions.map((w) => <li key={w}>{w}</li>)}</ul></div>
      ) : null}
      <p className="text-xs text-muted">This score is guidance only. It never blocks saving or submitting your report.</p>
    </div>
  );
}
