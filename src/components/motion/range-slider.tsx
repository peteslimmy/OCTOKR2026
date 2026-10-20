"use client";

import { useId } from "react";

/**
 * Two handles on one track, for choosing a first and last item (here: weeks). Built from two native range inputs so the keyboard,
 * screen readers and touch all work without custom code; the filled part between them is drawn behind.
 */
export function RangeSlider({ min, max, from, to, onChange, label, format }: {
  min: number; max: number; from: number; to: number; onChange: (from: number, to: number) => void; label: string; format: (i: number) => string;
}) {
  const id = useId();
  const span = Math.max(1, max - min);
  const lo = ((Math.min(from, to) - min) / span) * 100;
  const hi = ((Math.max(from, to) - min) / span) * 100;
  return (
    <div className="min-w-56 flex-1" role="group" aria-label={label}>
      <div className="mb-1 flex justify-between text-xs text-muted"><span>{label}</span><span className="font-medium text-ink">{format(Math.min(from, to))} – {format(Math.max(from, to))}</span></div>
      <div className="range-dual relative h-6">
        <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-line" aria-hidden />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-700" style={{ left: `${lo}%`, width: `${Math.max(0, hi - lo)}%` }} aria-hidden />
        <input id={`${id}-from`} type="range" aria-label={`${label}: first`} aria-valuetext={format(from)} min={min} max={max} step={1} value={from} onChange={(e) => onChange(Number(e.target.value), to)} />
        <input id={`${id}-to`} type="range" aria-label={`${label}: last`} aria-valuetext={format(to)} min={min} max={max} step={1} value={to} onChange={(e) => onChange(from, Number(e.target.value))} />
      </div>
    </div>
  );
}
