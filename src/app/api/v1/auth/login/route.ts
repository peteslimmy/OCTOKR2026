import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { userClient } from "@/lib/supabase/server";

const GENERIC = "Invalid email or password.";

export const POST = api(
  { public: true, body: z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) }) },
  async ({ body, req, rpc }) => {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    if (await rateLimited(`login:ip:${ip}`, 30, 60_000) || await rateLimited(`login:acct:${body.email}`, 10, 60_000)) {
      throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait a minute and try again.");
    }
    // Anti-enumeration: every failure path returns the same message.
    if (await rpc<boolean>("login_lock_status", { p_email: body.email })) throw fail("AUTHENTICATION_FAILED", 401, GENERIC);
    const sb = await userClient();
    const { data, error } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error || !data.user) {
      await rpc("record_login_failure", { p_email: body.email });
      throw fail("AUTHENTICATION_FAILED", 401, GENERIC);
    }
    const { data: profile } = await sb.from("users").select("status").eq("id", data.user.id).maybeSingle();
    if ((profile as { status: string } | null)?.status !== "ACTIVE") {
      await sb.auth.signOut();
      await rpc("record_login_failure", { p_email: body.email });
      throw fail("AUTHENTICATION_FAILED", 401, GENERIC);
    }
    // Second factor: a password alone yields an AAL1 session, which the API, the pages and row-level security all treat as incomplete.
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") return { ok: false, mfaRequired: true };
    await rpc("record_login_success", { p_user: data.user.id });
    const { data: status } = await sb.rpc("read_my_mfa_status");
    const s = status as { required: boolean; enrolled: boolean } | null;
    return { ok: true, mfaEnrolmentRequired: !!s?.required && !s.enrolled };
  },
);
