import { api } from "@/lib/api/handler";
import { z } from "zod";

/**
 * Change a unit between Business Unit and Department (promote or demote). Super Admin only: the database function requires
 * `business_units.change_type`, which only SUPER_ADMIN holds (ADR-114). The type is a classification label; this changes no
 * reporting flag, score, report, person or parent, and writes a BU_TYPE_CHANGED audit entry with the reason.
 */
export const POST = api(
  { stepUp: true, body: z.object({ unitType: z.enum(["BUSINESS_UNIT", "DEPARTMENT"]), reason: z.string().trim().min(1).max(2000) }) },
  async ({ actor, body, params, rpc }) =>
    rpc("change_business_unit_type", { p_actor: actor.id, p_id: params.id, p_new_type: body.unitType, p_reason: body.reason }),
);
