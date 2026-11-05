import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { RollbackCard } from "../rollback-card";
import { StrategyWizard } from "./strategy-wizard";

export const metadata: Metadata = { title: "Import strategy" };

export default async function Page() {
  const actor = await requireActor();
  if (!can(actor, "strategy.import")) return <Card><EmptyState title="Only a Super Admin can import strategy" /></Card>;
  return (
    <>
      <PageHeader title="Import strategy" description="Load the objective, key results and Sub-KRs of one or more quarters from a spreadsheet. It fills empty quarters only; an active quarter is changed by an approved request."
        actions={<Link href="/admin/import" className="text-sm text-brand-700 underline">Back to Import</Link>} />
      <div className="space-y-6">
        <StrategyWizard />
        <RollbackCard kind="strategy" />
      </div>
    </>
  );
}
