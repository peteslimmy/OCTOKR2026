import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Sets the investigation status of a security indicator. An alert is a signal to review, not a finding; closing it requires a note. The change is audited. */
export const POST = api(
  { body: z.object({ status: z.enum(["UNDER_REVIEW", "EXPLAINED", "ESCALATED", "DISMISSED"]), note: z.string().trim().max(2000).optional() }) },
  async ({ actor, body, params, rpc }) => {
    await rpc("audit_alert_set_status", { p_actor: actor.id, p_id: params.id, p_status: body.status, p_note: body.note ?? null });
    return { ok: true };
  },
);
