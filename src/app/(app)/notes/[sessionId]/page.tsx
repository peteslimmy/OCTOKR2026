import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getWorkspace } from "@/lib/data/session-notes";
import { SimpleNotes } from "../notes-client";

export const metadata: Metadata = { title: "Take notes" };

export default async function NotesSessionPage({ params }: PageProps<"/notes/[sessionId]">) {
  const actor = await requireActor();
  if (!can(actor, "session_notes.view")) return <Card><EmptyState title="Taking notes is not available for your role" /></Card>;
  const { sessionId } = await params;
  const ws = await getWorkspace(sessionId);
  if (!ws) return <Card><EmptyState title="That notes page was not found">It may belong to another unit.</EmptyState></Card>;
  const note = ws.notes.find((n) => n.status === "ACTIVE" && n.title === "Session notes") ?? ws.notes.find((n) => n.status === "ACTIVE");
  return (
    <>
      <PageHeader title={ws.session.title} description="Write freely. Use the headings for notes, recommendations, actions and next steps. Changes are saved as you type."
        actions={<Link className="text-sm font-medium text-brand-700 underline" href="/notes">Back to the units</Link>} />
      <Card className="p-4">
        {/* the note's own headings start at level 4 (## Notes), so the outline needs levels 2 and 3 above them: a screen reader hears h1, h2, h3, h4 with no gap */}
        {note ? <h2 className="sr-only">Session notes</h2> : null}
        {note ? <h3 className="sr-only">Sections of the notes</h3> : null}
        {note ? <SimpleNotes note={note} completed={ws.session.status === "COMPLETED"} /> : <EmptyState title="There is no notes page yet">Go back and choose the unit again.</EmptyState>}
      </Card>
    </>
  );
}
