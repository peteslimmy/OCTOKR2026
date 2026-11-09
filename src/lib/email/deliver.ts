/**
 * Hands the email outbox to a transport (ADR-061). Pure of any framework: the database calls and the transport are passed in, so the
 * retry, give-up and "no provider" behaviour can be tested without a mail server.
 */
export interface Mail { to: string; subject: string; text: string; /** Optional HTML version; the plain text is always sent beside it. */ html?: string }
export interface Transport { name: string; send(mail: Mail): Promise<void> }
export interface OutboxRow { id: string; to_email: string; subject: string; body: string; attempts: number }
export interface DeliveryDeps {
  claim(limit: number): Promise<OutboxRow[]>;
  mark(id: string, ok: boolean, error?: string): Promise<void>;
  skip(id: string, reason: string): Promise<void>;
  transport: Transport | null;
  appUrl?: string;
}
export interface DeliveryResult { claimed: number; sent: number; failed: number; skipped: number; transport: string }

const RECIPIENT = /^[^\s<>()",;\\]+@[^\s<>()",;\\]+$/;

/** True when this is one plain address: no display name, no list, no line break. */
export const isPlainRecipient = (address: string) => RECIPIENT.test(address) && address.length <= 254;

/** What the person reads: the same words as the in-app notification, and where to act on it. Plain text only: nothing is rendered as markup. */
export function composeMail(row: OutboxRow, appUrl?: string): Mail {
  // defence in depth: addresses come from the database, but nothing with a space, a line break or a list separator may ever reach an SMTP command
  if (!isPlainRecipient(row.to_email)) throw new Error("the recipient address is not a single plain address");
  const link = appUrl ? `\n\nOpen the application: ${appUrl.replace(/\/+$/, "")}/notifications` : "";
  return {
    to: row.to_email,
    subject: row.subject.replace(/[\r\n]+/g, " ").slice(0, 200),                // a header must never contain a line break
    text: `${row.body}${link}\n\nRegards,\n4Core BizOps\n\n—\n4Core Weekly OKR. This message was sent because of an event on your account. You can turn non-security emails off under Notifications.`,
  };
}

export async function deliverPending(deps: DeliveryDeps, limit = 25): Promise<DeliveryResult> {
  const rows = await deps.claim(limit);
  const out: DeliveryResult = { claimed: rows.length, sent: 0, failed: 0, skipped: 0, transport: deps.transport?.name ?? "none" };
  for (const row of rows) {
    if (!deps.transport) { await deps.skip(row.id, "no email provider is configured"); out.skipped++; continue; }
    try {
      await deps.transport.send(composeMail(row, deps.appUrl));
      await deps.mark(row.id, true);
      out.sent++;
    } catch (e) {
      await deps.mark(row.id, false, e instanceof Error ? e.message : "send failed");
      out.failed++;
    }
  }
  return out;
}
