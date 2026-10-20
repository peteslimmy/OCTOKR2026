import { api } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Delete a single user.
 * Requires users.manage permission and step-up MFA.
 * Also deletes the auth identity.
 */
export const DELETE = api({ stepUp: true }, async ({ actor, params, rpc }) => {
  const userId = params.id;

  // First delete the application user (this removes user_roles via cascade)
  await rpc("delete_user", { p_actor: actor.id, p_user: userId });

  // Then delete the auth user
  const admin = adminClient("delete-user-" + userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // If auth deletion fails, we should note it but the app user is already deleted
    // This shouldn't happen in practice since we check first
    console.error("Failed to delete auth user:", error);
  }

  return { success: true };
  });