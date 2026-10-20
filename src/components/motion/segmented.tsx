"use client";

import clsx from "clsx";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";

/** A radio-style switch whose highlight slides to the chosen option. */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; size?: "sm" | "md";
}) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-xl border border-line bg-surface p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={clsx("relative rounded-[10px] font-medium", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm", on ? "text-white" : "text-ink hover:text-brand-700")}>
            {on ? <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[10px] bg-brand-700 shadow-sm" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 }} /> : null}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
