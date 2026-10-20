import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listPermissions, listRoles } from "@/lib/data/config";
import { RoleAdmin } from "./role-actions";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const actor = await requireActor();
  if (!can(actor, "roles.request") && !can(actor, "users.manage") && !can(actor, "roles.manage")) return <Card><EmptyState title="Roles are not available for your role" /></Card>;
  const [roles, permissions] = await Promise.all([listRoles(), listPermissions()]);
  return (
    <>
      <PageHeader title="Roles" description="A role is a named set of permissions. Roles are created and changed here, not in code. A change is asked for by one person and approved by a different one."
        actions={<Link href="/admin/approvals" className={buttonClass("secondary", "sm")}>Approvals</Link>} />
      <Card>
        <CardHeader title={`Roles (${roles.length})`} description="You can give a role only permissions you hold yourself. Protected permissions and the authenticator requirement need a Super Admin to approve." />
        {can(actor, "roles.request")
          ? <RoleAdmin mine={[...actor.permissions]} permissions={permissions}
              roles={roles.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, members: r.members, permissions: r.permissions, requiresMfa: r.requires_mfa, isSystem: r.is_system }))} />
          : <ul className="divide-y divide-line" aria-label="Roles">{roles.map((r) => <li key={r.id} className="px-6 py-3 text-sm"><span className="font-medium">{r.name}</span> <span className="font-mono text-xs text-muted">{r.code}</span> · {r.members} people · {r.permissions.length} permissions</li>)}</ul>}
      </Card>
    </>
  );
}
