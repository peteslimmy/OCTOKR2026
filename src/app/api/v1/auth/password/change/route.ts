import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { checkPassword, describeIssues } from "@/lib/domain/password-policy";
import { env } from "@/lib/env";
import { userClient } from "@/lib/supabase/server";

/** Changes the caller's password after re-checking the current one; other sessions are signed out. */
export const POST = api(
  { body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }) },
  async ({ actor, body, rpc }) => {
    if (await rateLimited(`pwd:change:${actor.id}`, 5, 15 * 60_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait and try again.");
    if (await rpc<boolean>("user_is_locked", { p_user: actor.id })) throw fail("AUTHENTICATION_FAILED", 401, "Your current password is not correct.");
    // verify the current password on a throwaway client so the caller's own session is untouched
    const e = env();
    const probe = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: badCurrent } = await probe.auth.signInWithPassword({ email: actor.email, password: body.currentPassword });
    if (badCurrent) {
      await rpc("record_login_failure", { p_email: actor.email });
      throw fail("AUTHENTICATION_FAILED", 401, "Your current password is not correct.");
    }
    if (body.newPassword === body.currentPassword) throw fail("PASSWORD_POLICY", 422, "Choose a password different from your current one.");
    const issues = checkPassword(body.newPassword, actor.email);
    if (issues.length) throw fail("PASSWORD_POLICY", 422, `Choose a stronger password: ${describeIssues(issues).join("; ")}.`, issues);
    const sb = await userClient();
    const { error } = await sb.auth.updateUser({ password: body.newPassword });
    if (error) throw fail("PASSWORD_POLICY", 422, "That password was not accepted. Choose a different, stronger one.");
    await rpc("record_password_changed", { p_user: actor.id, p_kind: "CHANGE" });
    await sb.auth.signOut({ scope: "others" });
    return { ok: true };
  },
);
