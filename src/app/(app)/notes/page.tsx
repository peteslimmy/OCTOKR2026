import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { NavSelect } from "@/components/ui/nav-select";
import { can, requireActor } from "@/lib/auth/actor";
import { activeWeeks, listBusinessUnits, recentFinalWeeks } from "@/lib/data";
import { searchSessions } from "@/lib/data/session-notes";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { TakeNotesButton } from "./notes-client";

export const metadata: Metadata = { title: "Take notes" };

/**
 * Take Notes (ADR-133): a business unit's or department's OWN notes from each weekly session. A person of a unit sees and writes only their own unit's notes; the roles that
 * see every unit (the Presenter, the Note Taker, management, the Super Admin) choose a unit. The official notes of the session, for everyone, are under Session Notes.
 * The database decides who may read and write; this page only mirrors it.
 */
export default async function NotesPage({ searchParams }: PageProps<"/notes">) {
  const actor = await requireActor();
  if (!can(actor, "session_notes.view")) return <Card><EmptyState title="Take notes is not available for your role" /></Card>;
  const sp = await searchParams;
  const requested = typeof sp.unit === "string" ? sp.unit : null;
  const seeAll = can(actor, "session_notes.view_all");
  const write = can(actor, "session_notes.create");
  const units = seeAll ? (await listBusinessUnits().catch(() => [])).filter((u) => u.status === "ACTIVE") : [];
  const unitId = seeAll ? (units.find((u) => u.id === requested)?.id ?? units.find((u) => u.id === actor.buId)?.id ?? units[0]?.id ?? null) : actor.buId;
  const unitName = seeAll ? (units.find((u) => u.id === unitId)?.name ?? null) : actor.buName;
  if (!unitId) return <Card><EmptyState title="You are not part of a unit">Take notes keeps the notes of each unit and department with that unit. Ask an administrator to place you in your unit.</EmptyState></Card>;

  const [a, b] = await Promise.all([activeWeeks().catch(() => []), recentFinalWeeks(26).catch(() => [])]);
  const weeks = [...a, ...b].filter((w, i, all) => all.findIndex((x) => x.id === w.id) === i && w.reporting_state !== "ORGANIZATION_HOLIDAY").sort((x, y) => y.week_start_at.localeCompare(x.week_start_at));
  if (weeks.length === 0) return <Card><EmptyState title="No reporting week yet">Weeks appear once a quarter is activated.</EmptyState></Card>;
  const existing = await searchSessions({ bu: unitId, limit: 100 });
  const has = new Map(existing.rows.filter((r) => r.business_unit_id === unitId && r.reporting_week_id).map((r) => [r.reporting_week_id as string, r]));

  return (
    <>
      <PageHeader title="Take notes"
        description="Take your unit's own notes from each weekly session. Only people of the unit, and the roles that see every unit, can read them. The official notes of the session, for everyone, are under Session Notes."
        actions={<Link className="text-sm font-medium text-brand-700 underline" href="/session-notes">Go to Session Notes</Link>} />
      <Card>
        <CardHeader title={unitName ? `${unitName}: weekly sessions` : "Weekly sessions"} description="One page of notes per session for the unit. It saves as you type."
          action={seeAll && units.length > 1 ? <NavSelect id="notes-unit" label="Unit" value={unitId} options={units.map((u) => ({ value: u.id, label: u.name }))} hrefBase="/notes?unit=" /> : undefined} />
        <DataTable caption="Weekly sessions" maxHeight={null} columns={[{ label: "Session" }, { label: "Notes" }, { label: "Open", srOnly: true }]}>
          {weeks.slice(0, 12).map((w) => {
            const s = has.get(w.id);
            return (
              <tr key={w.id}>
                <td className="font-medium">{formatWeekLabel(w)}</td>
                <td className="text-muted">{s ? "Started" : "Not started"}</td>
                <td className="text-right">
                  {write ? <TakeNotesButton weekId={w.id} buId={unitId} label={s ? "Continue notes" : "Take notes"} />
                    : s ? <Link className="text-sm font-medium text-brand-700 underline" href={`/notes/${s.id}`}>Read the notes</Link> : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Card>
    </>
  );
}
