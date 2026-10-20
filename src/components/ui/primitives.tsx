import clsx from "clsx";
import { cloneElement, isValidElement } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "danger" | "ghost";
export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-3 py-1 text-sm min-h-8" : "px-4 py-2 text-sm min-h-10",
    variant === "primary" && "bg-brand-700 text-white hover:bg-brand-800",
    variant === "secondary" && "border border-line bg-panel text-ink hover:bg-surface",
    variant === "danger" && "bg-[#991b1b] text-white hover:bg-[#7f1d1d]",
    variant === "ghost" && "text-ink hover:bg-surface",
  );
}
export function Button({ variant, size, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button type="button" {...p} className={clsx(buttonClass(variant, size), className)} />;
}

// ---------------------------------------------------------------- Card
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={clsx("rounded-xl border border-line bg-panel shadow-[var(--shadow-card)]", className)} />;
}
export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Badge / status (never colour alone: always text)
const tone = {
  done: "bg-[var(--done-bg)] text-[var(--done-fg)]",
  notdone: "bg-[var(--notdone-bg)] text-[var(--notdone-fg)]",
  undefined: "bg-[var(--undef-bg)] text-[var(--undef-fg)]",
  critical: "bg-[var(--critical-bg)] text-[var(--critical-fg)]",
  locked: "bg-[var(--locked-bg)] text-[var(--locked-fg)]",
  stretch: "bg-[var(--stretch-bg)] text-[var(--stretch-fg)]",
  info: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn-fg)]",
  brand: "bg-brand-100 text-brand-800",
} as const;
export type Tone = keyof typeof tone;
export function Badge({ tone: t = "undefined", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap", tone[t])}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Forms
export const labelClass = "mb-1 block text-sm font-medium text-ink";
const fieldClass = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted disabled:bg-surface disabled:text-muted";
export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className={labelClass}>{children}</label>;
}
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={clsx(fieldClass, p.className)} />;
}
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...p} className={clsx(fieldClass, p.className)} />;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={clsx(fieldClass, p.className)} />;
}

/**
 * A labelled form control with optional help text and an error message, wired for assistive technology: the label points at the
 * control, help and error are announced with it, and an error marks the control invalid. Pass exactly one Input, Select or Textarea.
 */
export function Field({ id, label, hint, error, required, children, className }: {
  id: string; label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; className?: string;
  children: ReactElement<{ id?: string }>;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("min-w-0", className)}>
      <label htmlFor={id} className={labelClass}>{label}{required ? <span className="text-muted"> (required)</span> : null}</label>
      {isValidElement(children) ? cloneElement(children, { id, ...(describedBy ? { "aria-describedby": describedBy } : {}), ...(error ? { "aria-invalid": true } : {}), ...(required ? { required: true } : {}) } as { id: string }) : children}
      {hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Data table
export interface Column { label: string; align?: "left" | "right"; srOnly?: boolean }
/**
 * The one table layout: a scrollable wrapper (never widens the page), a screen-reader caption, a header row of real column headers,
 * and consistent cell spacing and row dividers. Put plain <tr><td> rows inside; cell padding comes from here, not from each page.
 */
export function DataTable({ caption, columns, children, className }: { caption: string; columns: Column[]; children: ReactNode; className?: string }) {
  return (
    <div className="relative max-w-full min-w-0 overflow-x-auto [contain:inline-size]" tabIndex={0} role="region" aria-label={caption}>
      <table className={clsx("w-full text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_tbody_th]:px-3 [&_tbody_th]:py-2 [&_tbody_th]:font-medium [&_tbody_th:first-child]:pl-6 [&_tbody_tr]:border-b [&_tbody_tr]:border-line [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:align-top", className)}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            {columns.map((c, i) => (
              <th key={i} scope="col" className={clsx("px-3 py-2 font-medium first:pl-6 last:pr-6", c.align === "right" && "text-right")}>
                {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Feedback
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded-lg bg-line", className)} />;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children ? <p className="max-w-md text-sm text-muted">{children}</p> : null}
      {action}
    </div>
  );
}
export function Banner({ tone: t = "info", title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  return (
    <div role="status" className={clsx("rounded-lg px-4 py-3 text-sm", tone[t])}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
export function ErrorState({ title = "Something went wrong", children }: { title?: string; children?: ReactNode }) {
  return <Banner tone="critical" title={title}>{children}</Banner>;
}

export function ScoreBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${label}: ${v.toFixed(1)} percent`}>
      <div className="h-2 flex-1 rounded-full bg-line"><div className="h-2 rounded-full bg-brand-700" style={{ width: `${v}%` }} /></div>
      <span className="w-12 text-right text-xs tabular-nums text-muted">{v.toFixed(1)}</span>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
