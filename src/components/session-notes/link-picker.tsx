"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, NativeSelect } from "@/components/ui/primitives";
import { apiRequest } from "@/components/ui/client";
import type { LinkOption, LinkOptions } from "@/lib/session-notes/types";

export interface PickedLink { target_type: string; target_id: string; label: string }

/**
 * Offers the current OKR components of the session's unit and week (theme, quarter, objective, key results, Sub-KRs, BU goals, the week's goals, tasks and report),
 * so nobody searches the whole structure. Choosing one only adds a reference; nothing in the OKR record changes.
 */
export function LinkPicker({ buId, weekId, onPick, exclude = [], label = "Link to an OKR component" }: {
  buId: string | null; weekId: string | null; onPick: (l: PickedLink) => void | Promise<void>; exclude?: string[]; label?: string;
}) {
  const [options, setOptions] = useState<LinkOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!buId) return;
    let live = true;
    apiRequest<LinkOptions>("GET", `okr-link-options?bu=${buId}${weekId ? `&week=${weekId}` : ""}`).then((o) => live && setOptions(o)).catch(() => live && setError("The OKR components could not be loaded."));
    return () => { live = false; };
  }, [buId, weekId]);

  const groups = useMemo(() => {
    if (!options) return [];
    const one = (o: LinkOption | null) => (o ? [o] : []);
    return [
      { name: "Strategy", items: [...one(options.theme), ...one(options.quarter), ...one(options.objective)] },
      { name: "Key results", items: options.key_results },
      { name: "Sub-KRs", items: options.sub_key_results },
      { name: "Business unit goals", items: options.bu_goals },
      { name: "This week's report", items: one(options.weekly_report) },
      { name: "Weekly goals", items: options.weekly_goals },
      { name: "Tasks", items: options.tasks },
    ].map((g) => ({ ...g, items: g.items.filter((i) => !exclude.includes(i.id)) })).filter((g) => g.items.length);
  }, [options, exclude]);

  if (!buId) return <p className="text-xs text-muted">Organisation-wide sessions link from the Strategy pages; choose a unit-specific session to link goals and tasks.</p>;
  if (error) return <p role="alert" className="text-xs text-[var(--critical-fg)]">{error}</p>;
  const all = groups.flatMap((g) => g.items);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="okr-link-select">{label}</label>
      <NativeSelect id="okr-link-select" className="max-w-xs" value={value} onChange={(e) => setValue(e.target.value)} disabled={!options}>
        <option value="">{options ? label : "Loading…"}</option>
        {groups.map((g) => <optgroup key={g.name} label={g.name}>{g.items.map((i) => <option key={i.id} value={i.id}>{i.label.length > 90 ? `${i.label.slice(0, 90)}…` : i.label}</option>)}</optgroup>)}
      </NativeSelect>
      <Button size="sm" variant="secondary" disabled={!value || busy} onClick={async () => {
        const o = all.find((x) => x.id === value);
        if (!o) return;
        setBusy(true);
        try { await onPick({ target_type: o.type, target_id: o.id, label: o.label }); setValue(""); } finally { setBusy(false); }
      }}>Link</Button>
    </div>
  );
}
