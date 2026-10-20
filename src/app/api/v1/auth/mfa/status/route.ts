import { api } from "@/lib/api/handler";
import { userClient } from "@/lib/supabase/server";

/** The caller's authenticator state. Allowed for password-only sessions so the UI can route them to the challenge or to enrolment. */
export const GET = api({ partial: true }, async ({ actor }) => {
  const sb = await userClient();
  const { data } = await sb.auth.mfa.listFactors();
  const totp = data?.totp?.[0] ?? null;
  const { data: rec } = await sb.rpc("read_my_recovery_status");
  return { ...actor.mfa, factor: totp ? { id: totp.id, createdAt: totp.created_at } : null, recoveryCodesRemaining: (rec as { remaining?: number } | null)?.remaining ?? 0 };
});
