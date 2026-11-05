import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Changes a detection rule's switch, threshold, window or severity. Needs `audit.rules.configure`, a recent second factor and a reason; the change is audited with before and after. */
export const POST = api(
  {
    stepUp: true,
    body: z.object({
      enabled: z.boolean().optional(), threshold: z.number().int().min(1).max(100000).optional(), windowMinutes: z.number().int().min(1).max(43200).optional(),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(), reason: z.string().trim().min(1).max(2000),
    }),
  },
  async ({ actor, body, params, rpc }) => {
    await rpc("audit_rule_configure", {
      p_actor: actor.id, p_code: params.code, p_enabled: body.enabled ?? null, p_threshold: body.threshold ?? null, p_window: body.windowMinutes ?? null,
      p_severity: body.severity ?? null, p_reason: body.reason,
    });
    return { ok: true };
  },
);
