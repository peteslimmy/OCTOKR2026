import { Card, CardHeader, DataTable } from "@/components/ui/primitives";
import { can, type Actor } from "@/lib/auth/actor";
import { listBusinessUnits } from "@/lib/data";
import { getQuoteRota } from "@/lib/data/quote-rota";
import { AssignUnit, QuoteEntry } from "./quote-client";
import { turnBadge } from "./quote-badge";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

/** The weekly quote allocation, kept with the calendar: which unit gives the quote in each weekly session. */
export async function QuoteRota({ actor }: { actor: Actor }) {
  const [rota, units] = await Promise.all([getQuoteRota(), listBusinessUnits()]);
  const active = units.filter((u) => u.status === "ACTIVE").map((u) => ({ id: u.id, name: u.name }));
  const submit = can(actor, "quote.submit");
  return (
    <Card id="quote-rota">
      <CardHeader title="Weekly quote allocation" description="Choose which business unit gives the quote in each weekly session. Its leads are told, and enter the quote and who said it. If a session is skipped, the quote moves to the next session." />
      <DataTable caption="Quote rota" maxHeight={null} columns={[{ label: "Week" }, { label: "Session" }, { label: "Unit" }, { label: "Status" }, { label: "Choose the unit" }, { label: "Quote", srOnly: true }]}>
        {rota.map((r) => (
          <tr key={r.week_id}>
            <td className="whitespace-nowrap">{`Week ${r.week_number} · ${when(r.week_start_at)}`}</td>
            <td>{r.reporting_state !== "NORMAL" ? "Holiday" : r.session_outcome === "SKIPPED" ? "Skipped" : r.session_outcome === "HELD" ? "Held" : "Coming"}</td>
            <td>{r.turn?.business_unit_name ?? "—"}</td>
            <td>{turnBadge(r.turn)}</td>
            <td>{r.reporting_state === "NORMAL" && r.turn?.status !== "PRESENTED" ? <AssignUnit weekId={r.week_id} current={r.turn?.business_unit_id ?? null} units={active} /> : null}</td>
            <td>{r.turn && submit ? <QuoteEntry turn={r.turn} label={r.turn.status === "SUBMITTED" ? "Change quote" : "Enter for the unit"} /> : null}</td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}
