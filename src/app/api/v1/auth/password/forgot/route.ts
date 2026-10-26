import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/api/client-ip";
import { userClient } from "@/lib/supabase/server";

/** Always answers the same way, whether or not the account exists (anti-enumeration). The link is single-use and expires in an hour. */
export const POST = api({ public: true, body: z.object({ email: z.string().trim().toLowerCase().email().max(200) }) }, async ({ body, req, rpc }) => {
  const ip = clientIp(req);
  if (await rateLimited(`forgot:ip:${ip}`, 10, 15 * 60_000) || await rateLimited(`forgot:acct:${body.email}`, 3, 15 * 60_000)) {
    throw fail("RATE_LIMITED", 429, "Too many requests. Please wait a few minutes and try again.");
  }
  const sb = await userClient();
  const { error } = await sb.auth.resetPasswordForEmail(body.email);
  if (error) console.error("password reset email failed:", error.message); // never surfaced: the caller must not learn anything
  await rpc("record_password_reset_requested", { p_email: body.email });
  return { ok: true };
});
