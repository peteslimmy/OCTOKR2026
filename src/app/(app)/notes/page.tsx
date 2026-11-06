import type { Metadata } from "next";
import { Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { activeWeeks, recentFinalWeeks } from "@/lib/data";
import { searchSessions } from "@/lib/data/session-notes";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { TakeNotesButton } from "./notes-client";

export const metadata: Metadata = { title: "Take notes" };

export default async function NotesPage(_props: PageProps<"/notes">) {
  const actor = await requireActor();
  if (!can(actor, "session_notes.create")) return <Card><EmptyState title="Taking notes is not available for your role" /></Card>;
  const [a, b] = await Promise.all([activeWeeks().catch(() => []), recentFinalWeeks(26).catch(() => [])]);
  const weeks = [...a, ...b].filter((w, i, all) => all.findIndex((x) => x.id === w.id) === i && w.reporting_state !== "ORGANIZATION_HOLIDAY").sort((x, y) => y.week_start_at.localeCompare(x.week_start_at));
  if (weeks.length === 0) return <Card><EmptyState title="No reporting week yet">Weeks appear once a quarter is activated.</EmptyState></Card>;
  const existing = await searchSessions({ limit: 100 });
  const has = new Map(existing.rows.filter((r) => !r.business_unit_id && r.reporting_week_id).map((r) => [r.reporting_week_id as string, r]));

  return (
    <>
      <PageHeader title="Take notes" description="Choose the weekly session, then write the minutes: notes, recommendations, actions and next steps, for the whole organisation in one central page. It saves as you type." />
      <Card>
        <CardHeader title="Weekly sessions" description="One set of minutes per session, kept in one place." />
        <DataTable caption="Weekly sessions" maxHeight={null} columns={[{ label: "Session" }, { label: "Minutes" }, { label: "Open", srOnly: true }]}>
          {weeks.slice(0, 12).map((w) => (
            <tr key={w.id}>
              <td className="font-medium">{formatWeekLabel(w)}</td>
              <td className="text-muted">{has.get(w.id) ? "Started" : "Not started"}</td>
              <td className="text-right"><TakeNotesButton weekId={w.id} label={has.get(w.id) ? "Continue notes" : "Take notes"} /></td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
