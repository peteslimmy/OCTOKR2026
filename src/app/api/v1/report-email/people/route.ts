import { api, fail } from "@/lib/api/handler";
import { listPeople } from "@/lib/report-email/service";

/** People who can be chosen as recipients (active accounts only). */
export const GET = api({}, async ({ actor }) => {
  if (!actor.permissions.has("report_email.manage")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  return listPeople(actor);
});
