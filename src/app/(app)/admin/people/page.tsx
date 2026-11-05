import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardHeader, PageHeader, buttonClass, DataTable } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listRoles } from "@/lib/data/config";
import { listPermissionGrants } from "@/lib/data/governance";
import { listBusinessUnits, listEmployees, listUsers } from "@/lib/data";
import { CreateUserButton, DesignationsButton, RosterToggle, GiveSignInButton, UserRowActions, DeleteUserButton, BulkDeleteUsers } from "../admin-actions";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const actor = await requireActor();
  if (!can(actor, "users.manage")) return <Card><div className="p-6 text-sm">People management is not available for your role.</div></Card>;
  const grantPrivileged = can(actor, "roles.manage");
  const viewerIsSuper = actor.roles.includes("SUPER_ADMIN");
  const [bus, allUsers, roleRows, allEmployees] = await Promise.all([listBusinessUnits(), listUsers(true), listRoles(), listEmployees()]);
  // the Super Admin account is a reserve account: only a Super Admin can see it
  const hiddenIds = new Set(viewerIsSuper ? [] : allUsers.filter((u) => u.user_roles.some((r) => r.roles?.code === "SUPER_ADMIN")).map((u) => u.id));
  const users = allUsers.filter((u) => !hiddenIds.has(u.id));
  const employees = allEmployees.filter((e) => !(e.users && hiddenIds.has(e.users.id)));
  const grants = grantPrivileged ? await listPermissionGrants() : {};
  const roleOptions = roleRows.map((r) => ({ code: r.code, name: r.name, privileged: r.privileged }));
  const roleName = new Map(roleRows.map((r) => [r.code, r.name]));
  const roleManagers = new Set(roleRows.filter((r) => r.permissions.includes("roles.manage")).map((r) => r.code));
  return (
    <>
      <PageHeader title="People" description="Every person belongs to one Business Unit or Department. Add people one at a time here, or import many from a spreadsheet." />
      <div className="space-y-6">
        {users.filter((u) => u.status === "ACTIVE" && u.user_roles.some((r) => r.roles?.code && roleManagers.has(r.roles.code))).length < 2 ? (
          <Banner tone="warn" title="Fewer than two people can manage roles">
            If the only Super Admin loses their authenticator and recovery codes, the documented break-glass procedure (docs/26-ACCOUNT-RECOVERY.md) needs server access. Appoint a second Super Admin so one can always reset the other.
          </Banner>
        ) : null}
        <>
          <Card>
            <CardHeader title="Users" description="Handing out a role that can administer people or roles needs role-management permission."
              action={<div className="flex flex-wrap gap-2"><Link href="/admin/import" className={buttonClass("secondary")}>Import employees</Link><BulkDeleteUsers users={users.map(u => ({ id: u.id, name: u.employees ? `${u.employees.first_name} ${u.employees.last_name}` : u.email, email: u.email, roles: u.user_roles.map(r => r.roles?.code).filter((r): r is string => !!r) }))} /><CreateUserButton bus={bus.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, name: b.name }))} grantPrivileged={grantPrivileged} roleOptions={roleOptions} /></div>} />
            <DataTable caption="Application users" columns={[{ label: "Name" }, { label: "BU" }, { label: "Roles" }, { label: "Status" }, { label: "Actions", srOnly: true }]}>
                  {users.map((u) => {
                    const roles = u.user_roles.map((r) => r.roles?.code).filter((r): r is string => !!r);
                    const isSelf = u.id === actor.id;
                    return (
                      <tr key={u.id} className="border-b border-line last:border-0">
                        <td><p className="font-medium">{u.employees ? `${u.employees.first_name} ${u.employees.last_name}` : u.email}</p><p className="text-xs text-muted">{u.email}</p></td>
                        <td>{u.employees?.business_units?.name}</td>
                        <td><div className="flex flex-wrap gap-1">{roles.map((r) => <Badge key={r} tone="brand">{roleName.get(r) ?? r}</Badge>)}</div></td>
                        <td><Badge tone={u.status === "ACTIVE" ? "done" : "critical"}>{u.status.toLowerCase()}</Badge></td>
                        <td className="text-right">{!isSelf ? <span className="inline-flex gap-1">{grantPrivileged ? <DesignationsButton id={u.id} held={grants[u.id] ?? []} /> : null}<UserRowActions id={u.id} status={u.status} roles={roles} grantPrivileged={grantPrivileged} roleOptions={roleOptions} /><DeleteUserButton id={u.id} name={u.employees ? `${u.employees.first_name} ${u.employees.last_name}` : u.email} email={u.email} roles={roles} isSelf={false} grantPrivileged={grantPrivileged} roleOptions={roleOptions} /></span> : <span className="text-xs text-muted">you</span>}</td>
                      </tr>
                    );
                  })}
                </DataTable>
          </Card>
          <Card>
            <CardHeader title={`Everyone (${employees.length})`} description="Every employee, with or without a sign-in. Only people on the attendance roster are listed in weekly sessions; a person can have a sign-in and still be left off it." />
            <DataTable caption="All employees" columns={[{ label: "Name" }, { label: "Unit" }, { label: "Sign-in" }, { label: "Attendance roster" }, { label: "Actions", srOnly: true }]}>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td><p className="font-medium">{e.first_name} {e.last_name}</p><p className="text-xs text-muted">{e.email}</p></td>
                  <td>{e.business_units?.name}</td>
                  <td><Badge tone={e.users ? "brand" : "undefined"}>{e.users ? "has sign-in" : "attendance only"}</Badge></td>
                  <td><Badge tone={e.on_attendance_roster ? "done" : "undefined"}>{e.on_attendance_roster ? "on roster" : "off roster"}</Badge>{e.employment_status !== "ACTIVE" ? <Badge tone="critical">inactive</Badge> : null}</td>
                  <td className="text-right"><span className="inline-flex gap-1">{!e.users && e.employment_status === "ACTIVE" ? <GiveSignInButton id={e.id} name={`${e.first_name} ${e.last_name}`} email={e.email} grantPrivileged={grantPrivileged} roleOptions={roleOptions} /> : null}<RosterToggle id={e.id} name={`${e.first_name} ${e.last_name}`} onRoster={e.on_attendance_roster} /></span></td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </>
      </div>
    </>
  );
}
