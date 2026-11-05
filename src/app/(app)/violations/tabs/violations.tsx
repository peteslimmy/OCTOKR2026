import { watDate } from "@/components/status";
import { EvidenceFileList, EvidenceUploadButton } from "@/components/ui/evidence-upload";
import { NavSelect } from "@/components/ui/nav-select";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { can, type Actor } from "@/lib/auth/actor";
import { serverNow } from "@/lib/data";
import { listActiveEmployees, listPaymentMethods, listSessions, listViolations, listViolationTypes } from "@/lib/data/governance";
import { formatWeekLabel } from "@/lib/domain/week-label";
import type { ModuleParams } from "../page";
import { NewViolationButton, PayButton, VoidButton } from "../violation-actions";

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));
const TONE = { OPEN: "warn", PAID: "done", DEDUCTION_RECORDED: "done", VOID: "undefined" } as const;
const STATUS_LABEL = { OPEN: "Pending payment", PAID: "Paid", DEDUCTION_RECORDED: "Deducted from salary", VOID: "Void" } as const;
const STATUSES = [{ value: "all", label: "All violations" }, { value: "OPEN", label: "Pending payment" }, { value: "PAID", label: "Paid (incl. salary deduction)" }, { value: "VOID", label: "Void" }];

/** Report a violation and follow it through to payment. */
export async function ViolationsTab({ actor, params }: { actor: Actor; params: ModuleParams }) {
  const [rows, types, employees, sessions, nowIso, methods] = await Promise.all([listViolations(), listViolationTypes(), listActiveEmployees(), listSessions(8), serverNow(), listPaymentMethods()]);
  const status = STATUSES.some((s) => s.value === params.status) ? params.status! : "all";
  const units = [...new Set(rows.map((v) => v.business_unit))].sort();
  const unit = units.includes(params.unit ?? "") ? params.unit! : "all";
  const overdue = params.overdue === "1";
  const nowMs = new Date(nowIso).getTime();
  const age = (iso: string) => Math.floor((nowMs - new Date(iso).getTime()) / 864e5);
  const shown = rows.filter((v) => (status === "all" || (status === "PAID" ? v.status === "PAID" || v.status === "DEDUCTION_RECORDED" : v.status === status))
    && (unit === "all" || v.business_unit === unit) && (!overdue || (v.status === "OPEN" && age(v.created_at) > 7)));
  return (
    <Card>
      <CardHeader title={`Violations (${shown.length})`} description="Pending payment, paid, deducted from salary, or void. Open the payment to record it and credit the fund in one step."
        action={<span className="flex flex-wrap items-center gap-3">
          <NavSelect id="vio-status" label="Status" value={status} options={STATUSES} hrefBase={`/violations?tab=violations&unit=${unit}${overdue ? "&overdue=1" : ""}&status=`} />
          <NavSelect id="vio-unit" label="Unit" value={unit} options={[{ value: "all", label: "All units" }, ...units.map((u) => ({ value: u, label: u }))]} hrefBase={`/violations?tab=violations&status=${status}&unit=`} />
          <a href={`/violations?tab=violations&status=OPEN&unit=${unit}${overdue ? "" : "&overdue=1"}`} className={`rounded-full border px-3 py-1 text-xs ${overdue ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel"}`} aria-current={overdue ? "true" : undefined}>Unpaid for over a week</a>
          {can(actor, "violation.create") ? <NewViolationButton types={types.filter((t) => t.active)} sessions={sessions.filter((s) => s.outcome !== "SKIPPED").map((s) => ({ id: s.id, label: `${formatWeekLabel(s.reporting_weeks)} · session ${s.session_date}` }))}
            employees={employees.map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name}`, businessUnit: e.business_units?.name ?? "", email: e.email ?? "" }))} /> : null}
        </span>} />
      {shown.length === 0 ? <EmptyState title="No violations to show">{rows.length === 0 ? (can(actor, "violation.create") ? "Use “Report a violation” to raise one against a staff member." : "An HR user reports violations.") : "No violation matches these filters."}</EmptyState> : (
        <div className="max-h-[70vh] divide-y divide-line overflow-y-auto">
          {shown.map((v) => (
            <div key={v.id} className="space-y-3 px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{v.employee_name}</p>
                  <p className="text-xs text-muted">{v.business_unit}{v.employee_email ? ` · ${v.employee_email}` : ""} · reported {watDate(v.created_at)}{v.status === "OPEN" ? ` · unpaid ${age(v.created_at)} days` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                  <span className={v.status === "VOID" ? "font-medium tabular-nums text-muted line-through" : "font-medium tabular-nums"}>{money(v.fine_amount)}</span>
                </div>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div><span className="text-muted">Type:</span> {v.type}{v.override_reason ? <p className="text-xs text-muted">Fine overridden: {v.override_reason}</p> : null}</div>
                <div><span className="text-muted">Criticality:</span> {v.criticality.toLowerCase()}</div>
                <div className="flex items-center gap-2">
                  {v.status === "OPEN" && can(actor, "violation.payment.record") ? <PayButton id={v.id} amount={money(v.fine_amount)} methods={methods.filter((m) => m.active)} /> : null}
                  {v.status === "OPEN" && can(actor, "violation.void") ? <VoidButton id={v.id} /> : null}
                  {can(actor, "violation.edit") ? <EvidenceUploadButton entityType="VIOLATION" entityId={v.id} label="Attach evidence" /> : null}
                </div>
              </div>
              {v.payment ? <p className="text-xs text-muted">Ref {v.payment.reference}{v.payment.paid_at ? ` · paid ${watDate(v.payment.paid_at)}` : ""}</p> : null}
              {(v.reversed_payments ?? 0) > 0 ? <p className="text-xs text-muted">The payment was reversed in the ledger. The violation stays settled and is not reopened.</p> : null}
              {v.status === "VOID" ? <p className="text-xs text-muted">Contested and cleared{v.voided_at ? ` on ${watDate(v.voided_at)}` : ""}: {v.void_reason}. No fine was added to the violation fund.</p> : null}
              <EvidenceFileList files={v.evidence_files || []} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
