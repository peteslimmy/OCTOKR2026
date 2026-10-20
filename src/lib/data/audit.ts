import "server-only";
import { userClient } from "@/lib/supabase/server";
import { unwrapRows } from "./audit-unwrap";

export interface AuditFilter {
  action?: string;       // starts with, case-insensitive: "ROLE_" finds every role event
  entityType?: string;   // exact
  outcome?: string;      // exact: SUCCESS, DENIED, FAILURE ...
  from?: string;         // YYYY-MM-DD, inclusive, Lagos calendar day
  to?: string;           // YYYY-MM-DD, inclusive
  q?: string;            // an exact entity id, or words in the reason
}
export interface AuditRow {
  id: string; seq: number; occurred_at: string; actor_user_id: string | null; actor_role: string | null; action: string; entity_type: string; entity_id: string | null;
  reason: string | null; outcome: string; old_values: unknown; new_values: unknown; correlation_id: string | null;
}
export interface AuditPage { rows: AuditRow[]; nextCursor: string | null }

const COLUMNS = "id, seq, occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, reason, outcome, old_values, new_values, correlation_id";
export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_MAX_PAGE_SIZE = 500;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Characters that have a meaning in a PostgREST filter expression are dropped from free text, so a search can never change the filter itself. */
const plain = (s: string) => s.replace(/[,()%*\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

/** Newest first, keyset-paged on the audit sequence number: a page costs the same however much history exists. `cursor` is the seq of the last row seen. */
export async function pageAudit(filter: AuditFilter, cursor: string | null, limit = AUDIT_PAGE_SIZE): Promise<AuditPage> {
  const size = Math.min(Math.max(1, Math.floor(limit)), AUDIT_MAX_PAGE_SIZE);
  const sb = await userClient();
  let q = sb.from("audit_logs").select(COLUMNS).order("seq", { ascending: false }).limit(size + 1);
  if (cursor && /^\d{1,18}$/.test(cursor)) q = q.lt("seq", Number(cursor));
  if (filter.action) q = q.ilike("action", `${plain(filter.action).replace(/_/g, "\\_")}%`);
  if (filter.entityType) q = q.eq("entity_type", plain(filter.entityType));
  if (filter.outcome) q = q.eq("outcome", plain(filter.outcome).toUpperCase());
  if (filter.from && DAY.test(filter.from)) q = q.gte("occurred_at", `${filter.from}T00:00:00+01:00`);
  if (filter.to && DAY.test(filter.to)) {
    const next = new Date(`${filter.to}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    q = q.lt("occurred_at", `${next.toISOString().slice(0, 10)}T00:00:00+01:00`);
  }
  const text = filter.q ? plain(filter.q) : "";
  if (text) q = q.or(`entity_id.eq.${text},reason.ilike.%${text}%`);
  const rows = unwrapRows<AuditRow>(await q, "audit");
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  return { rows: page, nextCursor: more ? String(page[page.length - 1].seq) : null };
}

/** Everything that matches, up to a cap, for a file the person asked to download. */
export async function allAudit(filter: AuditFilter, cap = 10_000): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  const out: AuditRow[] = [];
  let cursor: string | null = null;
  while (out.length < cap) {
    const page: AuditPage = await pageAudit(filter, cursor, Math.min(AUDIT_MAX_PAGE_SIZE, cap - out.length));
    out.push(...page.rows);
    if (!page.nextCursor) return { rows: out, truncated: false };
    cursor = page.nextCursor;
  }
  return { rows: out, truncated: true };
}

export function filterFrom(params: URLSearchParams | Record<string, string | string[] | undefined>): AuditFilter {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  return { action: get("action"), entityType: get("type"), outcome: get("outcome"), from: get("from"), to: get("to"), q: get("q") };
}
