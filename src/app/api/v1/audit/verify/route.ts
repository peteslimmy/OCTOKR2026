import { api } from "@/lib/api/handler";

/** Re-computes the audit hash chain and reports the first row that does not match. The check, and any failure it finds, is itself written to the audit log. */
export const POST = api({}, async ({ actor, rpc }) => rpc("audit_verify_and_record", { p_actor: actor.id }));
