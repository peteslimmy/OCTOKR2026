import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * Emergency override (Super Admin only): requests, approves and posts a reversal in one step. Needs a recent authenticator check and a
 * full reason; it is audited under its own action and alerts every finance and admin user. It never edits or deletes the original entry.
 */
export const POST = api(
  { stepUp: true, body: z.object({ reason: z.string().trim().min(10).max(2000), idempotencyKey: z.string().min(8).max(100), confirm: z.literal(true) }) },
  async ({ actor, body, params, rpc }) => rpc("emergency_ledger_reversal", { p_actor: actor.id, p_entry_id: params.id, p_reason: body.reason, p_idempotency_key: body.idempotencyKey }),
);
