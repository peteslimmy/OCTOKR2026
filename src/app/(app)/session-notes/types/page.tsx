import type { Metadata } from "next";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listSessionTypes } from "@/lib/data/session-notes";
import { TypeForm } from "./type-form";

export const metadata: Metadata = { title: "Session types" };

export default async function SessionTypesPage() {
  const actor = await requireActor();
  if (!can(actor, "session_notes.configure")) return <Card><EmptyState title="Session types are managed by an administrator" /></Card>;
  const types = await listSessionTypes();
  return (
    <>
      <PageHeader title="OKR session types" description="The kinds of OKR session people can start. Retiring a type hides it from new sessions; sessions already recorded keep it. This page gives no access to session content." actions={<TypeForm />} />
      <Card>
        <CardHeader title={`${types.length} types`} />
        <DataTable caption="Session types" maxHeight={null} columns={[{ label: "Name" }, { label: "Code" }, { label: "Order" }, { label: "Status" }, { label: "Change", srOnly: true }]}>
          {types.map((t) => (
            <tr key={t.id} className="border-b border-line last:border-0">
              <td><p className="font-medium">{t.name}</p>{t.description ? <p className="text-xs text-muted">{t.description}</p> : null}</td>
              <td className="font-mono text-xs">{t.code}</td><td>{t.sort_order}</td>
              <td>{t.active ? <Badge tone="done">In use</Badge> : <Badge tone="locked">Retired</Badge>}</td>
              <td className="text-right"><TypeForm type={t} /></td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
