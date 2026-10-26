"use client";

import clsx from "clsx";
import { MoreVertical, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StaggerItem } from "@/components/motion/reveal";
import { SpringNumber } from "@/components/motion/spring-number";
import { heatState, type Cell, type Trend } from "@/lib/analytics";
import { formatPercent, type MetricKind } from "@/lib/format";

// ---------------------------------------------------------------- popover and kebab menu
function useOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onOutside(); };
    window.addEventListener("mousedown", click); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", click); window.removeEventListener("keydown", key); };
  }, [onOutside]);
  return ref;
}

/** A toolbar button that opens a small panel under it. */
export function PopoverButton({ label, icon, children, align = "right", active }: { label: string; icon?: ReactNode; children: ReactNode; align?: "left" | "right"; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={clsx("inline-flex min-h-10 items-center gap-2 rounded-xl border bg-panel px-3.5 text-sm font-medium shadow-sm hover:bg-surface", active ? "border-brand-700 text-brand-800" : "border-line text-ink")}>
        {icon}{label}
      </button>
      {open ? <div role="dialog" aria-label={label} className={clsx("absolute z-30 mt-2 w-80 max-w-[90vw] rounded-2xl border border-line bg-panel p-4 shadow-2xl", align === "right" ? "right-0" : "left-0")}>{children}</div> : null}
    </div>
  );
}

