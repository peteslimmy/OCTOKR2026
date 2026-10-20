import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listConfigChanges } from "@/lib/data/config";

const body = z.object({
  topic: z.string().trim().min(2).max(40),
  target: z.string().trim().min(1).max(100).nullish(),
  proposed: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().min(8).max(100),
});

/** Ask for a change to governance-critical configuration (ADR-068). Nothing changes until a different person approves it. */
export const POST = api({ body }, async ({ actor, body: b, rpc }) =>
  rpc("request_config_change", { p_actor: actor.id, p_topic: b.topic, p_target: b.target ?? null, p_proposed: b.proposed, p_reason: b.reason, p_idempotency_key: b.idempotencyKey }));

/** The queue and history, scoped by row-level security to people who handle configuration. */
export const GET = api({}, async () => listConfigChanges());
