import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * POST /api/v1/violations/{id}/void: a contested violation that was upheld in the person's favour. The reason is mandatory and audited; the
 * person who raised the violation cannot void it; a violation that has been paid must have its payment reversed first. No fine is credited.
 */
export const POST = api({ body: z.object({ reason: z.string().trim().min(1).max(2000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("void_violation", { p_actor: actor.id, p_violation: params.id, p_reason: body.reason }));
