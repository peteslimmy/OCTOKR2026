import { dbError } from "./errors";

/** The rows of a query, or a domain error that names what was being read. */
export function unwrapRows<T>(res: { data: unknown; error: { message: string; code?: string } | null }, what: string): T[] {
  if (res.error) throw dbError(res.error, what);
  return (res.data as T[]) ?? [];
}
