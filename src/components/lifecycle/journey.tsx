import { Badge } from "@/components/ui/primitives";
import type { JourneyEvent, Movement } from "@/lib/data/lifecycle";

const date = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(d.length === 10 ? `${d}T12:00:00+01:00` : d));

export function describeEvent(e: Pick<JourneyEvent, "event_type" | "from_bu" | "to_bu" | "role_name" | "promotion"> & { role_code?: string | null }): { title: string; tone: "brand" | "done" | "warn" | "critical" | "info" | "undefined" } {
  switch (e.event_type) {
    case "JOINED": return { title: `Joined ${e.to_bu ?? "the organisation"}`, tone: "info" };
    case "SIGN_IN_CREATED": return { title: "Sign-in created", tone: "undefined" };
    case "TRANSFERRED": return { title: `Moved from ${e.from_bu ?? "another unit"} to ${e.to_bu ?? "another unit"}`, tone: "brand" };
    case "ROLE_GRANTED": return { title: e.promotion ? `Promoted: became ${e.role_name ?? e.role_code}` : `Given the role ${e.role_name ?? e.role_code}`, tone: e.promotion ? "done" : "info" };
    case "ROLE_REMOVED": return { title: `No longer ${e.role_name ?? e.role_code}`, tone: "warn" };
    case "DEACTIVATED": return { title: "Made inactive", tone: "critical" };
    case "REACTIVATED": return { title: "Made active again", tone: "done" };
    case "SUSPENDED": return { title: "Sign-in suspended", tone: "critical" };
    case "RESTORED": return { title: "Sign-in restored", tone: "done" };
    default: return { title: e.event_type, tone: "undefined" };
  }
}

/** A person's journey, newest first: what changed, when it took effect, who did it and why. History is never edited. */
export function JourneyTimeline({ events }: { events: JourneyEvent[] }) {
  if (!events.length) return <p className="p-6 text-sm text-muted">No journey has been recorded for this person yet.</p>;
  return (
    <ol className="space-y-3 p-6" aria-label="Journey">
      {[...events].reverse().map((e) => {
        const d = describeEvent(e);
        return (
          <li key={e.id} className="rounded-lg border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={d.tone}>{d.title}</Badge><span className="text-xs text-muted">effective {date(e.effective_date)}</span></div>
            {e.reason ? <p className="mt-1">Reason: {e.reason}</p> : null}
            <p className="mt-1 text-xs text-muted">
              {e.source === "BACKFILL" ? "Recorded when journeys were introduced (the date shown is when the record was created)." : e.actor ? `By ${e.actor}.` : "Recorded by the system."} Logged {date(e.occurred_at)}.
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function MovementsList({ rows }: { rows: Movement[] }) {
  if (!rows.length) return <p className="p-6 text-sm text-muted">No moves or role changes have been recorded yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const d = describeEvent(r);
        return (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm">
            <span><a className="font-medium text-brand-700 underline" href={`/admin/people/${r.employee_id}`}>{r.name}</a> <Badge tone={d.tone}>{d.title}</Badge></span>
            <span className="text-xs text-muted">{date(r.effective_date)}{r.actor ? ` · ${r.actor}` : ""}{r.reason ? ` · ${r.reason.slice(0, 80)}` : ""}</span>
          </li>
        );
      })}
    </ul>
  );
}
