"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Modal, apiRequest, toast, useAction, useOpenOnNew } from "@/components/ui/client";
import { AreaF, PersonF, SelectF, TextF } from "@/components/session-notes/forms";
import { newKey, usePeople } from "@/components/session-notes/common";

export interface Option { id: string; label: string }

/**
 * Starts a session. The unit and reporting week default to the ones the person was looking at (for example in Presentation Mode) and can be changed; a session may also have
 * no reporting week. Creating one is a single request carrying a key, so a double click never makes two.
 */
export function NewSessionDialog({ types, units, weeks, defaultBu, defaultWeek, lockedUnit, me, fromPresentation }: {
  types: Option[]; units: Option[]; weeks: Option[]; defaultBu: string | null; defaultWeek: string | null; lockedUnit: boolean; me: string; fromPresentation: boolean;
}) {
  const router = useRouter();
  const startsOpen = useOpenOnNew("session");
  const [open, setOpen] = useState(startsOpen);
  const { run, pending } = useAction();
  const { people } = usePeople();
  const [title, setTitle] = useState("");
  const [type, setType] = useState(types[0]?.id ?? "");
  const [bu, setBu] = useState(defaultBu ?? "");
  const [week, setWeek] = useState(defaultWeek ?? "");
  const [date, setDate] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 10));
  const [facilitator, setFacilitator] = useState(me);
  const [description, setDescription] = useState("");
  const [agenda, setAgenda] = useState("");
  const [attempt] = useState(newKey);
  const unitLabel = units.find((u) => u.id === bu)?.label;
  const weekLabel = weeks.find((w) => w.id === week)?.label;

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-session">Start a session</Button>
      <Modal open={open} onOpenChange={setOpen} title="Start an OKR session" description={fromPresentation && unitLabel ? `For ${unitLabel}${weekLabel ? `, ${weekLabel}` : ""} (from Presentation mode).` : "Record the discussion, decisions and commitments of an OKR review."}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => apiRequest<{ id: string }>("POST", "okr-sessions", {
            title: title.trim() || `${types.find((t) => t.id === type)?.label ?? "OKR session"}${unitLabel ? ` — ${unitLabel}` : ""}`, typeId: type, date, weekId: week || undefined, buId: bu || undefined,
            facilitatorId: facilitator || undefined, description: description.trim() || undefined, agenda: agenda.trim() || undefined, key: attempt,
          }), { refresh: false });
          if (r) { toast.success("Session created."); setOpen(false); router.push(`/session-notes/${r.value.id}${fromPresentation ? "?tab=notes" : ""}`); }
        }}>
          <TextF id="ns-title" label="Title" value={title} onChange={setTitle} max={200} placeholder="Leave empty to use the type and unit" />
          <SelectF id="ns-type" label="Session type" value={type} onChange={setType} required options={types.map((t) => [t.id, t.label] as const)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectF id="ns-bu" label="Business unit" value={bu} onChange={setBu} placeholder={lockedUnit ? undefined : "Organisation-wide"} options={units.map((u) => [u.id, u.label] as const)} />
            <SelectF id="ns-week" label="Reporting week" value={week} onChange={setWeek} placeholder="No reporting week" options={weeks.map((w) => [w.id, w.label] as const)} hint="Optional. Several sessions may share a unit and week." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextF id="ns-date" label="Session date" type="date" value={date} onChange={setDate} required />
            <PersonF id="ns-fac" label="Facilitator" people={people} value={facilitator} onChange={setFacilitator} unit={bu || null} placeholder="Me" />
          </div>
          <AreaF id="ns-desc" label="Description" value={description} onChange={setDescription} max={4000} />
          <AreaF id="ns-agenda" label="Agenda" value={agenda} onChange={setAgenda} rows={4} max={20000} hint="Optional. Lists and headings work as in notes." />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !type || !date}>{pending ? "Creating…" : "Create session"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
