"use client";

import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Button } from "./primitives";

export interface Step { id: string; title: string; valid?: boolean; content: ReactNode }

/**
 * A form split into short steps that slide past one another, with a progress bar, Back and Next, and a final review step before anything
 * is sent. Next is a real submit button, so the browser still checks required and typed fields on the step being left. Enter moves on
 * instead of submitting early. Without motion (reduced-motion preference) the steps simply swap.
 */
export function StepForm({ steps, onSubmit, onCancel, submitLabel, pending }: {
  steps: Step[]; onSubmit: () => void | Promise<void>; onCancel: () => void; submitLabel: string; pending?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const reduce = useReducedMotion();
  const last = index === steps.length - 1;
  const step = steps[index];
  const go = (to: number) => { setDir(to > index ? 1 : -1); setIndex(to); };
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (last) await onSubmit(); else go(index + 1); }}>
      <ol className="flex items-center gap-2" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-1 flex-col gap-1" aria-current={i === index ? "step" : undefined}>
            <span className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <motion.span className="block h-full rounded-full bg-brand-700" initial={false} animate={{ width: i <= index ? "100%" : "0%" }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 28 }} />
            </span>
            <span className={clsx("text-xs", i === index ? "font-medium text-ink" : "text-muted")}>{i + 1}. {s.title}</span>
          </li>
        ))}
      </ol>
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div key={step.id} custom={dir} className="space-y-3 px-0.5 py-0.5"
            initial={reduce ? false : { opacity: 0, x: 36 * dir }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -36 * dir }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30, duration: 0.2 }}>
            {step.content}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <div className="flex gap-2">
          {index > 0 ? <Button variant="secondary" onClick={() => go(index - 1)}>Back</Button> : null}
          <Button type="submit" disabled={pending || step.valid === false}>{last ? (pending ? "Sending…" : submitLabel) : "Next"}</Button>
        </div>
      </div>
    </form>
  );
}

/** A label and value, for the review step. */
export function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-4 border-b border-line py-1.5 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="text-right font-medium">{children || "—"}</dd></div>;
}
