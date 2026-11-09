import { api, fail } from "@/lib/api/handler";
import { canSeeAuditDetail } from "@/lib/audit/detail";

/** Re-computes the audit hash chain and reports the first row that does not match. The check, and any failure it finds, is itself written to the audit log. */
export const POST = api({}, async ({ actor, rpc }) => {
  // the integrity chain is part of the technical detail (ADR-121)
  if (!canSeeAuditDetail(actor)) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  return rpc("audit_verify_and_record", { p_actor: actor.id });
});
