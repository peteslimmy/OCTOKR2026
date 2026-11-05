import "server-only";
import { ApiError, fail } from "@/lib/api/handler";
import { interpretTechnicalError } from "./history-explain";

/**
 * Runs a step of the historical import and, when the database refuses it for a reason that has no friendly code of its own (an internal error, a duplicate key, a timeout...),
 * answers with what happened, what to do and the technical detail, instead of "something went wrong". Only the Super Admin tier can reach these routes.
 * Errors that already carry a clear code (permission, step-up, state, validation with details) pass through untouched.
 */
export async function explaining<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const unexplained = e instanceof ApiError && !!e.raw && (["INTERNAL_ERROR", "CONFLICT"].includes(e.err.code) || (e.err.code === "VALIDATION_ERROR" && !e.err.details));
    if (unexplained) {
      const raw = (e as ApiError).raw as string;
      const x = interpretTechnicalError(raw);
      throw fail("IMPORT_FAILED", 422, `${step} failed: ${x.problem}`, { problem: x.problem, fix: x.fix, technical: raw.slice(0, 400) });
    }
    throw e;
  }
}
