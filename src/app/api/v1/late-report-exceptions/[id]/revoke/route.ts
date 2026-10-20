import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api(
  { body: z.object({ reason: z.string().trim().min(1).max(2000) }) },
  async ({ actor, body, params, rpc }) => rpc("revoke_late_report_exception", { p_actor: actor.id, p_exception_id: params.id, p_reason: body.reason }),
);
