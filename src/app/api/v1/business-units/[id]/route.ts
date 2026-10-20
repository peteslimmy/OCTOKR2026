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
  { body: z.object({ name: z.string().trim().min(1).max(500), status: z.enum(["ACTIVE", "INACTIVE"]), reportsWeekly: z.boolean().default(true), reason: z.string().trim().min(1).max(2000).optional() }) },
  async (ctx) => {
    const { name, status, reportsWeekly, reason } = ctx.body;
    const sb = await (await import("@/lib/supabase/server")).userClient();
    const { data: cur } = await sb.from("business_units").select("status, reports_weekly").eq("id", ctx.params.id).maybeSingle();
    if (!cur) throw fail("NOT_FOUND", 404, "Business Unit not found.");
    if (cur.status === status && cur.reports_weekly === reportsWeekly) {
      return ctx.rpc("update_business_unit", { p_actor: ctx.actor.id, p_id: ctx.params.id, p_name: name, p_status: status, p_reports_weekly: reportsWeekly });
    }
    if (!reason) throw fail("REASON_REQUIRED", 422, "Say why the Business Unit's status or weekly reporting is changing.");
    const { requestConfigChange } = await import("@/lib/api/config-request");
    return requestConfigChange(ctx, "BU_REPORTING", ctx.params.id, { name, status, reportsWeekly }, reason);
  });