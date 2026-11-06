import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getMyQuoteTurns } from "@/lib/data/quote-rota";
import { QuoteEntry } from "./quote-client";
import { turnBadge } from "./quote-badge";

export const metadata: Metadata = { title: "Weekly quote" };

export default async function QuotePage() {
  const actor = await requireActor();
  const assign = can(actor, "quote.assign"), submit = can(actor, "quote.submit");
  if (!assign && !submit) return <Card><EmptyState title="The weekly quote is not available for your role" /></Card>;

  if (assign) redirect("/admin/calendar#quote-rota");   // the allocation is configured with the calendar

  const mine = await getMyQuoteTurns();
  return (
    <>
      <PageHeader title="Weekly quote" description={`${actor.buName ?? "Your unit"} gives the quote in the sessions below. Enter the quote and the team member who said it; the Presenter shows it in the session.`} />
      <Card>
        <CardHeader title="Your unit's turns" />
        {mine.length === 0 ? <EmptyState title="Your unit has not been chosen yet">HR will tell you when it is your turn.</EmptyState> : (
          <DataTable caption="Your unit's quote turns" maxHeight={null} columns={[{ label: "Week" }, { label: "Status" }, { label: "Quote" }, { label: "Said by" }, { label: "Enter", srOnly: true }]}>
            {mine.map((t) => (
              <tr key={t.id}>
                <td>{`Week ${t.week_number} ${t.week_year}`}{t.carried ? <p className="text-xs text-muted">Moved to the next session; nothing to redo.</p> : null}</td>
                <td>{turnBadge(t, t.carried)}</td>
                <td className="max-w-md">{t.quote ?? "—"}</td>
                <td>{t.speaker_name ?? "—"}</td>
                <td><QuoteEntry turn={t} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
