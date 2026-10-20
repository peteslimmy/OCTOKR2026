import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { userClient } from "@/lib/supabase/server";

/** Starts TOTP enrolment: returns the QR code and secret once. The factor is inactive until a code is verified. */
export const POST = api({ partial: true }, async ({ actor }) => {
  if (await rateLimited(`mfa:enroll:${actor.id}`, 5, 600_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait and try again.");
  const sb = await userClient();
  const { data: list } = await sb.auth.mfa.listFactors();
  if (list?.totp?.length) throw fail("MFA_ALREADY_ENROLLED", 409, "An authenticator app is already set up for this account.");
  for (const f of list?.all ?? []) if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id }); // abandoned attempts
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", issuer: "4CORE-OKR", friendlyName: `Authenticator ${new Date().toISOString()}` });
  if (error || !data) throw fail("MFA_ENROLL_FAILED", 502, "The authenticator could not be set up. Try again.");
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
});
