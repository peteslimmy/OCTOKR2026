import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/api/client-ip";
import { userClient } from "@/lib/supabase/server";

const GENERIC = "Invalid email or password.";

export const POST = api(
  { public: true, body: z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) }) },
  async ({ body, req, rpc }) => {
    const ip = clientIp(req);
    // the two limiters and the lock check do not depend on each other: ask all three at once
    const [ipLimited, acctLimited, locked] = await Promise.all([
      rateLimited(`login:ip:${ip}`, 30, 60_000), rateLimited(`login:acct:${body.email}`, 10, 60_000), rpc<boolean>("login_lock_status", { p_email: body.email }),
    ]);
    if (ipLimited || acctLimited) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait a minute and try again.");
    // Anti-enumeration: every failure path returns the same message.
    if (locked) throw fail("AUTHENTICATION_FAILED", 401, GENERIC);
    const sb = await userClient();
    const { data, error } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error || !data.user) {
      await rpc("record_login_failure", { p_email: body.email });
      throw fail("AUTHENTICATION_FAILED", 401, GENERIC);
    }
    const { data: profile } = await sb.from("users").select("status").eq("id", data.user.id).maybeSingle();
    const domainOk = await rpc<boolean>("login_domain_allowed", { p_user: data.user.id });
    if ((profile as { status: string } | null)?.status !== "ACTIVE" || !domainOk) {
      await sb.auth.signOut();
      await rpc("record_login_failure", { p_email: body.email });
      throw fail("AUTHENTICATION_FAILED", 401, GENERIC);
    }
    // Second factor: a password alone yields an AAL1 session, which the API, the pages and row-level security all treat as incomplete.
    // Supabase only raises the level itself for authenticator apps, so ask our own status (it also covers emailed codes).
    const { data: status } = await sb.rpc("read_my_mfa_status");
    const s = status as { required: boolean; enrolled: boolean; totp: boolean; email: boolean; aal: "aal1" | "aal2" } | null;
    const enrolled = !!s?.enrolled;
    if (enrolled && (s?.aal ?? "aal1") !== "aal2") {
      return { ok: false, mfaRequired: true, methods: { totp: !!s?.totp, email: !!s?.email } };
    }
    await rpc("record_login_success", { p_user: data.user.id });
    return { ok: true, mfaEnrolmentRequired: !!s?.required && !enrolled };
  },
);
