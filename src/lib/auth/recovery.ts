import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { normaliseRecoveryCode } from "./recovery-code";

export { RECOVERY_CODE_COUNT, generateRecoveryCodes, looksLikeRecoveryCode, normaliseRecoveryCode } from "./recovery-code";

/** Keyed hash (the server secret is the key), bound to the user, so a stolen table cannot be tested offline without that secret. */
export function hashRecoveryCode(userId: string, code: string): string {
  return createHmac("sha256", env().SUPABASE_SERVICE_ROLE_KEY).update(`${userId}:${normaliseRecoveryCode(code)}`).digest("hex");
}
