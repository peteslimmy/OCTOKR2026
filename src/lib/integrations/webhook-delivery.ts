/**
 * Hands the webhook outbox to the receivers (ADR-076). Like the email delivery it is pure of any framework: the database calls and the sender are passed in,
 * so retry, give-up and "secret cannot be decrypted" behaviour are tested without a network.
 * Back-off, the give-up after five attempts and the 24-hour expiry are in the database functions claim_webhook_batch and mark_webhook_result.
 */
export interface WebhookRow {
  id: string; integration_id: string; event_type: string; payload: Record<string, unknown> & { event: string }; attempts: number;
  url: string; format: "JSON" | "TEXT"; name: string; signing_secret: string | null;
}
export interface WebhookDeps {
  claim(limit: number): Promise<WebhookRow[]>;
  mark(id: string, ok: boolean, error?: string): Promise<void>;
  decrypt(token: string): string;
  send(opts: { url: string; format: "JSON" | "TEXT"; signingSecret?: string; event: WebhookRow["payload"]; deliveryId: string }): Promise<{ ok: boolean; message: string }>;
}
export interface WebhookResult { claimed: number; sent: number; failed: number }

export async function deliverWebhooks(deps: WebhookDeps, limit = 25): Promise<WebhookResult> {
  const rows = await deps.claim(limit);
  const out: WebhookResult = { claimed: rows.length, sent: 0, failed: 0 };
  for (const row of rows) {
    let secret: string | undefined;
    if (row.signing_secret) {
      try { secret = deps.decrypt(row.signing_secret); }
      catch (e) { await deps.mark(row.id, false, e instanceof Error ? e.message : "the signing secret cannot be decrypted"); out.failed++; continue; }
    }
    const r = await deps.send({ url: row.url, format: row.format, signingSecret: secret, event: row.payload, deliveryId: row.id });
    await deps.mark(row.id, r.ok, r.ok ? undefined : r.message);
    if (r.ok) out.sent++; else out.failed++;
  }
  return out;
}