export function KebabMenu({ label, items }: { label: string; items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"><MoreVertical className="h-5 w-5" aria-hidden /></button>
      {open ? (
        <ul role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-xl border border-line bg-panel p-1 shadow-xl">
          {items.map((i) => <li key={i.label} role="none"><button type="button" role="menuitem" onClick={() => { setOpen(false); i.onClick(); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface">{i.label}</button></li>)}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- cards
/** A flat white panel with a title row, as used throughout the dashboard. */
export function Panel({ title, subtitle, action, menu, className, children, labelledBy }: {
  title: string; subtitle?: string; action?: ReactNode; menu?: { label: string; onClick: () => void }[]; className?: string; children: ReactNode; labelledBy?: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={clsx("rounded-2xl border border-line bg-panel p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)]", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h3 id={labelledBy} className="text-base font-semibold text-ink">{title}</h3>{subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}</div>
        <div className="flex items-center gap-2">{action}{menu ? <KebabMenu label={`${title} options`} items={menu} /> : null}</div>
      </div>
      {children}
    </section>
  );
}

export function TrendPill({ trend, mode }: { trend: Trend | null; mode: "relative" | "points" }) {
  if (!trend) return null;
  const Icon = trend.direction === "down" ? TrendingDown : TrendingUp;
  const text = `${Math.abs(trend.value).toFixed(1)}${mode === "relative" ? "%" : " pts"}`;
  const word = trend.direction === "flat" ? "no change" : trend.direction === "up" ? "up" : "down";
  // one calm style: the arrow shows the direction, colour is not used to judge it
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface px-2 py-1 text-xs font-medium text-muted" title={`Compared with the previous week: ${word} ${text}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{text}<span className="sr-only"> {word} compared with the previous week</span>
    </span>
  );
}

/** A figure card: one soft icon tile in the brand tint (the same on every card), a neutral trend, the label, the big number and a one-line note. */
export function StatCard({ label, value, kind = "count", trend, trendMode = "relative", footer, icon: Icon }: {
  label: string; value: number | string | null; kind?: MetricKind; trend?: Trend | null; trendMode?: "relative" | "points"; footer: string;
  icon: LucideIcon;
}) {
  return (
    <StaggerItem>
      <div className="flex h-full flex-col rounded-2xl border border-line bg-panel p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-shadow hover:shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-hidden><Icon className="h-5 w-5" /></span>
          <TrendPill trend={trend ?? null} mode={trendMode} />
        </div>
        <p className="mt-4 text-sm text-muted">{label}</p>
        <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums">
          {typeof value === "number" ? <SpringNumber value={value} kind={kind} softDecimals={kind === "percent"} /> : (value ?? "—")}
        </p>
        <p className="mt-1 text-xs text-muted">{footer}</p>
      </div>
    </StaggerItem>
  );
}

// ---------------------------------------------------------------- chart tooltip (shared by every line chart)
interface TooltipEntry { name?: string | number; value?: number | string | null; color?: string }
export function ChartTooltip({ active, payload, label, format, title }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number; format?: (v: number) => string; title?: (label: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-xl border border-line bg-white px-3.5 py-2.5 text-xs shadow-xl">
      <p className="mb-1.5 font-medium text-muted">{title ? title(String(label)) : label}</p>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.name)} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2 text-ink"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />{p.name}</span>
            <span className="font-semibold tabular-nums text-ink">{typeof p.value === "number" ? (format ? format(p.value) : p.value.toLocaleString("en-GB")) : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- intensity heat map
export type HeatMetric = "score" | "completion" | "done";
export const HEAT_METRICS: { value: HeatMetric; label: string }[] = [{ value: "score", label: "Score" }, { value: "completion", label: "Completion" }, { value: "done", label: "Tasks done" }];

function metricOf(c: Cell, m: HeatMetric): number | null {
  if (m === "score") return c.score;
  if (m === "completion") return c.tasksTotal > 0 ? (c.tasksDone / c.tasksTotal) * 100 : null;
  return c.reportsWeekly || c.tasksTotal > 0 ? c.tasksDone : null;
}
const shade = (t: number) => `color-mix(in srgb, var(--brand-700) ${Math.round(8 + 92 * Math.max(0, Math.min(1, t)))}%, white)`;

/** Units down the side, weeks across the top, colour by the chosen measure. Every square is a button; the value is printed in it. */
export function IntensityHeatmap({ cells, weeks, units, metric, onUnit }: {
  cells: Cell[]; weeks: { weekId: string; label: string }[]; units: { id: string; name: string }[]; metric: HeatMetric; onUnit: (id: string) => void;
}) {
  const index = new Map(cells.map((c) => [`${c.businessUnitId}|${c.weekId}`, c]));
  const max = metric === "done" ? Math.max(1, ...cells.map((c) => c.tasksDone)) : 100;
  const [hover, setHover] = useState<string | null>(null);
  const tip = hover ? index.get(hover) : null;
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-1 text-xs">
          <caption className="sr-only">{HEAT_METRICS.find((m) => m.value === metric)?.label} for each unit in each week</caption>
          <thead><tr><td />{weeks.map((w) => <th key={w.weekId} scope="col" className="px-0.5 pb-1 text-center font-medium text-muted">{w.label}</th>)}</tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <th scope="row" className="max-w-32 truncate pr-2 text-left font-medium text-ink"><button type="button" onClick={() => onUnit(u.id)} className="max-w-32 truncate hover:underline">{u.name}</button></th>
                {weeks.map((w) => {
                  const c = index.get(`${u.id}|${w.weekId}`);
                  if (!c) return <td key={w.weekId} />;
                  const state = heatState(c);
                  const v = metricOf(c, metric);
                  const label = state === "HOLIDAY" ? "Organisation holiday" : state === "NOT_REQUIRED" && c.tasksTotal === 0 ? "No report required" : v === null ? "Not scored yet" : metric === "done" ? `${v} tasks done` : `${v.toFixed(1)}%`;
                  const t = v === null ? 0 : v / max;
                  const text = state === "HOLIDAY" ? "H" : v === null ? "·" : metric === "done" ? String(v) : String(Math.round(v));
                  return (
                    <td key={w.weekId}>
                      <button type="button" onMouseEnter={() => setHover(`${u.id}|${w.weekId}`)} onFocus={() => setHover(`${u.id}|${w.weekId}`)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
                        onClick={() => onUnit(u.id)} aria-label={`${u.name}, week ${c.weekNumber}: ${label}${state === "MISSING" ? ", no report filed" : ""}`}
                        className={clsx("relative h-9 w-9 rounded-lg font-medium tabular-nums hover:z-10 hover:shadow-md hover:ring-2 hover:ring-brand-700", state === "HOLIDAY" && "bg-[var(--info-bg)] text-[var(--info-fg)]", v === null && state !== "HOLIDAY" && "bg-surface text-muted", t > 0.5 && state !== "HOLIDAY" && "text-white")}
                        style={state !== "HOLIDAY" && v !== null ? { background: shade(t) } : undefined}>
                        {text}
                        {state === "MISSING" ? <span aria-hidden className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[#dc2626] ring-1 ring-white" /> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 min-h-4 text-xs text-muted" aria-live="polite">
        {tip ? `${unitName.get(tip.businessUnitId)} · week ${tip.weekNumber}: ${metric === "done" ? `${tip.tasksDone} done of ${tip.tasksTotal} tasks` : metric === "completion" ? `${tip.tasksDone} of ${tip.tasksTotal} tasks done` : tip.score === null ? "not scored yet" : `score ${tip.score.toFixed(1)}%`}${heatState(tip) === "MISSING" ? " · no report filed" : ""}` : "Hover or focus a square for detail."}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted" aria-label="Legend">
        <span className="flex items-center gap-1.5">0<span className="flex gap-0.5" aria-hidden>{[0.08, 0.3, 0.5, 0.75, 1].map((t) => <span key={t} className="h-3 w-3 rounded" style={{ background: shade(t) }} />)}</span>{metric === "done" ? max : 100}{metric === "done" ? "" : "%"}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#dc2626]" aria-hidden />No report filed</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-[var(--info-bg)]" aria-hidden />Holiday</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ranked list with bars (the "active users by country" card)
export function ProgressList({ rows, onPick }: { rows: { id: string; code: string; name: string; sub: string; value: number | null }[]; onPick: (id: string) => void }) {
  return (
    <ul className="space-y-4" aria-label="Completion by unit">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onPick(r.id)} className="block w-full text-left">
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-800" aria-hidden>{r.code.slice(0, 3)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium text-ink">{r.name}</span><span className="text-sm font-semibold tabular-nums">{r.value === null ? "—" : formatPercent(r.value)}</span></span>
                <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface" aria-hidden><span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, r.value ?? 0)}%`, background: "var(--brand-600)" }} /></span>
                <span className="mt-1 block text-[11px] text-muted">{r.sub}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
