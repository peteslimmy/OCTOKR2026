"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export interface NavOption { value: string; label: string; group?: string }

/**
 * A filter that changes the page: a labelled drop-down that navigates when a choice is made. It replaces rows of tabs when there are
 * many choices (every quarter, every unit): one control instead of a wall of buttons, and the browser's own type-ahead works in it.
 * `hrefBase` is the address up to and including the query parameter, for example "/strategy?quarter=" (a plain string, because a server
 * page cannot hand a function to a client component).
 */
export function NavSelect({ id, label, value, options, hrefBase }: { id: string; label: string; value: string; options: NavOption[]; hrefBase: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();   // the page stays on screen while the new choice loads
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium text-muted">{label}</label>
      <select id={id} value={value} onChange={(e) => start(() => router.push(hrefBase + encodeURIComponent(e.target.value), { scroll: false }))} aria-busy={pending} disabled={pending}
        className="min-w-52 rounded-lg disabled:opacity-60 border border-line bg-panel px-3 py-1.5 text-sm text-ink focus:border-brand-700">
        {groups.map((g) => {
          const items = options.filter((o) => (o.group ?? "") === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>);
          return g ? <optgroup key={g} label={g}>{items}</optgroup> : items;
        })}
      </select>
    </div>
  );
}
