"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { formatMetric, type MetricKind } from "@/lib/format";

/**
 * A figure that springs up to its real value when it first appears and whenever it changes. The real value is what the server renders and
 * what assistive technology reads; the spring is cosmetic and is skipped entirely when reduced motion is requested.
 */
export function SpringNumber({ value, kind = "count", className, softDecimals = false }: { value: number; kind?: MetricKind; className?: string; softDecimals?: boolean }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatMetric(v, kind));
  // the whole part reads strongly and the decimals (and %) sit lighter, as in a finance dashboard
  const whole = useTransform(mv, (v) => formatMetric(v, kind).replace(/(\.\d+.*)$/, ""));
  const rest = useTransform(mv, (v) => (formatMetric(v, kind).match(/(\.\d+.*)$/)?.[1] ?? ""));
  const first = useRef(true);
  useEffect(() => {
    if (reduce || !Number.isFinite(value)) { mv.set(value); return; }
    if (first.current) { first.current = false; mv.set(0); }
    const controls = animate(mv, value, { type: "spring", stiffness: 60, damping: 16, mass: 0.9 });
    return () => controls.stop();
  }, [value, reduce, mv]);
  return (
    <span className={className}>
      {softDecimals ? <span aria-hidden><motion.span>{whole}</motion.span><motion.span className="text-muted">{rest}</motion.span></span> : <motion.span aria-hidden>{text}</motion.span>}
      <span className="sr-only">{formatMetric(value, kind)}</span>
    </span>
  );
}
