import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { activeWeeks, recentFinalWeeks } from "@/lib/data";
import { searchSessions } from "@/lib/data/session-notes";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { userClient } from "@/lib/supabase/server";
import { RichText } from "@/components/session-notes/common";
import { wat } from "@/components/status";
import { TakeNotesButton } from "../notes/notes-client";

export const metadata: Metadata = { title: "Session notes" };

interface GeneralNote { session_id: string; title: string; session_date: string; status: string; week_number: number | null; week_year: number | null; content: string; updated_at: string; author: string | null }

/**
 * The official Session Notes: the notes from each weekly session, written by the people who write them (the Presenter, the Note Taker, the Super Admin) for the whole
 * organisation. Everyone signed in can read them here. It never shows a unit's own notes: those are under Take Notes and stay with the unit (ADR-126, ADR-133).
 */
export default async function SessionNotesPage() {
  const actor = await requireActor();
  const writer = can(actor, "session_notes.create") && can(actor, "session_notes.view_all");
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_general_session_notes", { p_limit: 12 });
  const notes = ((data ?? []) as GeneralNote[]);

  let weeks: Awaited<ReturnType<typeof activeWeeks>> = [];
  const started = new Set<string>();
  if (writer) {
    const [a, b] = await Promise.all([activeWeeks().catch(() => []), recentFinalWeeks(26).catch(() => [])]);
    weeks = [...a, ...b].filter((w, i, all) => all.findIndex((x) => x.id === w.id) === i && w.reporting_state !== "ORGANIZATION_HOLIDAY").sort((x, y) => y.week_start_at.localeCompare(x.week_start_at)).slice(0, 12);
    const existing = await searchSessions({ limit: 100 });
    for (const r of existing.rows) if (!r.business_unit_id && r.reporting_week_id) started.add(r.reporting_week_id);
  }

  return (
    <>
      <PageHeader title="Session notes" description="The official notes, recommendations, actions and next steps from each weekly session, for the whole organisation. Each unit's own notes are under Take Notes and stay with the unit."
        actions={can(actor, "session_notes.view") ? <Link className="text-sm font-medium text-brand-700 underline" href="/notes">Go to Take Notes</Link> : undefined} />
      <div className="space-y-6">
        {writer && weeks.length > 0 ? (
          <Card>
            <CardHeader title="Write the session notes" description="Only the people who write the session notes see this. Choose the weekly session; everyone can then read what you write here." />
            <DataTable caption="Weekly sessions" maxHeight={null} columns={[{ label: "Session" }, { label: "Notes" }, { label: "Open", srOnly: true }]}>
              {weeks.map((w) => (
                <tr key={w.id}>
                  <td className="font-medium">{formatWeekLabel(w)}</td>
                  <td className="text-muted">{started.has(w.id) ? "Started" : "Not started"}</td>
                  <td className="text-right"><TakeNotesButton weekId={w.id} label={started.has(w.id) ? "Continue notes" : "Write the notes"} /></td>
                </tr>
              ))}
            </DataTable>
          </Card>
        ) : null}
        {error ? <Card><EmptyState title="The notes could not be loaded">Try again in a moment.</EmptyState></Card>
          : notes.length === 0 ? <Card><EmptyState title="No session notes yet">They appear here once the session notes are started for a weekly session.</EmptyState></Card>
          : notes.map((n) => (
            <Card key={n.session_id}>
              <CardHeader title={n.title} description={`${n.week_number ? `Week ${n.week_number}${n.week_year ? ` · ${n.week_year}` : ""} · ` : ""}Updated ${wat(n.updated_at)}${n.author ? ` by ${n.author}` : ""}`} />
              <div className="p-4"><RichText md={n.content} /></div>
            </Card>
          ))}
      </div>
    </>
  );
}
