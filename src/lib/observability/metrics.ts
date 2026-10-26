import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

// Create a registry to register metrics
export const register = new Registry();

// Add default metrics (process, node, gc, etc.)
collectDefaultMetrics({ register, prefix: "nodejs_" });

// --- HTTP Request Metrics ---
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "handler", "status_code"],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "handler"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestSize = new Histogram({
  name: "http_request_size_bytes",
  help: "Size of HTTP request bodies in bytes",
  labelNames: ["method", "handler"],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
  registers: [register],
});

export const httpResponseSize = new Histogram({
  name: "http_response_size_bytes",
  help: "Size of HTTP response bodies in bytes",
  labelNames: ["method", "handler"],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000],
  registers: [register],
});

// --- Database Metrics ---
export const dbQueryDuration = new Histogram({
  name: "db_query_duration_seconds",
  help: "Duration of database queries in seconds",
  labelNames: ["operation", "table"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

export const dbQueriesTotal = new Counter({
  name: "db_queries_total",
  help: "Total number of database queries",
  labelNames: ["operation", "table", "result"],
  registers: [register],
});

export const dbConnectionPool = new Gauge({
  name: "db_connection_pool_usage",
  help: "Database connection pool usage (0-1)",
  labelNames: ["pool"],
  registers: [register],
});

// --- Business Metrics ---
export const weeklyReportsTotal = new Counter({
  name: "weekly_reports_total",
  help: "Total weekly reports by status",
  labelNames: ["status", "business_unit"],
  registers: [register],
});

export const weeklyReportScore = new Histogram({
  name: "weekly_report_score",
  help: "Weekly report final score",
  labelNames: ["business_unit"],
  buckets: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  registers: [register],
});

export const violationsTotal = new Counter({
  name: "violations_total",
  help: "Total violations by type and status",
  labelNames: ["type", "status", "business_unit"],
  registers: [register],
});

export const fundBalance = new Gauge({
  name: "violation_fund_balance",
  help: "Current violation fund balance",
  registers: [register],
});

export const disbursementsTotal = new Counter({
  name: "disbursements_total",
  help: "Total disbursements by status",
  labelNames: ["status"],
  registers: [register],
});

export const mfaEnrollmentsTotal = new Counter({
  name: "mfa_enrollments_total",
  help: "Total MFA enrollments",
  labelNames: ["result"],
  registers: [register],
});

export const accessDeniedTotal = new Counter({
  name: "access_denied_total",
  help: "Total access denied events",
  labelNames: ["route", "permission"],
  registers: [register],
});

export const emailQueueSize = new Gauge({
  name: "email_queue_size",
  help: "Number of pending emails in queue",
  registers: [register],
});

export const emailDeliveryTotal = new Counter({
  name: "email_delivery_total",
  help: "Total email delivery attempts",
  labelNames: ["status", "event_type"],
  registers: [register],
});

export const schedulerHeartbeatAge = new Gauge({
  name: "scheduler_heartbeat_age_seconds",
  help: "Age of scheduler heartbeat in seconds",
  registers: [register],
});

export const activeSessions = new Gauge({
  name: "active_sessions",
  help: "Number of active user sessions",
  registers: [register],
});

export const backgroundJobsTotal = new Counter({
  name: "background_jobs_total",
  help: "Total background jobs executed",
  labelNames: ["job", "status"],
  registers: [register],
});

export const backgroundJobDuration = new Histogram({
  name: "background_job_duration_seconds",
  help: "Duration of background jobs in seconds",
  labelNames: ["job"],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

// --- Helper functions ---
export function recordHttpRequest(
  method: string,
  handler: string,
  statusCode: number,
  durationSeconds: number,
  requestSize?: number,
  responseSize?: number
) {
  httpRequestsTotal.inc({ method, handler, status_code: statusCode.toString() });
  httpRequestDuration.observe({ method, handler }, durationSeconds);
  if (requestSize !== undefined) httpRequestSize.observe({ method, handler }, requestSize);
  if (responseSize !== undefined) httpResponseSize.observe({ method, handler }, responseSize);
}

export function recordDbQuery(
  operation: string,
  table: string,
  durationSeconds: number,
  success: boolean
) {
  dbQueryDuration.observe({ operation, table }, durationSeconds);
  dbQueriesTotal.inc({ operation, table, result: success ? "success" : "error" });
}

export function recordWeeklyReport(status: string, businessUnit: string, score?: number) {
  weeklyReportsTotal.inc({ status, business_unit: businessUnit });
  if (score !== undefined) weeklyReportScore.observe({ business_unit: businessUnit }, score);
}

export function recordViolation(type: string, status: string, businessUnit: string) {
  violationsTotal.inc({ type, status, business_unit: businessUnit });
}

export function setFundBalance(balance: number) {
  fundBalance.set(balance);
}

export function recordDisbursement(status: string) {
  disbursementsTotal.inc({ status });
}

export function recordMfaEnrollment(result: "success" | "failure") {
  mfaEnrollmentsTotal.inc({ result });
}

export function recordAccessDenied(route: string, permission: string) {
  accessDeniedTotal.inc({ route, permission });
}

export function setEmailQueueSize(size: number) {
  emailQueueSize.set(size);
}

export function recordEmailDelivery(status: "sent" | "failed" | "skipped", eventType: string) {
  emailDeliveryTotal.inc({ status, event_type: eventType });
}

export function setSchedulerHeartbeatAge(ageSeconds: number) {
  schedulerHeartbeatAge.set(ageSeconds);
}

export function setActiveSessions(count: number) {
  activeSessions.set(count);
}

export function recordBackgroundJob(job: string, status: "success" | "failure", durationSeconds: number) {
  backgroundJobsTotal.inc({ job, status });
  backgroundJobDuration.observe({ job }, durationSeconds);
}