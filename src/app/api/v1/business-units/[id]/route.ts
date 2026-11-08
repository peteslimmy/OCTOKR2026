import { api, fail } from "@/lib/api/handler";
import { z } from "zod";

/**
 * Delete a single Business Unit or Department.
 * Requires business_units.manage permission.
 * Fails if the unit has employees or weekly reports.
 */
export const DELETE = api({ body: z.object({ reason: z.string().trim().min(1).max(2000).optional() }) }, async ({ actor, body, params, rpc }) => {
  const { reason } = body;
  return rpc("delete_business_unit", { p_actor: actor.id, p_id: params.id });
});

/**
 * Update a Business Unit or Department (existing PATCH handler)
 * Keeping this for reference - the file should have both PATCH and DELETE
 */
export const PATCH = api(
  { body: z.object({ name: z.string().trim().min(1).max(500), status: z.enum(["ACTIVE", "INACTIVE"]), reportsWeekly: z.boolean().default(true), unitType: z.enum(["BUSINESS_UNIT", "DEPARTMENT"]).optional(), parentUnitId: z.string().uuid().nullable().optional(), description: z.string().max(2000).nullable().optional(), location: z.string().max(200).nullable().optional(), reason: z.string().trim().min(1).max(2000).optional() }) },
  async (ctx) => {
    const { name, status, reportsWeekly, unitType, parentUnitId, description, location, reason } = ctx.body;
    const sb = await (await import("@/lib/supabase/server")).userClient();
    const { data: cur } = await sb.from("business_units").select("status, reports_weekly, unit_type, parent_unit_id, description, location").eq("id", ctx.params.id).maybeSingle();
    if (!cur) throw fail("NOT_FOUND", 404, "Business Unit not found.");
    if (unitType && unitType !== cur.unit_type) throw fail("USE_TYPE_CHANGE", 422, "The type is changed from the unit's own \"Change type\" action, which only the Super Admin can use.");
    if (cur.status === status && cur.reports_weekly === reportsWeekly && cur.unit_type === unitType && cur.parent_unit_id === parentUnitId && cur.description === description && cur.location === location) {
      return ctx.rpc("update_business_unit", { p_actor: ctx.actor.id, p_id: ctx.params.id, p_name: name, p_status: status, p_reports_weekly: reportsWeekly, p_unit_type: unitType ?? null, p_set_hierarchy: true, p_parent_unit_id: parentUnitId ?? null, p_description: description ?? null, p_location: location ?? null });
    }
    if (!reason) throw fail("REASON_REQUIRED", 422, "Say why the Business Unit's status or weekly reporting is changing.");
    const { requestConfigChange } = await import("@/lib/api/config-request");
    return requestConfigChange(ctx, "BU_REPORTING", ctx.params.id, { name, status, reportsWeekly, unitType, parentUnitId, description, location }, reason);
  });