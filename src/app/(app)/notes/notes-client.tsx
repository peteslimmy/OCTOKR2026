"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import { NoteEditor } from "@/components/session-notes/note-editor";
import type { NoteRow } from "@/lib/session-notes/types";

/**
 * Opens (or finds) a notes page of a weekly session, then goes to it. With a unit it is that unit's own page (Take Notes); without one it is the official
 * Session Notes page of the week. Repeatable: it never makes a second page.
 */
export function TakeNotesButton({ weekId, buId, label }: { weekId: string; buId?: string; label: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button disabled={pending} data-testid={buId ? `take-notes-${weekId}-${buId}` : `take-notes-${weekId}`} onClick={async () => {
      const r = await run(() => apiRequest<{ session_id: string }>("POST", "notes-sessions", buId ? { weekId, buId } : { weekId }), { refresh: false });
      if (r) router.push(`/notes/${r.value.session_id}`);
    }}>{pending ? "Opening…" : label}</Button>
  );
}

/** The one rich-text page: it saves as you type. */
export function SimpleNotes({ note, completed, backHref }: { note: NoteRow; completed: boolean; backHref: string }) {
  const router = useRouter();
  return <NoteEditor simple note={note} amend={completed} onClose={() => router.push(backHref)} />;
}
