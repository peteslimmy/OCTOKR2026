"use client";

import { useEffect, useState } from "react";
import { Button, NativeSelect } from "@/components/ui/primitives";
import { apiRequest } from "@/components/ui/client";
import { linkTypeLabel } from "@/lib/executive-oversight/constants";
import type { LinkOption } from "@/lib/executive-oversight/types";

export interface PickedLink { target_type: string; target_id: string; label: string }

/**
 * Offers what can be linked for a unit and week: the unit's sessions, notes, decisions, actions and risks the person may read, and the OKR components.
 * Choosing one only adds a reference; nothing in the linked record changes.
 */
export function LinkPicker({ buId, weekId, onPick, exclude = [] }: { buId: string | null; weekId: string | null; onPick: (l: PickedLink) => void | Promise<void>; exclude?: string[] }) {
  const [groups, setGroups] = useState<{ group: string; options: LinkOption[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!buId) return;
    let live = true;
    apiRequest<{ group: string; options: LinkOption[] }[]>("GET", `executive-oversight/link-options?bu=${buId}${weekId ? `&week=${weekId}` : ""}`).then((g) => live && setGroups(g)).catch(() => live && setError("The records that can be linked could not be loaded."));
    return () => { live = false; };
  }, [buId, weekId]);
  if (!buId) return <p className="text-xs text-muted">Choose a business unit to see the records that can be linked.</p>;
  if (error) return <p role="alert" className="text-xs text-[var(--critical-fg)]">{error}</p>;
  const all = (groups ?? []).flatMap((g) => g.options).filter((o) => !exclude.includes(o.id));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="eo-link-select">Link a session, note, decision, action, risk or OKR component</label>
      <NativeSelect id="eo-link-select" className="max-w-sm" value={value} onChange={(e) => setValue(e.target.value)} disabled={!groups}>
        <option value="">{groups ? "Link a session, note, decision, action, risk or OKR component" : "Loading…"}</option>
        {(groups ?? []).map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.filter((o) => !exclude.includes(o.id)).map((i) => <option key={i.id} value={i.id}>{i.label.length > 90 ? `${i.label.slice(0, 90)}…` : i.label}</option>)}
          </optgroup>
        ))}
      </NativeSelect>
      <Button size="sm" variant="secondary" disabled={!value || busy} onClick={async () => {
        const o = all.find((x) => x.id === value);
        if (!o) return;
        setBusy(true);
        try { await onPick({ target_type: o.type, target_id: o.id, label: o.label }); setValue(""); } finally { setBusy(false); }
      }}>Add link</Button>
    </div>
  );
}

export function PickedChips({ links, onRemove }: { links: PickedLink[]; onRemove: (l: PickedLink) => void }) {
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Links to add">
      {links.map((l) => (
        <li key={l.target_id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink">
          <span className="text-muted">{linkTypeLabel(l.target_type)}</span> <span className="max-w-[16rem] truncate">{l.label}</span>
          <button type="button" aria-label={`Remove link to ${l.label}`} onClick={() => onRemove(l)} className="ml-0.5 rounded px-1 text-muted hover:bg-line hover:text-ink">×</button>
        </li>
      ))}
    </ul>
  );
}
