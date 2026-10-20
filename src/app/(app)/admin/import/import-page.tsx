import Link from "next/link";
import { wat } from "@/components/status";
import { Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { ENTITIES, type EntityId } from "@/lib/import/entities";
import { userClient } from "@/lib/supabase/server";
import { ImportWizard } from "./import-wizard";

const PERMISSION: Record<EntityId, string> = { employees: "users.manage", "business-units": "business_units.manage" };
const DB_ENTITY: Record<EntityId, string> = { employees: "EMPLOYEES", "business-units": "BUSINESS_UNITS" };

/** Shared page for every import: the wizard, then the history of that kind of import. */
export async function ImportPage({ entity }: { entity: EntityId }) {
  const cfg = ENTITIES[entity];
  const actor = await requireActor();
  if (!can(actor, PERMISSION[entity])) return <Card><EmptyState title="You do not have access to bulk import" /></Card>;
  const sb = await userClient();
  const { data: batches } = await sb.from("import_batches")
    .select("id, file_name, created_count, updated_count, unchanged_count, skipped_count, row_count, committed_at, users(email)")
    .eq("entity", DB_ENTITY[entity]).order("committed_at", { ascending: false }).limit(10);
  return (
    <>
      <PageHeader title={cfg.title} description={cfg.intro} actions={<span className="flex gap-4 text-sm">{can(actor, "history.import") ? <Link href="/admin/import/history" className="text-brand-700 underline">Historical reports</Link> : null}{can(actor, "users.manage") ? <Link href="/admin/import/sign-ins" className="text-brand-700 underline">Sign-ins and roles</Link> : null}{can(actor, "strategy.import") ? <Link href="/admin/import/strategy" className="text-brand-700 underline">Strategy</Link> : null}<Link href="/admin" className="text-brand-700 underline">Back to Administration</Link></span>} />
      <div className="space-y-6">
        <ImportWizard entity={entity} />
        <Card>
          <CardHeader title="Recent imports" description="Every import is kept, with who ran it and what it did." />
          {!batches?.length ? <EmptyState title="No imports yet" /> : (
            <DataTable caption={`Recent ${entity === "employees" ? "employee" : "Business Unit"} imports`} columns={[{ label: "When" }, { label: "File" }, { label: "By" }, { label: "Rows" }, { label: "Added" }, { label: "Updated" }, { label: "Skipped or unchanged" }]}>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="whitespace-nowrap">{wat(b.committed_at)}</td><td className="break-all">{b.file_name}</td><td>{(b.users as unknown as { email: string } | null)?.email ?? "—"}</td>
                  <td className="tabular-nums">{b.row_count}</td><td className="tabular-nums">{b.created_count}</td><td className="tabular-nums">{b.updated_count}</td>
                  <td className="tabular-nums">{b.skipped_count + b.unchanged_count}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}
