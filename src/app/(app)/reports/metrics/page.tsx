import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { METRICS, METRICS_VERSION } from "@/lib/reports/metrics";

export const metadata: Metadata = { title: "Metric definitions" };

export default async function MetricsPage() {
  const actor = await requireActor();
  if (!actor.permissions.has("reports.view")) return <Card><EmptyState title="Reports are not available for your role" /></Card>;
  return (
    <>
      <PageHeader title="Metric definitions" description={`The single source of truth for every figure in Reports (${METRICS_VERSION}). Official metrics are read from the scoring engine and ledger; derived metrics are arithmetic on those; proposed metrics await business approval.`}
        actions={<Link href="/reports" className={buttonClass("secondary", "sm")}>All reports</Link>} />
      <div className="space-y-4">
        {METRICS.map((m) => (
          <Card key={m.id} className="p-6" id={m.id}>
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">{m.name} <Badge tone={m.status === "OFFICIAL" ? "done" : m.status === "DERIVED" ? "info" : "warn"}>{m.status === "PENDING_APPROVAL" ? "Pending approval" : m.status === "OFFICIAL" ? "Official" : "Derived"}</Badge></h2>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[170px_1fr]">
              <dt className="text-muted">Definition</dt><dd>{m.definition}</dd>
              <dt className="text-muted">Formula</dt><dd>{m.formula}</dd>
              {m.numerator ? <><dt className="text-muted">Numerator</dt><dd>{m.numerator}</dd></> : null}
              {m.denominator ? <><dt className="text-muted">Denominator</dt><dd>{m.denominator}</dd></> : null}
              <dt className="text-muted">Unit</dt><dd>{m.unit}</dd>
              <dt className="text-muted">Source</dt><dd>{m.source}</dd>
              <dt className="text-muted">Aggregation</dt><dd>{m.aggregation}</dd>
              <dt className="text-muted">Missing or excluded data</dt><dd>{m.nullRules}</dd>
              <dt className="text-muted">Caveats</dt><dd>{m.caveats.join(" ")}</dd>
              <dt className="text-muted">Version</dt><dd>{m.version}</dd>
            </dl>
          </Card>
        ))}
      </div>
    </>
  );
}
