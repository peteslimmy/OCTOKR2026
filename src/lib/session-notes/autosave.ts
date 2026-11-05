import { AUTOSAVE_RETRY_MS } from "./constants";

// The save-state rules of the note editor, kept apart from the component so they can be tested.

export type SaveState = "saved" | "dirty" | "saving" | "failed" | "retrying" | "conflict";

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", failed: "Save failed", retrying: "Retrying save…", conflict: "Changed by someone else",
};

/** Whether leaving the page now could lose what was typed. */
export const needsLeaveGuard = (s: SaveState) => s === "dirty" || s === "saving" || s === "failed" || s === "retrying" || s === "conflict";

/** Seconds-scale pause before retry number `attempt` (0-based) after a failed save; null once the automatic retries are used up. */
export const retryDelay = (attempt: number): number | null => (attempt < AUTOSAVE_RETRY_MS.length ? AUTOSAVE_RETRY_MS[attempt] : null);

/** A failure worth retrying: no answer at all (the network), a timeout or a server problem. A refusal or a conflict is not retried. */
export function isTransient(e: unknown): boolean {
  if (e instanceof TypeError) return true;                                           // fetch could not reach the server
  const f = e as { status?: number; code?: string } | null;
  if (!f || typeof f.status !== "number") return true;
  return f.status >= 500 || f.status === 408 || f.status === 429;
}

export interface Draft { title: string; category: string; visibility: string; content: string; baseVersion: number; at: string }
export const draftStorageKey = (noteId: string) => `okr-note-draft:${noteId}`;

export function readDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.content !== "string" || typeof d.baseVersion !== "number" || typeof d.at !== "string") return null;
    return { title: String(d.title ?? ""), category: String(d.category ?? ""), visibility: String(d.visibility ?? ""), content: d.content, baseVersion: d.baseVersion, at: d.at };
  } catch { return null; }
}
