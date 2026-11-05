import { api, requirePerm } from "@/lib/api/handler";
import { auditTrace } from "@/lib/data/audit";

/** One audit event with the events around it: the same request, the same workflow or record, the same sign-in session and the same person (a day either side). */
export const GET = api({}, async ({ actor, params }) => {
  requirePerm(actor, "audit.read");
  return auditTrace(actor.id, params.id);
});
