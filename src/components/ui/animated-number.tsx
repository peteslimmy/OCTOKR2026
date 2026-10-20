"use client";

import { useEffect, useRef, useState } from "react";
import { easeOut, formatMetric, type MetricKind } from "@/lib/format";

const DURATION_MS = 700;

/**
 * A figure that counts up to its real value when it first appears. The real value is what the server renders and what assistive
 * technology reads, so nothing depends on the animation: with reduced motion requested, or before scripts run, the final figure is
 * simply there. The animation is cosmetic and never changes the number shown at rest.
 */
export function AnimatedNumber({ value, kind = "count", className }: { value: number; kind?: MetricKind; className?: string }) {
  const [animated, setAnimated] = useState<number | null>(null);   // null = show the real value
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const from = previous.current ?? 0;
    previous.current = value;
    if (from === value || !Number.isFinite(value) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / DURATION_MS;
      if (t >= 1) { setAnimated(null); return; }
      setAnimated(from + (value - from) * easeOut(t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={className}>
      <span aria-hidden>{formatMetric(animated ?? value, kind)}</span>
      <span className="sr-only">{formatMetric(value, kind)}</span>
    </span>
  );
}
