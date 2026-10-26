import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";
import { isPlainRecipient, type Mail } from "@/lib/email/deliver";
import { configuredTransport } from "@/lib/email/transport";

/**
 * Emailed one-time passcodes, the second factor for people who have no authenticator app (ADR-052).
 *
 * The passcode never leaves the server except in the mail: only its keyed hash is stored, and the hash is bound to the
 * person and to the purpose, so a sign-in code cannot be replayed as a step-up or an enrolment code.
 */
export type EmailPurpose = "LOGIN" | "STEP_UP" | "ENROL";

/** How long a mailed code stays usable. */
export const EMAIL_CODE_TTL_SECONDS = 10 * 60;
/** Wrong guesses allowed against one mailed code before it is thrown away. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export const normaliseEmailCode = (input: string) => input.replace(/\D/g, "");
export const looksLikeEmailCode = (input: string) => /^\d{6}$/.test(normaliseEmailCode(input));

export function hashEmailCode(userId: string, purpose: EmailPurpose, code: string): string {
  return createHmac("sha256", env().MFA_EMAIL_PEPPER).update(`${userId}:${purpose}:${normaliseEmailCode(code)}`).digest("hex");
}

const SUBJECTS: Record<EmailPurpose, string> = {
  LOGIN: "Your 4CORE-OKR sign-in code",
  STEP_UP: "Your 4CORE-OKR confirmation code",
  ENROL: "Your 4CORE-OKR email code",
};

const OPENERS: Record<EmailPurpose, string> = {
  LOGIN: "Use this code to finish signing in",
  STEP_UP: "Use this code to confirm this change",
  ENROL: "Use this code to turn on email codes",
};

/** The code mail: the code first, then when it stops working and what to do if it was not expected. */
export function emailCodeMail(purpose: EmailPurpose, code: string): Omit<Mail, "to"> {
  const minutes = Math.round(EMAIL_CODE_TTL_SECONDS / 60);
  return {
    subject: SUBJECTS[purpose],
    text:
      `${OPENERS[purpose]}:\n\n    ${code}\n\n` +
      `It works once and expires in ${minutes} minutes.\n` +
      `If you did not ask for it, someone may know your password: change it now and tell your administrator.`,
  };
}

export async function currentSessionId(): Promise<string | null> {
  const sb = await userClient();
  const { data } = await sb.auth.getClaims();
  return (data?.claims as { session_id?: string } | undefined)?.session_id ?? null;
}

export type SendResult = { ok: true } | { ok: false; reason: "EMAIL_UNAVAILABLE" | "EMAIL_SEND_FAILED" | "AUTHENTICATION_REQUIRED" };

/**
 * Issue a code for the caller's current session and mail it. The challenge is created before the mail is sent and
 * cancelled if sending fails, so a mail that never arrived can never be guessed against a live challenge.
 */
export async function sendEmailCode(userId: string, address: string, purpose: EmailPurpose): Promise<SendResult> {
  const transport = configuredTransport();
  if (!transport) return { ok: false, reason: "EMAIL_UNAVAILABLE" };
  if (!isPlainRecipient(address)) return { ok: false, reason: "EMAIL_SEND_FAILED" };
  const sessionId = await currentSessionId();
  if (!sessionId) return { ok: false, reason: "AUTHENTICATION_REQUIRED" };

  const code = generateEmailCode();
  const admin = adminClient();
  const { data: challenge, error } = await admin.rpc("mfa_email_begin", {
    p_user: userId,
    p_session_id: sessionId,
    p_purpose: purpose,
    p_code_hash: hashEmailCode(userId, purpose, code),
    p_ttl_seconds: EMAIL_CODE_TTL_SECONDS,
  });
  if (error || typeof challenge !== "string") {
    console.error("could not create an email code challenge:", error?.message ?? "no id returned");
    return { ok: false, reason: "EMAIL_SEND_FAILED" };
  }

  try {
    await transport.send({ to: address, ...emailCodeMail(purpose, code) });
  } catch (e) {
    await admin.rpc("mfa_email_cancel", { p_challenge: challenge });
    console.error("could not send an email code:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "EMAIL_SEND_FAILED" };
  }
  return { ok: true };
}

export type ConsumeStatus = "OK" | "INVALID" | "EXPIRED" | "LOCKED" | "TOO_MANY" | "NO_CHALLENGE";

/** Check a typed code. The database owns the attempt counter, the expiry, and the account lock. */
export async function consumeEmailCode(userId: string, purpose: EmailPurpose, code: string): Promise<ConsumeStatus> {
  const sessionId = await currentSessionId();
  if (!sessionId) return "NO_CHALLENGE";
  const { data, error } = await adminClient().rpc("mfa_email_consume", {
    p_user: userId,
    p_session_id: sessionId,
    p_purpose: purpose,
    p_code_hash: hashEmailCode(userId, purpose, code),
    p_max_attempts: EMAIL_CODE_MAX_ATTEMPTS,
  });
  if (error) {
    console.error("could not check an email code:", error.message);
    return "NO_CHALLENGE";
  }
  const status = (data as { status?: ConsumeStatus } | null)?.status;
  return status ?? "NO_CHALLENGE";
}
