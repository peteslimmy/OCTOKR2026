import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ body: z.object({ confirm: z.literal(true), idempotencyKey: z.string().min(8).max(100), reason: z.string().trim().min(5, "Say why the session is being skipped").max(2000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("skip_okr_session", { p_actor: actor.id, p_session_id: params.id, p_confirm: body.confirm, p_idempotency_key: body.idempotencyKey, p_reason: body.reason }));
