import { NextResponse } from "next/server";
import { jobsSecretMatches } from "@/lib/jobs-secret";
import { deliverPending, type OutboxRow } from "@/lib/email/deliver";
import { emailBrand, enrichOutbox } from "@/lib/email/enrich";
import { sendWebhook } from "@/lib/integrations/adapters";
import { decryptSecret } from "@/lib/integrations/crypto";
import { resolveEmail } from "@/lib/integrations/runtime";
import { deliverWebhooks, type WebhookRow } from "@/lib/integrations/webhook-delivery";
import { runDueEmailReports } from "@/lib/report-email/service";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Scheduler entry point (idempotent, retryable). Authorised by a shared secret, never by a user session.
 * It runs the database jobs (quarter roll, locks, finalisation, reminders), then hands the email outbox to the email in force (the enabled SMTP
 * integration, else the server's EMAIL_* settings) and the webhook outbox to its receivers (ADR-076).
 * A delivery problem is reported in the result and logged; it never fails the job or touches business data.
 */
export async function POST(req: Request) {
  if (!jobsSecretMatches(req.headers.get("x-jobs-secret"))) return NextResponse.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 });
  const sb = adminClient();
  const { data, error } = await sb.rpc("run_scheduled_jobs");
  if (error) {
    console.error("jobs failed", error.message);
    return NextResponse.json({ error: { code: "JOB_FAILED" } }, { status: 500 });
  }
  let email: unknown = { error: "not run" };
  try {
    const mail = await resolveEmail();
    email = await deliverPending({
      claim: async (limit) => {
        const r = await sb.rpc("claim_email_batch", { p_limit: limit });
        if (r.error) throw new Error(r.error.message);
        return enrichOutbox(sb, (r.data as OutboxRow[]) ?? []);
      },
      mark: async (id, ok, err) => { const r = await sb.rpc("mark_email_result", { p_id: id, p_ok: ok, p_error: err ?? null }); if (r.error) throw new Error(r.error.message); },
      skip: async (id, reason) => { const r = await sb.rpc("skip_email", { p_id: id, p_reason: reason }); if (r.error) throw new Error(r.error.message); },
      transport: mail.transport,
      appUrl: mail.appUrl,
      brand: await emailBrand(mail.appUrl),
    });
  } catch (e) {
    console.error("email delivery failed", e instanceof Error ? e.message : e);
    email = { error: "delivery failed" };
  }
  let webhooks: unknown = { error: "not run" };
  try {
    webhooks = await deliverWebhooks({
      claim: async (limit) => {
        const r = await sb.rpc("claim_webhook_batch", { p_limit: limit });
        if (r.error) throw new Error(r.error.message);
        return (r.data as WebhookRow[]) ?? [];
      },
      mark: async (id, ok, err) => { const r = await sb.rpc("mark_webhook_result", { p_id: id, p_ok: ok, p_error: err ?? null }); if (r.error) throw new Error(r.error.message); },
      decrypt: (token) => decryptSecret(token, "signingSecret"),
      send: (o) => sendWebhook(o),
    });
  } catch (e) {
    console.error("webhook delivery failed", e instanceof Error ? e.message : e);
    webhooks = { error: "delivery failed" };
  }
  let reportEmails: unknown = { error: "not run" };
  try {
    reportEmails = await runDueEmailReports();
  } catch (e) {
    console.error("report emails failed", e instanceof Error ? e.message : e);
    reportEmails = { error: "report emails failed" };
  }
  return NextResponse.json({ data: { ...(data as object), email, webhooks, reportEmails } });
}
