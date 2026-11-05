"use client";

import clsx from "clsx";
import { AlertCircle, Building2, Clock, MoreVertical, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StaggerItem } from "@/components/motion/reveal";
import { SpringNumber } from "@/components/motion/spring-number";
import type { Trend } from "@/lib/analytics";
import { type MetricKind } from "@/lib/format";

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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 id={labelledBy} className="text-base font-semibold text-ink">{title}</h3>{subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}</div>
        <div className="flex flex-wrap items-center gap-2">{action}{menu ? <KebabMenu label={`${title} options`} items={menu} /> : null}</div>
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

/** The dot beside a tile's label. */
/** Progress is green everywhere on these cards, the same green as a Done task. */
const GREEN = "var(--done-fg, #166534)";
const DOT: Record<string, string> = { good: "var(--done-fg, #166534)", warn: "#f59e0b", muted: "#c4c9d4", bad: "var(--critical-fg, #9f1239)" };
export interface CardTile { label: string; value: number; note: string; dot: "good" | "warn" | "muted" | "bad"; emphasis?: "bad" | "muted" }

/** A summary card: tile and label on the left, a trend pill on the right, the big figure, the period, and two tiles underneath. */
export function SummaryCard({ icon: Icon, kicker, subtitle, value, unit, trend, periodIcon: PeriodIcon, period, periodStrong, tiles }: {
  icon: LucideIcon; kicker: string; subtitle: string; value: number; unit: string; trend?: Trend | null; periodIcon: LucideIcon; period: string; periodStrong: string; tiles: [CardTile, CardTile];
}) {
  return (
    <StaggerItem>
      <div className="flex h-full flex-col gap-5 rounded-2xl border border-line bg-panel p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-shadow hover:shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--brand-700,#7a1420)_25%,white)] bg-brand-50 text-brand-700" aria-hidden><Icon className="h-5 w-5" /></span>
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{kicker}</p><p className="text-xs text-muted">{subtitle}</p></div>
          </div>
          <TrendPill trend={trend ?? null} mode="relative" />
        </div>
        <div>
          <p className="flex items-baseline gap-2"><span className="text-4xl font-bold tracking-tight tabular-nums"><SpringNumber value={value} kind="count" softDecimals={false} /></span><span className="text-sm text-muted">{unit}</span></p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><PeriodIcon className="h-3.5 w-3.5" aria-hidden />{period} · <strong className="font-semibold text-ink">{periodStrong}</strong></p>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-3">
          {tiles.map((x) => (
            <div key={x.label} className="rounded-xl border border-line bg-surface p-3.5">
              <p className="flex items-center justify-between gap-2 text-xs text-muted"><span>{x.label}</span><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[x.dot] }} aria-hidden /></p>
              <p className={clsx("mt-2 text-2xl font-semibold tabular-nums", x.emphasis === "bad" && "text-[var(--critical-fg)]", x.emphasis === "muted" && "text-muted")}><SpringNumber value={x.value} kind="count" softDecimals={false} /></p>
              <p className="mt-0.5 text-[11px] text-muted">{x.note}</p>
            </div>
          ))}
        </div>
      </div>
    </StaggerItem>
  );
}

/** Task performance against goal performance, with the number of units and the target it is measured against. */
export function PerformanceCard({ tasks, goals, units, target, subtitle, tasksOf, goalsOf }: { tasks: number | null; goals: number | null; units: number; target: number; subtitle: string; tasksOf: [number, number]; goalsOf: [number, number] }) {
  const row = (label: string, v: number | null, colour: string, dot: string, of: [number, number]) => (
    <div>
      <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden />{label}</span><span className="font-semibold tabular-nums">{v === null ? "—" : `${v.toFixed(1)}%`} <span className="text-xs font-normal text-muted">({of[0]} of {of[1]})</span></span></div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={`${label}: ${v === null ? "no figure" : `${v.toFixed(1)}%`}`}><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%`, background: colour }} /></div>
    </div>
  );
  const behind = tasks !== null && tasks < target;
  return (
    <StaggerItem>
      <div className="flex h-full flex-col gap-5 rounded-2xl border border-line bg-panel p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-shadow hover:shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--brand-700,#7a1420)_25%,white)] bg-brand-50 text-brand-700" aria-hidden><Clock className="h-5 w-5" /></span>
            <div><p className="text-sm font-semibold leading-snug">Performance: tasks against goals</p><p className="text-xs text-muted">{subtitle}</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--brand-700,#7a1420)_25%,white)] bg-brand-50 px-3 py-1.5">
            <div className="text-right"><p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-brand-700">Units shown</p><p className="text-lg font-semibold leading-tight tabular-nums">{units}</p></div>
            <Building2 className="h-4 w-4 text-brand-700" aria-hidden />
          </div>
        </div>
        <div className="space-y-5">
          {row("Tasks done", tasks, GREEN, GREEN, tasksOf)}
          {row("Goals done", goals, GREEN, "#c4c9d4", goalsOf)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-[var(--critical-fg)]"><AlertCircle className="h-3.5 w-3.5" aria-hidden />Target: {target}%</span>
          <span className="text-muted">{tasks === null ? "No figures yet" : behind ? "Behind the target" : "At or above the target"}</span>
        </div>
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
