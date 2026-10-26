import { api } from "@/lib/api/handler";
import { userClient } from "@/lib/supabase/server";

/** The caller's second-factor state. Allowed for password-only sessions so the UI can route them to the challenge or to enrolment. */
export const GET = api({ partial: true }, async ({ actor }) => {
  const sb = await userClient();
  const { data } = await sb.auth.mfa.listFactors();
  const totp = data?.totp?.[0] ?? null;
  const { data: rec } = await sb.rpc("read_my_recovery_status");
  const { data: live } = await sb.rpc("read_my_mfa_status");
  const s = live as { required: boolean; enrolled: boolean; totp: boolean; email: boolean; emailVerifiedAt: string | null; aal: "aal1" | "aal2" } | null;
  return {
    required: s?.required ?? actor.mfa.required,
    enrolled: s?.enrolled ?? actor.mfa.enrolled,
    totp: s?.totp ?? actor.mfa.totp,
    email: s?.email ?? actor.mfa.email,
    emailVerified: (s?.emailVerifiedAt ?? null) !== null,
    emailVerifiedAt: s?.emailVerifiedAt ?? null,
    aal: s?.aal ?? actor.mfa.aal,
    factor: totp ? { id: totp.id, createdAt: totp.created_at } : null,
    recoveryCodesRemaining: (rec as { remaining?: number } | null)?.remaining ?? 0,
  };
});
