import { randomBytes } from "node:crypto";
import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";

// Roles are data (ADR-069): the shape is checked here, whether the role exists and may be granted is checked by the database.
const ROLE_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/);

/**
 * Creates the auth identity and the application user. The domain function validates the actor's
 * right to grant each role BEFORE we keep the identity; on any failure the auth user is removed.
 * A one-time invite link (password recovery) is returned so no password is ever chosen on the user's behalf.
 */
export const POST = api(
  {
    body: z.object({
      email: z.string().trim().toLowerCase().email().max(200),
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      businessUnitId: z.string().uuid(),
      roles: z.array(ROLE_CODE).min(1).max(20),
    }),
  },
  async ({ actor, body, correlationId, rpc }) => {
    if (!actor.permissions.has("users.manage")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
    const admin = adminClient(correlationId);
    const created = await admin.auth.admin.createUser({ email: body.email, password: randomBytes(24).toString("base64url"), email_confirm: true });
    if (created.error || !created.data.user) throw fail("VALIDATION_ERROR", 422, "That email address cannot be used.");
    const authId = created.data.user.id;
    try {
      await rpc("provision_user", {
        p_actor: actor.id, p_auth_id: authId, p_email: body.email, p_first: body.firstName, p_last: body.lastName, p_bu: body.businessUnitId, p_roles: body.roles,
      });
    } catch (e) {
      await admin.auth.admin.deleteUser(authId);
      throw e;
    }
    const link = await admin.auth.admin.generateLink({ type: "recovery", email: body.email });
    return { id: authId, setupLink: link.data?.properties?.action_link ?? null };
  },
);
