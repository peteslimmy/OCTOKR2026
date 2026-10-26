import type { Metadata } from "next";
import Link from "next/link";
import { watDate } from "@/components/status";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listSessions, listViolations, listViolationTypes, listActiveEmployees } from "@/lib/data/governance";
import { NewViolationButton, PayButton, ViolationTypeButton, VoidButton } from "./violation-actions";
import { NavSelect } from "@/components/ui/nav-select";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { EvidenceUploadButton, EvidenceFileList } from "@/components/ui/evidence-upload";

export const metadata: Metadata = { title: "Violations" };

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));
const TONE = { OPEN: "warn", PAID: "done", DEDUCTION_RECORDED: "done", VOID: "undefined" } as const;
const STATUS_LABEL = { OPEN: "Pending payment", PAID: "Paid", DEDUCTION_RECORDED: "Deducted from salary", VOID: "Void" } as const;
const FILTERS = [{ value: "all", label: "All violations" }, { value: "OPEN", label: "Pending payment" }, { value: "PAID", label: "Paid (incl. salary deduction)" }, { value: "VOID", label: "Void" }];

export default async function ViolationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusParam } = await searchParams;
  const filter = FILTERS.some((f) => f.value === statusParam) ? statusParam! : "all";
  const actor = await requireActor();
  if (!can(actor, "violation.create") && !can(actor, "violation.edit") && !can(actor, "violation.payment.record")) {
    return <Card><EmptyState title="Violations are not available for your role" /></Card>;
  }
  const [rows, types, employees, sessions] = await Promise.all([listViolations(), listViolationTypes(), listActiveEmployees(), listSessions(8)]);
  const manageTypes = can(actor, "violation.edit");
  const shown = rows.filter((v) => filter === "all" || (filter === "PAID" ? v.status === "PAID" || v.status === "DEDUCTION_RECORDED" : v.status === filter));

  return (
    <>
      <PageHeader title="Violations and payments" description="Fines are NGN. A payment, the violation state and the violation-fund ledger credit are recorded together or not at all."
        actions={<>
          {can(actor, "violation.create") ? <NewViolationButton types={types.filter((t) => t.active)} sessions={sessions.filter((s) => s.outcome !== "SKIPPED").map((s) => ({ id: s.id, label: `${formatWeekLabel(s.reporting_weeks)} · session ${s.session_date}` }))}
            employees={employees.map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name}`, businessUnit: e.business_units?.name ?? "", email: e.email ?? "" }))} /> : null}
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
                  <span>{t.name}</span>
                  <span className="flex items-center gap-2"><Badge tone={t.criticality === "CRITICAL" || t.criticality === "HIGH" ? "critical" : "warn"}>{t.criticality.toLowerCase()}</Badge>
                    <span className="tabular-nums">{money(t.default_fine)}</span>{!t.active ? <Badge tone="undefined">inactive</Badge> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={`Violations (${shown.length})`} action={<NavSelect id="vio-status" label="Status" value={filter} options={FILTERS} hrefBase="/governance/violations?status=" />} />
          {shown.length === 0 ? <EmptyState title="No violations to show">{rows.length === 0 ? (can(actor, "violation.create") ? "Use “Report a violation” to raise one against a staff member." : "An HR user reports violations.") : "No violation has this status."}</EmptyState> : (
            <div className="divide-y divide-line">
              {shown.map((v) => (
                <div key={v.id} className="px-6 py-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{v.employee_name}</p>
                      <p className="text-xs text-muted">{v.business_unit}{v.employee_email ? ` · ${v.employee_email}` : ""} · reported {watDate(v.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                      <span className={v.status === "VOID" ? "tabular-nums font-medium text-muted line-through" : "tabular-nums font-medium"}>{money(v.fine_amount)}</span>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 text-sm">
                    <div><span className="text-muted">Type:</span> {v.type}{v.override_reason ? <p className="text-xs text-muted">Fine overridden: {v.override_reason}</p> : null}</div>
                    <div><span className="text-muted">Criticality:</span> {v.criticality.toLowerCase()}</div>
                    <div className="flex items-center gap-2">
                      {v.status === "OPEN" && can(actor, "violation.payment.record") ? <PayButton id={v.id} amount={money(v.fine_amount)} /> : null}
                      {v.status === "OPEN" && can(actor, "violation.void") ? <VoidButton id={v.id} /> : null}
                      {can(actor, "violation.edit") ? <EvidenceUploadButton entityType="VIOLATION" entityId={v.id} label="Attach evidence" /> : null}
                    </div>
                  </div>
                  {v.status === "OPEN" && (v.reversed_payments ?? 0) > 0 ? <p className="text-xs text-muted">Reopened: an earlier payment was reversed in the ledger.</p> : null}
                  {v.payment ? <p className="text-xs text-muted">Ref {v.payment.reference}{v.payment.paid_at ? ` · paid ${watDate(v.payment.paid_at)}` : ""}</p> : null}
                  {v.status === "VOID" ? <p className="text-xs text-muted">Contested and cleared{v.voided_at ? ` on ${watDate(v.voided_at)}` : ""}: {v.void_reason}. No fine was added to the violation fund.</p> : null}
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
