import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listRetirements } from "@/lib/data/bu-goal-retirements";

/** The retirement requests the caller may see (their unit's, the ones sent to them, or all for a Super Admin). ?toDecide=1 lists only those waiting for their decision. */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const id = z.string().uuid().nullable();
  const quarterId = id.safeParse(sp.get("quarterId")), businessUnitId = id.safeParse(sp.get("businessUnitId"));
  return listRetirements({ quarterId: quarterId.success ? quarterId.data : null, businessUnitId: businessUnitId.success ? businessUnitId.data : null, toDecide: sp.get("toDecide") === "1" });
});

/** A BU Lead asks the chosen executive to approve retiring one of the unit's goals. The goal does not change until the executive approves. A repeat returns the open request. */
export const POST = api({ body: z.object({
  goalId: z.string().uuid(), executiveId: z.string().uuid(), justification: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100),
}) }, async ({ actor, body, rpc }) =>
  rpc("request_bu_goal_retirement", { p_actor: actor.id, p_goal: body.goalId, p_executive: body.executiveId, p_justification: body.justification, p_idempotency_key: body.idempotencyKey }));
