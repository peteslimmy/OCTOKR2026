import { z } from "zod";
import { api } from "@/lib/api/handler";
import { forgetRuntime } from "@/lib/integrations/runtime";

/** Emergency override (Super Admin): applies a change with no second approver. Full reason, fresh authenticator check, audited, others alerted. */
export const POST = api(
  { stepUp: true, body: z.object({ topic: z.string().trim().min(2).max(40), target: z.string().trim().min(1).max(100).nullish(), proposed: z.record(z.string(), z.unknown()),
    reason: z.string().trim().min(10).max(2000), idempotencyKey: z.string().min(8).max(100), confirm: z.literal(true) }) },
  async ({ actor, body, rpc }) => { const out = await rpc("emergency_config_change", { p_actor: actor.id, p_topic: body.topic, p_target: body.target ?? null, p_proposed: body.proposed, p_reason: body.reason, p_idempotency_key: body.idempotencyKey }); forgetRuntime(); return out; },
);
