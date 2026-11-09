/**
 * The two tiers of the audit log (ADR-121). Everyone who may read the log (audit.read) sees the summary: what happened, who, when, the outcome, severity, category and reason.
 * Only a Super Admin holding audit.read_detail also sees the technical detail: network address, location, device, browser, session and request ids, raw old and new values and the integrity chain.
 * The database enforces it with column privileges; this is the same rule for the server code that reads with the service role.
 */
export const canSeeAuditDetail = (actor: { permissions: ReadonlySet<string>; roles: readonly string[] }) =>
  actor.permissions.has("audit.read_detail") && actor.roles.includes("SUPER_ADMIN");

export const AUDIT_SUMMARY_COLUMNS = "id, seq, occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, reason, outcome, event_category, severity, channel, actor_name, actor_bu_name, actor_scope";
export const AUDIT_DETAIL_COLUMNS = "id, seq, occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, reason, outcome, old_values, new_values, correlation_id, event_category, severity, channel, request_id, workflow_id, related_approval_id, session_ref, actor_name, actor_email, actor_bu_name, actor_scope, ip_address, ip_trusted, user_agent, browser, os, device, metadata, chain_seq, row_hash";
/** Filters that need a detail column: ignored for a summary viewer. */
export const DETAIL_ONLY_FILTERS = ["ip", "session", "request"] as const;
