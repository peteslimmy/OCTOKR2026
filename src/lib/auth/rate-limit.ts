import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Sliding-window attempt limiter.
 *
 * `database` (the default in production): every copy of the application counts in one shared place (rate_limit_hit), so a restart or a second
 * instance cannot be used to get fresh attempts. If the database cannot be reached the in-process counter is used instead, so sign-in stays
 * protected on that instance rather than becoming unprotected or unavailable.
 * `memory` (the default outside production, and set by the test runners so tests are independent): counts inside this process only.
 */
const hits = new Map<string, number[]>();

export type RateLimitStore = "database" | "memory";
export function rateLimitStore(): RateLimitStore {
  const configured = process.env.RATE_LIMIT_STORE;
  if (configured === "memory" || configured === "database") return configured;
  return process.env.NODE_ENV === "production" ? "database" : "memory";
}

function inMemory(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return recent.length > max;
}

/** Records an attempt and returns true when the person has gone over the limit. */
export async function rateLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  if (rateLimitStore() === "memory") return inMemory(key, max, windowMs);
  try {
    const { data, error } = await adminClient().rpc("rate_limit_hit", { p_key: key, p_max: max, p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)) });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (e) {
    console.error("shared rate limiter unavailable, using this instance's counter:", e instanceof Error ? e.message : e);
    return inMemory(key, max, windowMs);
  }
}
