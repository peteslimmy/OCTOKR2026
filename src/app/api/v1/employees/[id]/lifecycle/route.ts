import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * POST /api/v1/employees/{id}/lifecycle { toBusinessUnitId?, roles?, effectiveDate?, reason } — users.manage.
 * Moves a person to another business unit and/or changes their roles (for example makes them BU Lead, also in the new unit) in one step. A reason is required, the effective date may be
 * today or earlier, and every existing rule on who may hand out which role still applies. Records the journey entries and changes no report, goal or score.
 * Answers { moved, roles_changed, source_unit_left_without_lead, target_unit_has_lead } so the screen can warn.
 */
export const POST = api({ body: z.object({ toBusinessUnitId: z.string().uuid().nullish(), roles: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/)).min(1).max(20).nullish(), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), reason: z.string().trim().min(1).max(2000) }) },
  async ({ actor, body, params, rpc }) => rpc("transfer_or_promote", { p_actor: actor.id, p_employee: params.id, p_to_bu: body.toBusinessUnitId ?? null, p_roles: body.roles ?? null, p_effective: body.effectiveDate ?? null, p_reason: body.reason }));
