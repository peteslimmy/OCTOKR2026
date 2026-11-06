"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import { NoteEditor } from "@/components/session-notes/note-editor";
import type { NoteRow } from "@/lib/session-notes/types";

/** Opens (or finds) the organisation-wide minutes page of a weekly session, then goes to it. Repeatable: it never makes a second page. */
export function TakeNotesButton({ weekId, label }: { weekId: string; label: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <Button disabled={pending} data-testid={`take-notes-${weekId}`} onClick={async () => {
      const r = await run(() => apiRequest<{ session_id: string }>("POST", "notes-sessions", { weekId }), { refresh: false });
      if (r) router.push(`/notes/${r.value.session_id}`);
    }}>{pending ? "Opening…" : label}</Button>
  );
}

/** The one rich-text page: it saves as you type. */
export function SimpleNotes({ note, completed }: { note: NoteRow; completed: boolean }) {
  const router = useRouter();
  return <NoteEditor simple note={note} amend={completed} onClose={() => router.push("/notes")} />;
}
