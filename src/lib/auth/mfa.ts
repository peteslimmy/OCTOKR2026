import "server-only";
import { userClient } from "@/lib/supabase/server";

/** How long after the last successful TOTP check a high-risk action is still allowed without asking again. */
export const STEP_UP_WINDOW_SECONDS = 15 * 60;

/** Epoch seconds of the caller's most recent TOTP verification, read from the verified JWT's `amr` claim. */
export async function lastTotpAt(): Promise<number | null> {
  const sb = await userClient();
  const { data } = await sb.auth.getClaims();
  const amr = (data?.claims as { amr?: { method: string; timestamp: number }[] } | undefined)?.amr ?? [];
  const stamps = amr.filter((a) => a.method === "totp").map((a) => a.timestamp);
  return stamps.length ? Math.max(...stamps) : null;
}

export async function hasRecentTotp(): Promise<boolean> {
  const at = await lastTotpAt();
  return at !== null && Date.now() / 1000 - at <= STEP_UP_WINDOW_SECONDS;
}
