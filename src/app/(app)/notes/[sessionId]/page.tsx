import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { RichText } from "@/components/session-notes/common";
import { can, requireActor } from "@/lib/auth/actor";
import { getWorkspace } from "@/lib/data/session-notes";
import { SimpleNotes } from "../notes-client";

export const metadata: Metadata = { title: "Notes" };

/**
 * One notes page of a weekly session, for the two kinds of notes (ADR-133):
 *  - the official Session Notes of the week (no unit): everyone may read, only a person who writes notes for every unit may change them;
 *  - a unit's own notes (Take Notes): visible to that unit and to the roles that see every unit, changed by people who may take notes.
 * The database decides who may read and who may write (row-level security and the note functions); this page only mirrors it, so a reader is shown the text, not an editor.
 */
export default async function NotesSessionPage({ params }: PageProps<"/notes/[sessionId]">) {
  const actor = await requireActor();
  if (!can(actor, "session_notes.view")) return <Card><EmptyState title="Notes are not available for your role" /></Card>;
  const { sessionId } = await params;
  const ws = await getWorkspace(sessionId);
  if (!ws) return <Card><EmptyState title="That notes page was not found">It may belong to another unit.</EmptyState></Card>;
  const official = !ws.session.business_unit_id;
  const note = ws.notes.find((n) => n.status === "ACTIVE" && n.title === "Session notes") ?? ws.notes.find((n) => n.status === "ACTIVE");
  const canWrite = can(actor, "session_notes.create") && (!official || can(actor, "session_notes.view_all"));
  const backHref = official ? "/session-notes" : `/notes?unit=${ws.session.business_unit_id}`;
  return (
    <>
      <PageHeader title={ws.session.title}
        description={official
          ? (canWrite ? "The official notes of the session, for everyone to read. Use the headings for notes, recommendations, actions and next steps. Changes are saved as you type." : "The official notes of the session, for everyone to read. Only the people who write the session notes can change them.")
          : (canWrite ? `${ws.session.business_unit_name ?? "Your unit"}'s own notes from the session. Only this unit, and the roles that see every unit, can read them. Changes are saved as you type.` : `${ws.session.business_unit_name ?? "The unit"}'s own notes from the session. You can read them; you cannot change them.`)}
        actions={<Link className="text-sm font-medium text-brand-700 underline" href={backHref}>{official ? "Back to Session Notes" : "Back to Take Notes"}</Link>} />
      <Card className="p-4">
        {/* the note's own headings start at level 4 (## Notes), so the outline needs levels 2 and 3 above them: a screen reader hears h1, h2, h3, h4 with no gap */}
        {note ? <h2 className="sr-only">{official ? "Session notes" : "Unit notes"}</h2> : null}
        {note ? <h3 className="sr-only">Sections of the notes</h3> : null}
        {!note ? <EmptyState title="There is no notes page yet">{official ? "Go back and open the week again." : "Go back and choose the week again."}</EmptyState>
          : canWrite ? <SimpleNotes note={note} completed={ws.session.status === "COMPLETED"} backHref={backHref} />
          : <RichText md={note.content} />}
      </Card>
    </>
  );
}
