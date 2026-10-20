import { api, requirePerm } from "@/lib/api/handler";
import { listRoles } from "@/lib/data/config";

/** Roles with the permissions they hold, how many people hold them and whether they require an authenticator. Changing a role is a request: POST /config-changes with topic ROLE_CHANGE. */
export const GET = api({}, async ({ actor }) => {
  if (!["users.manage", "roles.request", "roles.manage", "config.approve"].some((p) => actor.permissions.has(p))) requirePerm(actor, "users.manage");
  return listRoles();
});
