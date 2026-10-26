import type { Metadata } from "next";
import Link from "next/link";
import { watDate } from "@/components/status";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listSessions, listViolations, listViolationTypes, listActiveEmployees } from "@/lib/data/governance";
import { NewViolationButton, PayButton, ViolationTypeButton } from "./violation-actions";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { EvidenceUploadButton, EvidenceFileList } from "@/components/ui/evidence-upload";

export const metadata: Metadata = { title: "Violations" };

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));
const TONE = { OPEN: "warn", PAID: "done", DEDUCTION_RECORDED: "done" } as const;

export default async function ViolationsPage() {
  const actor = await requireActor();
  if (!can(actor, "violation.create") && !can(actor, "violation.edit") && !can(actor, "violation.payment.record")) {
    return <Card><EmptyState title="Violations are not available for your role" /></Card>;
  }
  const [rows, types, employees, sessions] = await Promise.all([listViolations(), listViolationTypes(), listActiveEmployees(), listSessions(8)]);
  const manageTypes = can(actor, "violation.edit");

  return (
    <>
      <PageHeader title="Violations and payments" description="Fines are NGN. A payment, the violation state and the violation-fund ledger credit are recorded together or not at all."
        actions={<>
          {can(actor, "violation.create") ? <NewViolationButton types={types.filter((t) => t.active)} sessions={sessions.filter((s) => s.outcome !== "SKIPPED").map((s) => ({ id: s.id, label: `${formatWeekLabel(s.reporting_weeks)} · session ${s.session_date}` }))}
            employees={employees.map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name} (${e.business_units?.name ?? ""})` }))} /> : null}
          <Link href="/governance" className="rounded-lg border border-line bg-panel px-4 py-2 text-sm">Sessions</Link>
        </>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Violation types" description="Management-controlled. Fines and criticality are copied onto each violation when it is raised; later changes affect future records only."
            action={manageTypes ? <ViolationTypeButton /> : undefined} />
          {types.length === 0 ? <EmptyState title="No violation types yet">{manageTypes ? "Define the approved violation types, criticality and default fines before raising violations." : "An HR user or Admin defines the approved violation types."}</EmptyState> : (
            <ul className="divide-y divide-line">
              {types.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                  <span><span className="font-mono text-xs text-muted">{t.code}</span> {t.name}</span>
                  <span className="flex items-center gap-2"><Badge tone={t.criticality === "CRITICAL" || t.criticality === "HIGH" ? "critical" : "warn"}>{t.criticality.toLowerCase()}</Badge>
                    <span className="tabular-nums">{money(t.default_fine)}</span>{!t.active ? <Badge tone="undefined">inactive</Badge> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={`Violations (${rows.length})`} />
          {rows.length === 0 ? <EmptyState title="No violations recorded">Use “New violation” to raise one against a staff member.</EmptyState> : (
            <div className="divide-y divide-line">
              {rows.map((v) => (
                <div key={v.id} className="px-6 py-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{v.employee_name}</p>
                      <p className="text-xs text-muted">{v.business_unit} · {watDate(v.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={TONE[v.status]}>{v.status === "OPEN" ? "Open" : v.status === "PAID" ? "Paid" : "Deducted from salary"}</Badge>
                      <span className="tabular-nums font-medium">{money(v.fine_amount)}</span>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 text-sm">
                    <div><span className="text-muted">Type:</span> {v.type}{v.override_reason ? <p className="text-xs text-muted">Fine overridden: {v.override_reason}</p> : null}</div>
                    <div><span className="text-muted">Criticality:</span> {v.criticality.toLowerCase()}</div>
                    <div className="flex items-center gap-2">
                      {v.status === "OPEN" && can(actor, "violation.payment.record") ? <PayButton id={v.id} amount={money(v.fine_amount)} /> : null}
                      {can(actor, "violation.edit") ? <EvidenceUploadButton entityType="VIOLATION" entityId={v.id} label="Attach evidence" /> : null}
                    </div>
                  </div>
                  {v.status === "OPEN" && (v.reversed_payments ?? 0) > 0 ? <p className="text-xs text-muted">Reopened: an earlier payment was reversed in the ledger.</p> : null}
                  {v.payment ? <p className="text-xs text-muted">Ref {v.payment.reference}</p> : null}
                  <EvidenceFileList files={v.evidence_files || []} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
