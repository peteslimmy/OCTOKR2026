import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";
import { AUDIT_DETAIL_COLUMNS, AUDIT_SUMMARY_COLUMNS } from "@/lib/audit/detail";
import { unwrapRows } from "./audit-unwrap";
import { dbError } from "./errors";

export interface AuditFilter {
  action?: string;       // starts with, case-insensitive: "ROLE_" finds every role event
  entityType?: string;   // exact
  entityId?: string;     // exact record id
  outcome?: string;      // exact: SUCCESS, DENIED, FAILURE, REJECTED, PARTIAL
  severity?: string;     // exact: INFO .. CRITICAL
  category?: string;     // exact category code
  actor?: string;        // a person's name or e-mail (words), or their user id
  role?: string;         // a role code held at the time
  bu?: string;           // business-unit name (words) of the actor at the time
  ip?: string;           // exact source address
  session?: string;      // exact session reference
  request?: string;      // exact request id
  channel?: string;      // WEB, API, SYSTEM, BACKGROUND_JOB
  from?: string;         // YYYY-MM-DD, inclusive, Lagos calendar day
  to?: string;           // YYYY-MM-DD, inclusive
  q?: string;            // an exact entity id, or words in the reason
}
export interface AuditRow {
  id: string; seq: number; occurred_at: string; actor_user_id: string | null; actor_role: string | null; action: string; entity_type: string; entity_id: string | null;
  reason: string | null; outcome: string; old_values?: unknown; new_values?: unknown; correlation_id?: string | null;
  event_category: string | null; severity: string | null; channel: string | null; request_id?: string | null; workflow_id?: string | null; related_approval_id?: string | null;
  session_ref?: string | null; actor_name: string | null; actor_email?: string | null; actor_bu_name: string | null; actor_scope: string | null;
  ip_address?: string | null; ip_trusted?: boolean | null; user_agent?: string | null; browser?: string | null; os?: string | null; device?: string | null;
  metadata?: unknown; chain_seq?: number | null; row_hash?: string | null;
}
export interface AuditPage { rows: AuditRow[]; nextCursor: string | null }

