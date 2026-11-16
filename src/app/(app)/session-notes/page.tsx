import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { RichText } from "@/components/session-notes/common";
import { wat } from "@/components/status";

export const metadata: Metadata = { title: "Session notes" };

interface GeneralNote { session_id: string; title: string; session_date: string; status: string; week_number: number | null; week_year: number | null; content: string; updated_at: string; author: string | null }

/**
 * The general note from each weekly session, written by the Note Taker for the whole organisation. Everyone signed in can read it here: it never
 * shows a unit's own notes (those stay with the unit, and with the roles that see every unit).
 */
export default async function SessionNotesPage() {
  await requireActor();
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_general_session_notes", { p_limit: 12 });
  const notes = ((data ?? []) as GeneralNote[]);
  return (
    <>
      <PageHeader title="Session notes" description="The notes, recommendations, actions and next steps from each weekly session, for the whole organisation. Each unit's own notes are kept with that unit." />
      {error ? <Card><EmptyState title="The notes could not be loaded">Try again in a moment.</EmptyState></Card>
        : notes.length === 0 ? <Card><EmptyState title="No session notes yet">They appear here once the Note Taker starts a weekly session.</EmptyState></Card>
        : (
          <div className="space-y-6">
            {notes.map((n) => (
              <Card key={n.session_id}>
                <CardHeader title={n.title} description={`${n.week_number ? `Week ${n.week_number}${n.week_year ? ` · ${n.week_year}` : ""} · ` : ""}Updated ${wat(n.updated_at)}${n.author ? ` by ${n.author}` : ""}`} />
                <div className="p-4"><RichText md={n.content} /></div>
              </Card>
            ))}
          </div>
        )}
    </>
  );
}
