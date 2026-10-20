/** Turns the raw health figures into the alerts a monitor should act on. Pure, so every rule is unit tested. */
export interface HealthFigures {
  scheduler_last_run_at: string | null; scheduler_age_seconds: number | null;
  email_pending: number; email_oldest_pending_minutes: number | null; email_failed: number;
  webhook_oldest_pending_minutes?: number | null; webhook_failed?: number;
  job_failures_24h: number; clock_override_present: boolean; schedule_version: number | null;
}
export interface HealthContext { production: boolean; rateLimitStore: "database" | "memory"; emailTransport: string; privateHostsAllowed?: boolean }
export interface HealthAlert { code: string; severity: "critical" | "warning" | "info"; message: string }

export const SCHEDULER_SILENT_SECONDS = 5 * 60;
export const OUTBOX_STUCK_MINUTES = 60;

export function healthAlerts(h: HealthFigures, ctx: HealthContext): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  if (h.scheduler_age_seconds === null) alerts.push({ code: "SCHEDULER_NEVER_RAN", severity: ctx.production ? "critical" : "info", message: "The scheduler has never run. Locks, finalisation and reminders do not happen without it." });
  else if (h.scheduler_age_seconds > SCHEDULER_SILENT_SECONDS) alerts.push({ code: "SCHEDULER_SILENT", severity: "critical", message: `The scheduler last ran ${Math.round(h.scheduler_age_seconds / 60)} minutes ago; it should run every minute.` });
  if (h.job_failures_24h > 0) alerts.push({ code: "JOB_FAILURES", severity: "critical", message: `${h.job_failures_24h} scheduled job step(s) failed in the last 24 hours (see the audit log, JOB_FAILED).` });
  if (h.email_oldest_pending_minutes !== null && h.email_oldest_pending_minutes > OUTBOX_STUCK_MINUTES) alerts.push({ code: "EMAIL_STUCK", severity: "warning", message: `The oldest queued email has waited ${h.email_oldest_pending_minutes} minutes.` });
  if (h.email_failed > 0) alerts.push({ code: "EMAIL_FAILED", severity: "warning", message: `${h.email_failed} email(s) failed after all attempts.` });
  if (ctx.production && h.clock_override_present) alerts.push({ code: "CLOCK_OVERRIDE_IN_PRODUCTION", severity: "critical", message: "A development clock override is set on the production database. Every deadline would be wrong." });
  if (ctx.production && ctx.rateLimitStore === "memory") alerts.push({ code: "RATE_LIMIT_NOT_SHARED", severity: "warning", message: "Sign-in attempt limits are kept per instance and are lost on restart. Set RATE_LIMIT_STORE=database." });
  if ((h.webhook_failed ?? 0) > 0) alerts.push({ code: "WEBHOOK_FAILED", severity: "warning", message: `${h.webhook_failed} webhook delivery(ies) failed after all attempts in the last 24 hours.` });
  if ((h.webhook_oldest_pending_minutes ?? 0) > OUTBOX_STUCK_MINUTES) alerts.push({ code: "WEBHOOK_STUCK", severity: "warning", message: `The oldest queued webhook event has waited ${h.webhook_oldest_pending_minutes} minutes.` });
  if (ctx.production && ctx.privateHostsAllowed) alerts.push({ code: "PRIVATE_HOSTS_ALLOWED", severity: "critical", message: "INTEGRATIONS_ALLOW_PRIVATE_HOSTS is on in production: integrations may call internal addresses. Remove it." });
  if (ctx.emailTransport === "unusable") alerts.push({ code: "EMAIL_INTEGRATION_UNUSABLE", severity: "critical", message: "The email integration is enabled but cannot be used (for example its encryption key is missing). Mail is waiting." });
  if (ctx.emailTransport === "none") alerts.push({ code: "EMAIL_NOT_CONFIGURED", severity: "info", message: "No email provider is configured. Reminders appear in the application only." });
  return alerts;
}
