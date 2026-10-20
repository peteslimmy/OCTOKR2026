import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

function same(provided: Buffer, expected: string): boolean {
  const e = Buffer.from(expected);
  return provided.length === e.length && timingSafeEqual(provided, e);
}

/**
 * The shared secret of the scheduler and the monitor. During a rotation both the new (JOBS_SECRET) and the old (JOBS_SECRET_PREVIOUS) value work,
 * so the scheduler can be switched over without a gap; remove JOBS_SECRET_PREVIOUS afterwards. Both comparisons always run, in constant time.
 */
export function jobsSecretMatches(header: string | null): boolean {
  const provided = Buffer.from(header ?? "");
  const e = env();
  const current = same(provided, e.JOBS_SECRET);
  const previous = e.JOBS_SECRET_PREVIOUS ? same(provided, e.JOBS_SECRET_PREVIOUS) : false;
  return current || previous;
}
