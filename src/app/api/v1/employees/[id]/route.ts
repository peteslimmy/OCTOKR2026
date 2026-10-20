import { api } from "@/lib/api/handler";
import { z } from "zod";

export const PATCH = api({ body: z.object({ firstName: z.string().trim().min(1).max(500), lastName: z.string().trim().min(1).max(500), businessUnitId: z.string().uuid(), status: z.enum(["ACTIVE", "INACTIVE"]) }) }, async ({ actor, body, params, rpc }) =>
  rpc("update_employee", { p_actor: actor.id, p_id: params.id, p_first: body.firstName, p_last: body.lastName, p_bu: body.businessUnitId, p_status: body.status }));
