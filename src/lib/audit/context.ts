import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { clientIp } from "@/lib/api/client-ip";
import { userClient } from "@/lib/supabase/server";

/**
 * What the database needs to know about the request an audit event belongs to (ADR-108).
 *
 * Every write goes through the service-role client, so the headers Postgres sees are the app server's, not the person's. These
 * `x-audit-*` headers carry the facts the app server verified: the client address (counted from the right by TRUSTED_PROXY_HOPS,
 * never the first, client-chosen entry), the user agent, a one-way reference to the sign-in session, and a request id of its own.
 * They are only honoured on calls made with the service key, so a browser cannot forge them.
 */
export interface AuditContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  channel: "WEB" | "API";
  sessionRef: string | null;
}

/** The session id inside the access token, reduced to a short one-way reference. The token itself is never stored or sent. */
export async function sessionReference(): Promise<string | null> {
  try {
    const { data } = await (await userClient()).auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const sid = (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { session_id?: unknown }).session_id;
    return typeof sid === "string" ? createHash("sha256").update(sid).digest("hex").slice(0, 16) : null;
  } catch { return null; }
}

export async function buildAuditContext(req: Request, withSession = true): Promise<AuditContext> {
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");
  const bearer = (req.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ");
  return {
    ip: ip === "direct" || ip === "invalid" ? null : ip,
    userAgent: ua ? ua.slice(0, 400) : null,
    requestId: randomUUID(),
    channel: bearer ? "API" : "WEB",
    sessionRef: withSession ? await sessionReference() : null,
  };
}

/** Headers for the service-role client. Control characters are removed so a crafted user agent cannot break the header. */
export function auditHeaders(ctx: AuditContext | undefined): Record<string, string> {
  if (!ctx) return {};
  const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");
  const h: Record<string, string> = { "x-request-id": ctx.requestId, "x-audit-channel": ctx.channel };
  if (ctx.ip) h["x-audit-ip"] = clean(ctx.ip);
  if (ctx.userAgent) h["x-audit-ua"] = clean(ctx.userAgent);
  if (ctx.sessionRef) h["x-audit-session"] = ctx.sessionRef;
  return h;
}
