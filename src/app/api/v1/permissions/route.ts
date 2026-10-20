import { api, requirePerm } from "@/lib/api/handler";
import { listPermissions } from "@/lib/data/config";

/** Every permission, with whether it is protected (changing it on a role needs a Super Admin). */
export const GET = api({}, async ({ actor }) => {
  if (!["users.manage", "roles.request", "roles.manage", "config.approve"].some((p) => actor.permissions.has(p))) requirePerm(actor, "users.manage");
  return listPermissions();
});
