import type { GoalView } from "@/lib/data";

const SMART_PASS = 70; // same bar the SMART evaluator uses for "no warning"
const SMART_LETTERS = [["S", "specific_score", "Specific"], ["M", "measurable_score", "Measurable"], ["A", "achievable_score", "Achievable"], ["R", "relevant_score", "Relevant"], ["T", "time_bound_score", "Time-bound"]] as const;

/** S M A R T letters for one goal, coloured like the Done / Not done badges: met at 70 or above. */
export function SmartStrip({ evaluation }: { evaluation: GoalView["evaluation"] }) {
  return (
    <span className="inline-flex shrink-0 gap-0.5" role="img" aria-label={evaluation ? SMART_LETTERS.map(([, k, n]) => `${n} ${evaluation[k] >= SMART_PASS ? "met" : "not met"}`).join(", ") : "SMART not evaluated"}>
      {SMART_LETTERS.map(([l, k, n]) => {
        const ok = evaluation ? evaluation[k] >= SMART_PASS : null;
        return <span key={l} title={`${n}${evaluation ? ` ${evaluation[k]}` : ""}`} aria-hidden
          className={`inline-flex h-5 w-5 items-center justify-center rounded-sm text-[11px] font-bold ${ok === null ? "bg-[var(--undef-bg)] text-[var(--undef-fg)]" : ok ? "bg-[var(--done-bg)] text-[var(--done-fg)]" : "bg-[var(--notdone-bg)] text-[var(--notdone-fg)]"}`}>{l}</span>;
      })}
    </span>
  );
}
