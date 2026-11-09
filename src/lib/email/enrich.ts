import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboxRow } from "./deliver";
import type { EmailBrand } from "./layout";
import { getBranding } from "@/lib/data/branding";

/**
 * A claimed outbox row carries only the recipient, subject and body. The email is written for the event and addressed by first name, so the event type and the person's
 * first name are read here (by the outbox row's id) and added. A failure to read them never stops the email: it is then sent with the notification's own words.
 */
export async function enrichOutbox(sb: SupabaseClient, rows: OutboxRow[]): Promise<OutboxRow[]> {
  if (!rows.length) return rows;
  try {
    const { data } = await sb.from("email_outbox").select("id, notifications(event_type), users(employees(first_name))").in("id", rows.map((r) => r.id));
    const byId = new Map<string, { event_type?: string | null; first_name?: string | null }>();
    for (const d of (data ?? []) as unknown as { id: string; notifications: { event_type: string } | { event_type: string }[] | null; users: { employees: { first_name: string } | { first_name: string }[] | null } | { employees: { first_name: string } | { first_name: string }[] | null }[] | null }[]) {
      const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
      byId.set(d.id, { event_type: one(d.notifications)?.event_type ?? null, first_name: one(one(d.users)?.employees ?? null)?.first_name ?? null });
    }
    return rows.map((r) => ({ ...r, ...(byId.get(r.id) ?? {}) }));
  } catch (e) {
    console.error("email enrichment failed", e instanceof Error ? e.message : e);
    return rows;
  }
}

/** The logo for an email: the organisation's uploaded logo (Administration > Branding), as an absolute address. None when there is no logo or no application address to build it from. */
export async function emailBrand(appUrl?: string): Promise<EmailBrand> {
  if (!appUrl) return {};
  try {
    const b = await getBranding();
    return b.logoUrl ? { logoUrl: `${appUrl.replace(/\/+$/, "")}${b.logoUrl}`, logoHeight: b.logoHeight } : {};
  } catch { return {}; }
}
