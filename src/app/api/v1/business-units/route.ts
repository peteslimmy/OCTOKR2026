import { api } from "@/lib/api/handler";
import { z } from "zod";
import { listBusinessUnits } from "@/lib/data";

/** unitType is Business Unit or Department; reportsWeekly says whether it files a weekly report. Without unitType the type follows the flag. */
export const POST = api({ body: z.object({ code: z.string().trim().min(2).max(20), name: z.string().trim().min(1).max(500), reportsWeekly: z.boolean().default(true), unitType: z.enum(["BUSINESS_UNIT", "DEPARTMENT"]).optional() }) }, async ({ actor, body, rpc }) =>
  rpc("create_business_unit", { p_actor: actor.id, p_code: body.code, p_name: body.name, p_reports_weekly: body.reportsWeekly, p_unit_type: body.unitType ?? null }));

export const GET = api({}, async () => listBusinessUnits());
