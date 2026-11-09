import { isPlainRecipient, type Mail } from "./deliver";
import { renderEmail, safeLink, type EmailBrand } from "./layout";

/** How long a set-up link works. It is the auth service's one-time link lifetime (supabase/config.toml `otp_expiry`), so the email and the setting must agree. */
export const INVITATION_VALID_HOURS = 24;

export interface InvitationInput { brand?: EmailBrand; to: string; firstName?: string | null; setupUrl: string; appUrl: string; invitedBy?: string | null }

/** The email a new person gets when an administrator gives them an account: who invited them, one button to choose a password, how long it works, and what to do if it was a mistake. */
export function composeInvitation(i: InvitationInput): Mail {
  if (!isPlainRecipient(i.to)) throw new Error("the recipient address is not a single plain address");
  if (!safeLink(i.setupUrl)) throw new Error("the set-up link is not an http(s) address");
  const who = i.invitedBy?.trim();
  const { html, text } = renderEmail({
    subject: "You've been invited to 4Core Weekly OKR",
    preheader: "Choose a password to start using your account.",
    greeting: i.firstName?.trim() ? `Dear ${i.firstName.trim()},` : "Hello,",
    paragraphs: [
      `${who ? `${who} has` : "An administrator has"} created an account for you on 4Core Weekly OKR, where your team plans, reports and reviews its weekly OKRs.`,
      `To get started, choose a password for your account. This single-use link is valid for ${INVITATION_VALID_HOURS} hours.`,
    ],
    cta: { label: "Set up your account", url: i.setupUrl }, ctaFirst: true,
    notes: [
      { heading: "Link expired?", text: `Open ${i.appUrl.replace(/\/+$/, "")}/forgot-password and ask for a new link with this email address, or ask your administrator to resend the invitation.` },
      { heading: "If you were not expecting this:", text: "You can ignore this email and nothing will happen, or let your administrator know." },
    ],
    footer: "account",
  }, i.appUrl, i.brand);
  return { to: i.to, subject: "You've been invited to 4Core Weekly OKR", text, html };
}
