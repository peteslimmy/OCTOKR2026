import { randomInt } from "node:crypto";
import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { sendInvitation } from "@/lib/email/send-invite";

// Roles are data (ADR-069): the shape is checked here, whether the role exists and may be granted is checked by the database.
/** A first-login password that passes the password policy: 14 characters, no look-alikes (0/O, 1/l/I), at least one of each class. */
function initialPassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789"];
  const all = sets.join("");
  const chars = [...sets.map((s) => s[randomInt(s.length)]), ...Array.from({ length: 11 }, () => all[randomInt(all.length)])];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

const ROLE_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/);

/**
 * Creates the auth identity and the application user. The domain function validates the actor's
 * right to grant each role BEFORE we keep the identity; on any failure the auth user is removed.
 * A generated first-login password and a one-time setup link are returned once, for the administrator to pass on; the user is made to change the password when they first sign in.
 */
export const POST = api(
  {
    // either a new person (name, email and unit) or an existing employee who has no sign-in yet (employeeId: the person's details are read from the employee record)
    body: z.object({
      employeeId: z.string().uuid().optional(),
      email: z.string().trim().toLowerCase().email().max(200).optional(),
      firstName: z.string().trim().min(1).max(100).optional(),
      lastName: z.string().trim().min(1).max(100).optional(),
      businessUnitId: z.string().uuid().optional(),
      roles: z.array(ROLE_CODE).min(1).max(20),
    }).refine((b) => b.employeeId || (b.email && b.firstName && b.lastName && b.businessUnitId), { message: "Name, email and unit are required." }),
  },
  async ({ actor, body: input, correlationId, rpc, req }) => {
    if (!actor.permissions.has("users.manage")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
    const admin = adminClient(correlationId);
    let person = { email: input.email ?? "", firstName: input.firstName ?? "", lastName: input.lastName ?? "", businessUnitId: input.businessUnitId ?? "" };
    if (input.employeeId) {
      const { data: emp } = await admin.from("employees").select("email, first_name, last_name, business_unit_id, employment_status, users(id)").eq("id", input.employeeId).maybeSingle();
      if (!emp) throw fail("NOT_FOUND", 404, "That employee was not found.");
      if (emp.employment_status !== "ACTIVE") throw fail("VALIDATION_ERROR", 422, "Only an active employee can be given a sign-in.");
      if (Array.isArray(emp.users) ? emp.users.length > 0 : !!emp.users) throw fail("VALIDATION_ERROR", 422, "This person already has a sign-in.");
      person = { email: String(emp.email).trim().toLowerCase(), firstName: emp.first_name, lastName: emp.last_name, businessUnitId: emp.business_unit_id };
    }
    const body = { ...person, roles: input.roles };
    // only approved email domains may have an account (the Super Admin keeps the approved list)
    const { data: approved } = await admin.from("allowed_email_domains").select("domain").eq("domain", body.email.split("@")[1] ?? "").maybeSingle();
    // a Super Admin may add a person on any address (a public mail provider included) without approving the domain; everyone else needs an approved company domain
    if (!approved && !actor.roles.includes("SUPER_ADMIN")) throw fail("VALIDATION_ERROR", 422, `Use a company address: @${body.email.split("@")[1]} is not an approved domain, and public mail providers (such as gmail.com) cannot be approved.`);
    const password = initialPassword();
    const created = await admin.auth.admin.createUser({ email: body.email, password, email_confirm: true, user_metadata: { first_name: body.firstName } });
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
    await admin.from("users").update({ must_change_password: true }).eq("id", authId);
    // the person is emailed their invitation with a one-time set-up link; the same link is also returned for the administrator, so a missing or failing mail provider leaves nobody locked out
    const inv = await sendInvitation({ actorId: actor.id, userId: authId, email: body.email, firstName: body.firstName, invitedBy: actor.name, fallbackAppUrl: new URL(req.url).origin, correlationId });
    return { id: authId, initialPassword: password, setupLink: inv.setupLink, invitation: { outcome: inv.outcome, message: inv.message } };
  },
);
