import Link from "next/link";
import { SessionStatusBadge } from "@/components/session-notes/common";
import { buttonClass, Card, CardHeader } from "@/components/ui/primitives";
import { searchSessions } from "@/lib/data/session-notes";

/**
 * Presentation Mode's door to the Session Notes workspace. It opens with the unit and the reporting week being presented as the context, lists the sessions already
 * recorded for that unit and week (there can be several), and the session workspace has a link straight back to this view. Reading this changes nothing.
 */
export async function SessionNotesLauncher({ buId, buName, weekId, canCreate }: { buId: string; buName: string; weekId: string; canCreate: boolean }) {
  const found = await searchSessions({ bu: buId, week: weekId, limit: 10 }).catch(() => null);
  if (!found) return null;
  const start = `/session-notes?bu=${buId}&week=${weekId}&new=session&from-page=presentation`;
  return (
    <Card data-testid="presentation-session-notes">
      <CardHeader title="Session notes" description={`Record the discussion, decisions and commitments for ${buName} this week.`}
        action={canCreate ? <Link className={buttonClass("primary")} href={start}>Start a session for {buName}</Link> : undefined} />
      <div className="p-4 text-sm">
        {found.rows.length === 0 ? <p className="text-muted">No session has been recorded for {buName} in this week yet.</p> : (
          <ul className="divide-y divide-line">
            {found.rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link className="font-medium text-brand-700 underline" href={`/session-notes/${s.id}?tab=notes`}>{s.title}</Link> <span className="font-mono text-xs text-muted">{s.reference}</span></span>
                <span className="flex items-center gap-3 text-xs text-muted"><SessionStatusBadge status={s.status} />{s.open_actions} open action{s.open_actions === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
