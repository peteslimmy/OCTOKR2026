import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { sendEmailCode } from "@/lib/auth/email-otp";
import { rateLimited } from "@/lib/auth/rate-limit";
import { userClient } from "@/lib/supabase/server";

/**
 * Mails a one-time code for the caller's current session. `partial`: a password-only session must be able to ask for the code
 * that finishes sign-in. Sign-in and step-up codes exist only once email codes are turned on; the enrolment code is always
 * available so the factor can be set up in the first place.
 */
export const POST = api({ partial: true, body: z.object({ purpose: z.enum(["LOGIN", "STEP_UP", "ENROL"]) }) }, async ({ actor, body }) => {
  if (await rateLimited(`mfa:email:send:${actor.id}`, 5, 600_000)) throw fail("RATE_LIMITED", 429, "Too many codes requested. Please wait and try again.");
  if (await rateLimited(`mfa:email:send:${actor.id}:burst`, 1, 60_000)) throw fail("RATE_LIMITED", 429, "Please wait a minute before asking for another code.");

  if (body.purpose !== "ENROL") {
    const sb = await userClient();
    const { data } = await sb.rpc("read_my_mfa_status");
    if (!(data as { email?: boolean } | null)?.email) throw fail("MFA_NOT_ENROLLED", 409, "Email codes are not turned on for this account.");
  }

  const sent = await sendEmailCode(actor.id, actor.email, body.purpose);
  if (sent.ok) return { ok: true };
  if (sent.reason === "EMAIL_UNAVAILABLE") throw fail("EMAIL_UNAVAILABLE", 503, "Email is not configured, so a code cannot be sent.");
  if (sent.reason === "AUTHENTICATION_REQUIRED") throw fail("AUTHENTICATION_REQUIRED", 401, "Please sign in again to continue.");
  throw fail("EMAIL_SEND_FAILED", 502, "The code could not be sent. Please try again.");
});
