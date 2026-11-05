import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { can, type Actor } from "@/lib/auth/actor";
import { listPaymentMethods, listPurposes, listViolationTypes } from "@/lib/data/governance";
import { PurposeManager } from "../finance-actions";
import { AddPaymentMethodButton, EditPaymentMethodButton } from "../payment-method-actions";
import { EditTypeButton } from "../type-actions";
import { ViolationTypeButton } from "../violation-actions";

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));

/** Everything that configures violations and the fund lives here: the violation types and their fines, and the purposes offered on fund requests. */
export async function SettingsTab({ actor }: { actor: Actor }) {
  const manageTypes = can(actor, "violation.edit"), managePurposes = can(actor, "finance.purpose.manage");
  const [types, purposes, methods] = await Promise.all([manageTypes ? listViolationTypes() : Promise.resolve([]), managePurposes ? listPurposes() : Promise.resolve([]), manageTypes ? listPaymentMethods() : Promise.resolve([])]);
  return (
    <div className="space-y-6">
      {manageTypes ? (
        <Card>
          <CardHeader title="Violation types and fines" description="Management-controlled. The fine and criticality are copied onto each violation when it is raised; a later change affects future violations only."
            action={<ViolationTypeButton />} />
          {types.length === 0 ? <EmptyState title="No violation types yet">Define the approved violation types, their criticality and default fines before raising violations.</EmptyState> : (
            <ul className="divide-y divide-line">
              {types.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                  <span className={t.active ? "" : "text-muted"}>{t.name} <span className="font-mono text-xs text-muted">{t.code}</span></span>
                  <span className="flex items-center gap-3">
                    <Badge tone={t.criticality === "CRITICAL" || t.criticality === "HIGH" ? "critical" : "warn"}>{t.criticality.toLowerCase()}</Badge>
                    <span className="tabular-nums">{money(t.default_fine)}</span>
                    {!t.active ? <Badge tone="undefined">not in use</Badge> : null}
                    <EditTypeButton type={t} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      {manageTypes ? (
        <Card>
          <CardHeader title="Payment methods" description="How a fine can be settled. Each method has a three-character code that starts every payment reference made with it, for example SAL-2026-000001. A code cannot be changed once created."
            action={<AddPaymentMethodButton />} />
          <ul className="divide-y divide-line">
            {methods.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                <span className={m.active ? "" : "text-muted"}>{m.name} <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-muted">{m.code}</span></span>
                <span className="flex items-center gap-3">
                  {m.is_deduction ? <Badge tone="info">salary deduction</Badge> : null}
                  {!m.active ? <Badge tone="undefined">not in use</Badge> : null}
                  <EditPaymentMethodButton method={m} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {managePurposes ? <PurposeManager purposes={purposes} /> : null}
      <Card>
        <CardHeader title="How the rules work" />
        <ul className="list-disc space-y-1.5 px-10 py-4 text-sm text-muted">
          <li>A Super Admin&apos;s change to a type or its fine applies at once. Anyone else&apos;s change is sent to a different Admin or Super Admin for approval.</li>
          <li>A violation keeps the fine it was raised with, whatever happens to the type afterwards.</li>
          <li>A violation can be voided only by someone other than the person who raised it, and only while it is unpaid. A paid one is first reversed in the ledger.</li>
          <li>Whoever asks for money from the fund can never approve or release their own request.</li>
          <li>Retiring a purpose keeps the requests that already used it.</li>
        </ul>
      </Card>
      {!manageTypes && !managePurposes ? <Card><EmptyState title="Nothing to configure for your role" /></Card> : null}
    </div>
  );
}
