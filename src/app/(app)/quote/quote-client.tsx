"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Modal, apiRequest, toast, useAction } from "@/components/ui/client";
import { AreaF, SelectF } from "@/components/session-notes/forms";
import type { QuoteTurn, Speaker } from "@/lib/data/quote-rota";

/** HR: pick the unit that gives the quote in a week (choosing another unit replaces an unpresented choice). */
export function AssignUnit({ weekId, current, units }: { weekId: string; current: string | null; units: { id: string; name: string }[] }) {
  const { run, pending } = useAction();
  const [bu, setBu] = useState(current ?? "");
  return (
    <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (bu) await run(() => apiRequest("POST", "quote-turns", { weekId, buId: bu }), { success: "Unit chosen. Its leads have been told." }); }}>
      <div className="min-w-[10rem] flex-1"><SelectF id={`qa-${weekId}`} label="Unit" value={bu} onChange={setBu} placeholder="Choose a unit" options={units.map((u) => [u.id, u.name] as const)} /></div>
      <Button type="submit" disabled={pending || !bu || bu === current}>{current ? "Change" : "Choose"}</Button>
    </form>
  );
}

/** The unit (or the Super Admin for it) enters the quote and who in the team said it. */
export function QuoteEntry({ turn, label }: { turn: QuoteTurn; label?: string }) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState(turn.quote ?? "");
  const [speaker, setSpeaker] = useState("");
  const [people, setPeople] = useState<Speaker[] | null>(null);
  const { run, pending } = useAction();
  useEffect(() => {
    if (!open || people) return;
    let live = true;
    apiRequest<Speaker[]>("GET", `quote-turns/speakers?bu=${turn.business_unit_id}`)
      .then((p) => { if (!live) return; setPeople(p); setSpeaker(p.find((x) => x.name === turn.speaker_name)?.id ?? ""); })
      .catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [open, people, turn.business_unit_id, turn.speaker_name]);
  if (turn.status === "PRESENTED") return null;
  return (
    <>
      <Button variant={turn.status === "SUBMITTED" ? "secondary" : "primary"} onClick={() => setOpen(true)} data-testid={`quote-entry-${turn.id}`}>{label ?? (turn.status === "SUBMITTED" ? "Change quote" : "Enter the quote")}</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Quote for ${turn.business_unit_name}`} description={`Week ${turn.week_number} ${turn.week_year}. Shown by the Presenter in the session; no approval is needed.`}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => apiRequest("PUT", `quote-turns/${turn.id}`, { quote, speakerId: speaker }), { refresh: true });
          if (r) { toast.success("Quote saved."); setOpen(false); }
        }}>
          <AreaF id="qe-quote" label="The quote" value={quote} onChange={setQuote} rows={4} max={1000} required />
          <SelectF id="qe-speaker" label="Who said it" value={speaker} onChange={setSpeaker} required placeholder={people === null ? "Loading the team…" : "Choose a team member"}
            options={(people ?? []).map((p) => [p.id, p.name] as const)} hint="Members of this unit only." />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !quote.trim() || !speaker}>{pending ? "Saving…" : "Save quote"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
