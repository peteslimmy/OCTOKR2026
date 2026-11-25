import { z } from "zod";
import { api } from "@/lib/api/handler";

/** A BU Lead asks to change a locked goal: add, rename or restore, and names the executive who decides it (nothing changes unless that executive approves). Retiring has its own request. */
export const POST = api({ body: z.object({
  businessUnitId: z.string().uuid().nullish(), quarterId: z.string().uuid(), kind: z.enum(["ADD", "RENAME", "RESTORE"]), executiveId: z.string().uuid(),
  goalId: z.string().uuid().nullish(), title: z.string().trim().max(500).nullish(), reason: z.string().trim().min(1).max(2000),
}) }, async ({ actor, body, rpc }) =>
  rpc("request_bu_goal_change", { p_actor: actor.id, p_bu: body.businessUnitId ?? null, p_quarter: body.quarterId, p_kind: body.kind, p_goal: body.goalId ?? null, p_title: body.title ?? null, p_reason: body.reason, p_executive: body.executiveId }));
