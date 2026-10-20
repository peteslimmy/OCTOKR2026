import "server-only";
import { ApiError } from "@/lib/api/handler";
import { toDomainError } from "@/lib/domain/errors";

/**
 * Converts a database/PostgREST error from a read model into a stable domain error
 * (e.g. PERMISSION_DENIED -> 403) and logs the original server-side. Never leaks raw SQL to callers.
 */
export function dbError(error: { message: string; details?: string | null; code?: string }, what: string): ApiError {
  const domain = toDomainError(error);
  if (domain.code === "INTERNAL_ERROR") console.error(`[data] ${what}: ${error.message}`);
  return new ApiError(domain);
}
