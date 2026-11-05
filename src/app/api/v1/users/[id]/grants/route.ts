import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * Give one person a single permission directly (for a reason, and optionally for a limited time), or take such a grant away.
 * The database refuses a reserved permission, a conflict of duties and a protected permission the grantor does not hold.
 */
export const POST = api(
  { stepUp: true, body: z.object({ permission: z.string().trim().min(3).max(80), grant: z.boolean(), reason: z.string().trim().max(2000).optional(), expiresAt: z.string().datetime({ offset: true }).nullish() }) },
  async ({ actor, body, params, rpc }) =>
    rpc("grant_user_permission", { p_actor: actor.id, p_user: params.id, p_permission: body.permission, p_grant: body.grant, p_reason: body.reason ?? null, p_expires_at: body.expiresAt ?? null }));
