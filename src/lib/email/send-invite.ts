import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { resolveEmail } from "@/lib/integrations/runtime";
import { composeInvitation } from "./invite";
import { emailBrand } from "./enrich";

export type InvitationOutcome = "SENT" | "NO_PROVIDER" | "FAILED";
export interface InvitationResult { outcome: InvitationOutcome; setupLink: string | null; message: string | null }

/**
 * Gives a person their invitation: a fresh one-time set-up link, emailed to them. The link is never stored; the administrator's screen also gets it as a fallback
 * (so a missing or failing email provider never leaves the person without a way in) and every attempt is recorded in the audit log with its outcome.
 * It never throws: the account already exists, and a mail problem must not undo it.
 */
export async function sendInvitation(o: { actorId: string; userId: string; email: string; firstName?: string | null; invitedBy?: string | null; fallbackAppUrl: string; correlationId?: string }): Promise<InvitationResult> {
  const admin = adminClient(o.correlationId);
  let setupLink: string | null = null;
  let outcome: InvitationOutcome = "FAILED";
  let message: string | null = null;
  try {
    const mail = await resolveEmail().catch(() => ({ transport: null as null, appUrl: undefined as string | undefined }));
    const appUrl = (mail.appUrl || o.fallbackAppUrl).replace(/\/+$/, "");
    const link = await admin.auth.admin.generateLink({ type: "recovery", email: o.email });
    const hashed = link.data?.properties?.hashed_token;
    if (link.error || !hashed) throw new Error("a set-up link could not be made");
    setupLink = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery`;
    if (!mail.transport) { outcome = "NO_PROVIDER"; message = "No email provider is configured, so the invitation was not emailed. Pass the set-up link on yourself."; }
    else {
      await mail.transport.send(composeInvitation({ to: o.email, firstName: o.firstName, setupUrl: setupLink, appUrl, invitedBy: o.invitedBy, brand: await emailBrand(appUrl) }));
      outcome = "SENT";
    }
  } catch (e) {
    outcome = "FAILED";
    message = "The invitation email could not be sent. Pass the set-up link on yourself, or resend the invitation.";
    console.error("invitation email failed", e instanceof Error ? e.message : e);
  }
  try { await admin.rpc("record_user_invitation", { p_actor: o.actorId, p_user: o.userId, p_outcome: outcome }); } catch (e) { console.error("invitation audit failed", e instanceof Error ? e.message : e); }
  return { outcome, setupLink, message };
}
