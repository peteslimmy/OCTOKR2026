import { api, requirePerm } from "@/lib/api/handler";
import { AUDIT_PAGE_SIZE, filterFrom, pageAudit } from "@/lib/data/audit";

/**
 * The audit log, newest first, one page at a time. Filters: action (starts with), type, outcome, from and to (YYYY-MM-DD), q (entity id or words in the reason).
 * `cursor` is the nextCursor of the previous page; `limit` is at most 500.
 */
export const GET = api({}, async ({ actor, req }) => {
  requirePerm(actor, "audit.read");
  const u = new URL(req.url);
  const limit = Number(u.searchParams.get("limit") ?? AUDIT_PAGE_SIZE);
  return pageAudit(filterFrom(u.searchParams), u.searchParams.get("cursor"), Number.isFinite(limit) ? limit : AUDIT_PAGE_SIZE);
});
