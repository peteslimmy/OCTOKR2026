import { z } from "zod";
import { api } from "@/lib/api/handler";

export const PUT = api(
  { stepUp: true, body: z.object({ permission: z.enum(["attendance.amendment.approve", "attendance.amendment.request", "attendance.session.manage", "reporting.period.holiday.manage", "weekly_report.review"]), grant: z.boolean() }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_user_permission", { p_actor: actor.id, p_user: params.id, p_permission: body.permission, p_grant: body.grant }));
