import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Sign the review off with a short statement of what was reviewed. A signed-off review can no longer change. */
export const POST = api({ stepUp: true, body: z.object({ attestation: z.string().trim().min(10).max(2000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("sign_off_access_review", { p_actor: actor.id, p_review: params.id, p_attestation: body.attestation }));
