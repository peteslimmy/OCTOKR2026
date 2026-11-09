import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { sendInvitation } from "@/lib/email/send-invite";

/**
 * Sends a person their invitation again (a new one-time set-up link, emailed to them). Only for an active person who has never signed in: once someone is in, a
 * password reset is the right way back. The earlier link stops working when the new one is made. Needs users.manage; every attempt is audited with its outcome.
 */
export const POST = api({}, async ({ actor, params, correlationId, req }) => {
  if (!actor.permissions.has("users.manage")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  const admin = adminClient(correlationId);
  const { data: u } = await admin.from("users").select("id, email, status, last_login_at, employees(first_name)").eq("id", params.id).maybeSingle();
  if (!u) throw fail("NOT_FOUND", 404, "That user was not found.");
  if (u.status !== "ACTIVE") throw fail("VALIDATION_ERROR", 422, "Only an active person can be invited. Reactivate them first.");
  if (u.last_login_at) throw fail("VALIDATION_ERROR", 422, "This person has already signed in. If they cannot get in, they can use Forgot your password on the sign-in page.");
  const emp = Array.isArray(u.employees) ? u.employees[0] : u.employees;
  const inv = await sendInvitation({ actorId: actor.id, userId: u.id, email: String(u.email), firstName: emp?.first_name ?? null, invitedBy: actor.name, fallbackAppUrl: new URL(req.url).origin, correlationId });
  return { invitation: { outcome: inv.outcome, message: inv.message }, setupLink: inv.setupLink };
});
