import "server-only";
import { randomUUID } from "node:crypto";
import type { Ctx } from "@/lib/api/handler";

/**
 * Governance-critical configuration is never changed in one step (ADR-068): the route asks, a different person approves.
 * The key is generated here because the browser forms do not carry one; a double click is stopped by the one-pending-request rule instead.
 */
export function requestConfigChange(ctx: Pick<Ctx, "actor" | "rpc">, topic: string, target: string | null, proposed: Record<string, unknown>, reason: string) {
  return ctx.rpc<{ replayed: boolean; request_id: string; status: string }>("request_config_change", {
    p_actor: ctx.actor.id, p_topic: topic, p_target: target, p_proposed: proposed, p_reason: reason, p_idempotency_key: randomUUID(),
  });
}
