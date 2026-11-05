import { randomBytes } from "node:crypto";
import { z } from "zod";
import { api, ApiError, fail, requirePerm } from "@/lib/api/handler";
import { checkSignIns } from "@/lib/import/sign-ins-server";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Sign-in import, step 2 (ADR-080): creates each person's sign-in and roles through the same function the Add user screen uses (provision_user), so the same
 * rules and audit apply. Nobody chooses a password: each person gets a one-time set-your-password link. Every row is re-checked here; a row that fails is
 * reported and the others still go ahead (an identity is created per person, so the batch is not one database transaction). Needs users.manage and a fresh code.
 */
const body = z.object({ people: z.array(z.object({ row: z.number().int(), email: z.string().email().max(200), roles: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/)).min(1).max(20) }).strict()).min(1).max(500) });
export const POST = api({ stepUp: true, body }, async ({ actor, body: b, correlationId, rpc }) => {
  requirePerm(actor, "users.manage");
  const { ok, problems } = await checkSignIns(b.people.map((p) => ({ ...p, email: p.email.toLowerCase() })), actor);
  const admin = adminClient(correlationId);
  const results: { row: number; email: string; created: boolean; message: string | null; setupLink: string | null }[] = problems.map((p) => ({ row: p.row, email: b.people.find((x) => x.row === p.row)?.email ?? "", created: false, message: p.message, setupLink: null }));
  const made: { userId: string; email: string; roles: string[] }[] = [];
  for (const p of ok) {
    const { data: emp } = await admin.from("employees").select("first_name, last_name, business_unit_id").eq("email", p.email).single();
    if (!emp) { results.push({ row: p.row, email: p.email, created: false, message: "The employee could not be read.", setupLink: null }); continue; }
    const created = await admin.auth.admin.createUser({ email: p.email, password: randomBytes(24).toString("base64url"), email_confirm: true });
    if (created.error || !created.data.user) { results.push({ row: p.row, email: p.email, created: false, message: "That email address cannot be used for a sign-in.", setupLink: null }); continue; }
    try {
      await rpc("provision_user", { p_actor: actor.id, p_auth_id: created.data.user.id, p_email: p.email, p_first: emp.first_name, p_last: emp.last_name, p_bu: emp.business_unit_id, p_roles: p.roles });
    } catch (e) {
      await admin.auth.admin.deleteUser(created.data.user.id);
      results.push({ row: p.row, email: p.email, created: false, message: e instanceof ApiError ? e.err.message : "Could not be created.", setupLink: null });
      continue;
    }
    made.push({ userId: created.data.user.id, email: p.email, roles: p.roles });
    const link = await admin.auth.admin.generateLink({ type: "recovery", email: p.email });
    results.push({ row: p.row, email: p.email, created: true, message: null, setupLink: link.data?.properties?.action_link ?? null });
  }
  if (!results.length) throw fail("VALIDATION_ERROR", 422, "Nobody to create.");
  // a record of who this import created, so a Super Admin can roll it back inside the window (ADR-088)
  const batchId = made.length ? await rpc<string>("record_sign_in_import", { p_actor: actor.id, p_users: made }) : null;
  return { results: results.sort((a, b2) => a.row - b2.row), created: results.filter((r) => r.created).length, batchId };
});