// the columns of each tier live in lib/audit/detail.ts
export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_MAX_PAGE_SIZE = 500;
export const AUDIT_CATEGORIES = ["AUTHENTICATION", "SECURITY", "ROLES_PERMISSIONS", "USER_LIFECYCLE", "CONFIGURATION", "SCHEDULING", "STRATEGY", "REPORTING", "INTEGRITY", "ATTENDANCE_HR", "FINANCE", "FILES_EXPORT", "GOVERNANCE", "ORGANISATION", "SYSTEM", "OTHER"] as const;
export const AUDIT_OUTCOMES = ["SUCCESS", "FAILURE", "DENIED", "REJECTED", "PARTIAL"] as const;
export const AUDIT_SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const AUDIT_CHANNELS = ["WEB", "API", "SYSTEM", "BACKGROUND_JOB"] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Characters that have a meaning in a PostgREST filter expression are dropped from free text, so a search can never change the filter itself. */
export const plain = (s: string) => s.replace(/[,()%*\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
const oneOf = (v: string | undefined, list: readonly string[]) => (v && list.includes(v.toUpperCase()) ? v.toUpperCase() : undefined);

/** The Lagos calendar-day range of a filter as instants (Lagos is UTC+1 all year); with no dates, the last `defaultDays` days. */
export function filterRange(filter: AuditFilter, defaultDays = 7): { from: string; to: string } {
  const to = filter.to && DAY.test(filter.to)
    ? (() => { const n = new Date(`${filter.to}T00:00:00Z`); n.setUTCDate(n.getUTCDate() + 1); return `${n.toISOString().slice(0, 10)}T00:00:00+01:00`; })()
    : new Date(Date.now() + 60_000).toISOString();
  const from = filter.from && DAY.test(filter.from) ? `${filter.from}T00:00:00+01:00` : new Date(Date.now() - defaultDays * 86_400_000).toISOString();
  return { from, to };
}

// the query builder's generic type is not worth spelling out; every method used here returns the same builder
function applyFilter<T>(query: T, filter: AuditFilter, detail = true): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let x = query as any;
  if (filter.action) x = x.ilike("action", `${plain(filter.action).replace(/_/g, "\\_")}%`);
  if (filter.entityType) x = x.eq("entity_type", plain(filter.entityType));
  if (filter.entityId) x = x.eq("entity_id", plain(filter.entityId));
  const outcome = oneOf(filter.outcome, AUDIT_OUTCOMES); if (outcome) x = x.eq("outcome", outcome);
  const severity = oneOf(filter.severity, AUDIT_SEVERITIES); if (severity) x = x.eq("severity", severity);
  const category = oneOf(filter.category, AUDIT_CATEGORIES); if (category) x = x.eq("event_category", category);
  const channel = oneOf(filter.channel, AUDIT_CHANNELS); if (channel) x = x.eq("channel", channel);
  if (filter.actor) {
    const a = plain(filter.actor);
    if (UUID.test(a)) x = x.eq("actor_user_id", a); else if (a) x = x.or(detail ? `actor_name.ilike.%${a}%,actor_email.ilike.%${a}%` : `actor_name.ilike.%${a}%`);
  }
  if (filter.role) x = x.ilike("actor_role", `%${plain(filter.role)}%`);
  if (filter.bu) x = x.ilike("actor_bu_name", `%${plain(filter.bu)}%`);
  // network address, session and request ids are detail columns: a summary viewer's filter on them is ignored
  if (detail && filter.ip) x = x.eq("ip_address", plain(filter.ip));
  if (detail && filter.session) x = x.eq("session_ref", plain(filter.session));
  if (detail && filter.request) x = x.eq("request_id", plain(filter.request));
  if (filter.from && DAY.test(filter.from)) x = x.gte("occurred_at", `${filter.from}T00:00:00+01:00`);
  if (filter.to && DAY.test(filter.to)) {
    const next = new Date(`${filter.to}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    x = x.lt("occurred_at", `${next.toISOString().slice(0, 10)}T00:00:00+01:00`);
  }
  const text = filter.q ? plain(filter.q) : "";
  if (text) x = x.or(`entity_id.eq.${text},reason.ilike.%${text}%`);
  return x as T;
}

/** Newest first, keyset-paged on the audit sequence number: a page costs the same however much history exists. `cursor` is the seq of the last row seen. */
export async function pageAudit(filter: AuditFilter, cursor: string | null, limit = AUDIT_PAGE_SIZE, detail = false): Promise<AuditPage> {
  const size = Math.min(Math.max(1, Math.floor(limit)), AUDIT_MAX_PAGE_SIZE);
  // detail (a Super Admin holding audit.read_detail, who is never shielded) reads every column with the service role; everyone else reads the summary columns as themselves, so row-level security and column privileges apply
  const sb = detail ? adminClient() : await userClient();
  let q = sb.from("audit_logs").select(detail ? AUDIT_DETAIL_COLUMNS : AUDIT_SUMMARY_COLUMNS).order("seq", { ascending: false }).limit(size + 1);
  if (cursor && /^\d{1,18}$/.test(cursor)) q = q.lt("seq", Number(cursor));
  q = applyFilter(q, filter, detail);
  const rows = unwrapRows<AuditRow>(await q, "audit");
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  return { rows: page, nextCursor: more ? String(page[page.length - 1].seq) : null };
}

/** Everything that matches, up to a cap, for a file the person asked to download. */
export async function allAudit(filter: AuditFilter, cap = 10_000, detail = false): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  const out: AuditRow[] = [];
  let cursor: string | null = null;
  while (out.length < cap) {
    const page: AuditPage = await pageAudit(filter, cursor, Math.min(AUDIT_MAX_PAGE_SIZE, cap - out.length), detail);
    out.push(...page.rows);
    if (!page.nextCursor) return { rows: out, truncated: false };
    cursor = page.nextCursor;
  }
  return { rows: out, truncated: true };
}

const KEYS: [keyof AuditFilter, string][] = [
  ["action", "action"], ["entityType", "type"], ["entityId", "entity"], ["outcome", "outcome"], ["severity", "severity"], ["category", "category"], ["actor", "actor"],
  ["role", "role"], ["bu", "bu"], ["ip", "ip"], ["session", "session"], ["request", "request"], ["channel", "channel"], ["from", "from"], ["to", "to"], ["q", "q"],
];
export function filterFrom(params: URLSearchParams | Record<string, string | string[] | undefined>): AuditFilter {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const f: AuditFilter = {};
  for (const [field, key] of KEYS) { const v = get(key); if (v) f[field] = v; }
  return f;
}
/** The filter as query-string parameters (for links that keep it). */
export function filterParams(filter: AuditFilter): URLSearchParams {
  const p = new URLSearchParams();
  for (const [field, key] of KEYS) { const v = filter[field]; if (v) p.set(key, v); }
  return p;
}

// ------------------------------------------------------------------ Centre reads (service role; the database re-checks audit.read for the named person)
async function centreRpc<T>(fn: string, args: Record<string, unknown>, what: string): Promise<T> {
  const { data, error } = await adminClient().rpc(fn, args);
  if (error) throw dbError(error, what);
  return data as T;
}
export interface AuditKpis {
  total: number; failed_or_denied: number; denied: number; failures: number; high_or_critical: number; actors: number; logins_failed: number; exports: number;
  config_changes: number; role_changes: number; by_category: Record<string, number>; open_alerts: number; chain: { chained: number | null; unchained_history: number };
}
export const auditKpis = (actorId: string, filter: AuditFilter) => {
  const r = filterRange(filter);
  return centreRpc<AuditKpis>("audit_centre_kpis", { p_actor: actorId, p_from: r.from, p_to: r.to }, "audit summary");
};
export interface TraceEvent { id: string; seq: number; occurred_at: string; action: string; outcome: string; severity: string | null; entity_type: string; entity_id: string | null; actor_name?: string | null }
export interface AuditTrace {
  event: AuditRow; chain: { chain_seq: number | null; prev_hash: string | null; row_hash: string | null; valid: boolean | null };
  same_request: TraceEvent[]; same_workflow: TraceEvent[]; same_session: TraceEvent[]; same_actor: TraceEvent[];
}
export const auditTrace = (actorId: string, eventId: string) => centreRpc<AuditTrace>("audit_centre_trace", { p_actor: actorId, p_event: eventId }, "audit event");

export interface AuditAlert {
  id: string; rule_code: string; severity: string; group_key: string; subject_label: string | null; event_count: number; first_event_at: string; last_event_at: string;
  evidence_event_ids: string[]; summary: string; status: string; status_note: string | null; status_at: string | null; created_at: string;
}
export interface AuditRule { code: string; name: string; description: string; enabled: boolean; severity: string; threshold: number; window_minutes: number; group_by: string; updated_at: string }
export async function listAlerts(status?: string): Promise<AuditAlert[]> {
  let q = (await userClient()).from("audit_alerts")
    .select("id, rule_code, severity, group_key, subject_label, event_count, first_event_at, last_event_at, evidence_event_ids, summary, status, status_note, status_at, created_at")
    .order("created_at", { ascending: false }).limit(200);
  if (status === "open") q = q.in("status", ["NEW", "UNDER_REVIEW"]);
  return unwrapRows<AuditAlert>(await q, "security alerts");
}
export async function listRules(): Promise<AuditRule[]> {
  return unwrapRows<AuditRule>(await (await userClient()).from("audit_detection_rules")
    .select("code, name, description, enabled, severity, threshold, window_minutes, group_by, updated_at").order("code"), "detection rules");
}
/** Viewing and exporting the audit log are themselves audited. */
export const recordAuditAccess = (actorId: string, kind: "VIEWED" | "CSV" | "PDF", detail: AuditFilter, rows: number | null) =>
  centreRpc<boolean>("record_audit_access", { p_actor: actorId, p_kind: kind, p_detail: detail, p_rows: rows }, "audit access record");
