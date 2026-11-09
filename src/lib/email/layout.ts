/**
 * The one look of every email the application sends (ADR-117): a greeting, a short scripted message, an optional box with the specifics, an optional
 * "if this was you / not you" block, one button, a signature and a footer that says why the person got it. Table-based inline-style HTML (no images, scripts or
 * style sheets) with a plain-text twin. Everything a person or the database supplied is escaped; only http(s) addresses become links.
 */
export type FooterKind = "security" | "operational" | "reminder" | "account";

export interface EmailContent {
  subject: string;
  /** The grey line mail apps show after the subject. */
  preheader?: string;
  greeting: string;
  paragraphs: string[];
  /** The specifics (unit, week, amount, reason), shown in a box so they are easy to find. */
  details?: string;
  /** "If this was you: ..." style blocks. */
  notes?: { heading: string; text: string }[];
  cta?: { label: string; url: string };
  /** Put the button right after the message, with the notes below it (an invitation); by default the notes come first (a security notice). */
  ctaFirst?: boolean;
  closing?: string;
  footer: FooterKind;
}

/** The organisation's logo as an absolute address (an email client cannot load a relative one) and the height to draw it at. */
export interface EmailBrand { logoUrl?: string | null; logoHeight?: number | null }

export const BRAND = "#7f1519";
const INK = "#17191c", MUTED = "#565d66", LINE = "#e1e4e8", SURFACE = "#f6f7f9";
const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const para = (s: string) => esc(s).replace(/\n/g, "<br>");
export const safeLink = (u: string | undefined): string | null => (u && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);

const base = (appUrl?: string) => (appUrl ? appUrl.replace(/\/+$/, "") : "");

/** The two sentences of the footer, per kind. */
export function footerText(kind: FooterKind): string {
  switch (kind) {
    case "security": return "This is an automated security notice. Non-security email preferences can be managed under Notification Settings.";
    case "reminder": return "This is an automated reminder. You can manage your email preferences under Notification Settings.";
    case "account": return "You received this email because an administrator created an account for you. If you were not expecting it, you can ignore it or contact your administrator.";
    default: return "You received this operational update based on your role on the team. You can manage your email preferences under Notification Settings.";
  }
}

/** The top of every email: the logo on white with a brand-coloured rule, or the product name on a brand-coloured band when there is no logo. */
export function headerRow(brand?: EmailBrand): string {
  const logo = safeLink(brand?.logoUrl ?? undefined);
  if (!logo) return `<tr><td style="background:${BRAND};padding:18px 32px;border-radius:12px 12px 0 0;${FONT}color:#ffffff"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">4Core Weekly OKR</div></td></tr>`;
  const h = Math.min(56, Math.max(24, Math.round(brand?.logoHeight ?? 36)));
  return `<tr><td style="padding:22px 32px 16px;border-top:5px solid ${BRAND};border-radius:12px 12px 0 0;background:#ffffff"><img src="${esc(logo)}" alt="4Core Weekly OKR" height="${h}" style="display:block;height:${h}px;width:auto;border:0;outline:none;${FONT}font-size:16px;font-weight:700;color:${BRAND}"></td></tr><tr><td style="border-bottom:1px solid ${LINE};font-size:0;line-height:0">&nbsp;</td></tr>`;
}

export function renderEmail(c: EmailContent, appUrl?: string, brand?: EmailBrand): { html: string; text: string } {
  const root = base(appUrl);
  const cta = c.cta && safeLink(c.cta.url) ? c.cta : null;
  const settingsUrl = root ? `${root}/notifications` : null;
  const rows: string[] = [];
  rows.push(`<tr><td style="padding:28px 32px 8px;${FONT}font-size:16px;line-height:24px;color:${INK}">${para(c.greeting)}</td></tr>`);
  for (const p of c.paragraphs) rows.push(`<tr><td style="padding:6px 32px;${FONT}font-size:15px;line-height:24px;color:${INK}">${para(p)}</td></tr>`);
  if (c.details) rows.push(`<tr><td style="padding:10px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};border-left:4px solid ${BRAND};border-radius:6px"><tr><td style="padding:12px 16px;${FONT}font-size:14px;line-height:21px;color:${INK}">${para(c.details)}</td></tr></table></td></tr>`);
  const noteRows = (c.notes ?? []).map((n) => `<tr><td style="padding:8px 32px;${FONT}font-size:15px;line-height:24px;color:${INK}"><strong>${esc(n.heading)}</strong><br>${para(n.text)}</td></tr>`);
  if (!c.ctaFirst) rows.push(...noteRows);
  if (cta) {
    rows.push(`<tr><td style="padding:18px 32px 6px"><a href="${esc(cta.url)}" style="${FONT}display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">${esc(cta.label)}</a></td></tr>`);
    rows.push(`<tr><td style="padding:2px 32px 6px;${FONT}font-size:12px;line-height:18px;color:${MUTED}">If the button does not work, copy this address into your browser:<br><a href="${esc(cta.url)}" style="color:${MUTED};word-break:break-all">${esc(cta.url)}</a></td></tr>`);
  }
  if (c.ctaFirst) rows.push(...noteRows);
  if (c.closing) rows.push(`<tr><td style="padding:10px 32px 0;${FONT}font-size:15px;line-height:24px;color:${INK}">${para(c.closing)}</td></tr>`);
  rows.push(`<tr><td style="padding:16px 32px 28px;${FONT}font-size:15px;line-height:24px;color:${INK}">Regards,<br>4Core BizOps Team</td></tr>`);
  const footer = `4Core Weekly OKR • ${footerText(c.footer)}`;
  const footerHtml = settingsUrl ? esc(footer).replace("Notification Settings", `<a href="${esc(settingsUrl)}" style="color:${MUTED}">Notification Settings</a>`) : esc(footer);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#eef0f3">`
    + (c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader)}</div>` : "")
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f3"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:12px">`
    + headerRow(brand)
    + rows.join("")
    + `<tr><td style="border-top:1px solid ${LINE};padding:16px 32px;${FONT}font-size:12px;line-height:18px;color:${MUTED}">${footerHtml}</td></tr>`
    + `</table></td></tr></table></body></html>`;

  const text = [
    c.greeting, "",
    ...c.paragraphs.flatMap((p) => [p, ""]),
    ...(c.details ? [c.details.split("\n").map((l) => `  ${l}`).join("\n"), ""] : []),
    ...(c.ctaFirst ? [] : (c.notes ?? []).flatMap((n) => [`${n.heading}`, n.text, ""])),
    ...(cta ? [`${cta.label}: ${cta.url}`, ""] : []),
    ...(c.ctaFirst ? (c.notes ?? []).flatMap((n) => [`${n.heading}`, n.text, ""]) : []),
    ...(c.closing ? [c.closing, ""] : []),
    "Regards,", "4Core BizOps Team", "",
    "—", footer + (settingsUrl ? ` (${settingsUrl})` : ""),
  ].join("\n");
  return { html, text };
}
