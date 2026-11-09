import type { Summary } from "./summary";

/**
 * Builds the email from a summary (ADR-115): HTML made of tables with inline styles (renders in Gmail, Outlook and phones; the bars are
 * table cells, not images, so nothing is blocked), plus a plain-text version that carries the same information. Everything that came
 * from data is escaped; nothing is rendered as markup.
 */
export type Section = "HEADLINES" | "RANKING" | "TREND" | "HIGHLIGHTS" | "ATTENTION" | "INSIGHTS";
export const SECTIONS: { key: Section; label: string }[] = [
  { key: "HEADLINES", label: "Headline numbers" }, { key: "RANKING", label: "Business Unit ranking" }, { key: "TREND", label: "Trend" },
  { key: "HIGHLIGHTS", label: "Highlights" }, { key: "ATTENTION", label: "Attention needed" }, { key: "INSIGHTS", label: "Insights" },
];
export const ALL_SECTIONS = SECTIONS.map((s) => s.key);

export interface RenderOptions { sections: Section[]; scheduleName: string; appUrl?: string; testNotice?: boolean }
export interface Rendered { subject: string; html: string; text: string }

const KIND: Record<Summary["frequency"], string> = { WEEKLY: "Weekly", MONTHLY: "Monthly", QUARTERLY: "Quarterly", ANNUAL: "Annual" };
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const e = escapeHtml;
const fmt = (n: number | null, dp = 1) => (n === null ? "—" : n.toFixed(dp).replace(/\.0$/, ""));
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`);
const arrow = (m: string) => (m === "UP" ? "▲" : m === "DOWN" ? "▼" : m === "FLAT" ? "■" : m === "NEW" ? "new" : "");
const moveColour = (m: string) => (m === "UP" ? "#15803d" : m === "DOWN" ? "#b91c1c" : "#64748b");

const BRAND = "#1e40af";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const FONT = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;";

export const subjectFor = (s: Summary) => `4CORE OKR — ${KIND[s.frequency]} summary · ${s.periodLabel}`.replace(/[\r\n]+/g, " ");

/** A horizontal bar made of two table cells; width is the value as a share of 100. */
const bar = (value: number | null, colour = BRAND) => {
  const w = value === null ? 0 : Math.max(0, Math.min(100, Math.round(value)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>`
    + (w > 0 ? `<td width="${w}%" height="10" style="background:${colour};height:10px;line-height:10px;font-size:1px">&nbsp;</td>` : "")
    + `<td width="${100 - w}%" height="10" style="background:#e2e8f0;height:10px;line-height:10px;font-size:1px">&nbsp;</td></tr></table>`;
};
const heading = (t: string) => `<tr><td style="padding:24px 28px 8px;${FONT}font-size:16px;font-weight:700;color:${INK}">${e(t)}</td></tr>`;
const tile = (label: string, value: string, sub: string, colour = INK) =>
  `<td width="25%" valign="top" style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:8px"><tr><td style="padding:12px;${FONT}">`
  + `<div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em">${e(label)}</div><div style="font-size:24px;font-weight:700;color:${colour};padding-top:4px">${e(value)}</div><div style="font-size:12px;color:${MUTED};padding-top:2px">${e(sub)}</div></td></tr></table></td>`;

export function renderEmail(s: Summary, o: RenderOptions): Rendered {
  const has = (k: Section) => o.sections.includes(k);
  const h = s.headlines;
  const link = o.appUrl ? `${o.appUrl.replace(/\/+$/, "")}/reports` : null;
  const parts: string[] = [];
  const text: string[] = [`4CORE OKR — ${KIND[s.frequency]} summary`, s.periodLabel, ""];
  if (o.testNotice) { text.push("TEST EMAIL: sent to you only, to show how the summary looks.", ""); }

  if (s.empty) {
    parts.push(`<tr><td style="padding:24px 28px;${FONT}font-size:15px;color:${INK}">No reports were filed or scored for ${e(s.periodLabel)}, so there is nothing to summarise.</td></tr>`);
    text.push(`No reports were filed or scored for ${s.periodLabel}, so there is nothing to summarise.`);
  } else {
    if (has("HEADLINES")) {
      const dc = h.delta === null ? INK : h.delta >= 0 ? "#15803d" : "#b91c1c";
      parts.push(heading("Headline numbers"),
        `<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
        + tile("Average score", fmt(h.score), `${h.scoredUnits} of ${h.units} units scored`)
        + tile("Change", signed(h.delta), `vs ${s.previousLabel}`, dc)
        + tile("On time", h.onTimePct === null ? "—" : `${fmt(h.onTimePct)}%`, `${h.onTime} of ${h.expected} reports`)
        + tile("Missed", String(h.missed), h.holidays ? `${h.holidays} holiday ${h.holidays === 1 ? "week" : "weeks"} excluded` : "late or not filed")
        + `</tr></table></td></tr>`);
      text.push("HEADLINE NUMBERS", `Average score: ${fmt(h.score)} (${signed(h.delta)} vs ${s.previousLabel}); ${h.scoredUnits} of ${h.units} units scored`,
        `Reports on time: ${h.onTime} of ${h.expected}${h.onTimePct === null ? "" : ` (${fmt(h.onTimePct)}%)`}; missed: ${h.missed}`, "");
    }
    if (has("RANKING") && s.ranking.length) {
      parts.push(heading("Business Unit ranking"), `<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;${FONT}font-size:14px">`
        + `<tr style="color:${MUTED};font-size:11px;text-transform:uppercase"><td style="padding:6px 0">#</td><td>Unit</td><td width="34%">Score</td><td align="right">Change</td></tr>`
        + s.ranking.map((u) => `<tr style="border-top:1px solid ${LINE}"><td style="padding:8px 0;color:${MUTED}">${u.rank ?? "–"}</td><td style="color:${INK}">${e(u.name)}</td>`
          + `<td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="60%">${bar(u.score)}</td><td style="padding-left:8px;font-weight:600;color:${INK}">${fmt(u.score)}</td></tr></table></td>`
          + `<td align="right" style="color:${moveColour(u.movement)};white-space:nowrap">${arrow(u.movement)} ${u.delta === null ? "" : signed(u.delta)}</td></tr>`).join("")
        + `</table></td></tr>`);
      text.push("BUSINESS UNIT RANKING", ...s.ranking.map((u) => `${u.rank ?? "-"}. ${u.name} — ${fmt(u.score)}${u.delta === null ? "" : ` (${signed(u.delta)})`}`), "");
    }
    if (has("TREND") && s.trend.some((t) => t.value !== null)) {
      parts.push(heading("Trend (average score)"), `<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${FONT}font-size:13px">`
        + s.trend.map((t) => `<tr><td width="22%" style="padding:3px 0;color:${MUTED}">${e(t.label)}</td><td>${bar(t.value, "#3b82f6")}</td><td width="12%" align="right" style="color:${INK};font-weight:600">${fmt(t.value)}</td></tr>`).join("")
        + `</table></td></tr>`);
      text.push("TREND (average score)", ...s.trend.map((t) => `${t.label}: ${fmt(t.value)}`), "");
    }
    if (has("HIGHLIGHTS") && (s.highlights.top.length || s.highlights.improved.length)) {
      const li = (xs: string[]) => xs.map((x) => `<li style="padding:2px 0">${e(x)}</li>`).join("");
      const top = s.highlights.top.map((t) => `${t.name} — ${fmt(t.score)}`);
      const imp = s.highlights.improved.map((t) => `${t.name} — ${signed(t.delta)} points`);
      parts.push(heading("Highlights"), `<tr><td style="padding:0 28px;${FONT}font-size:14px;color:${INK}">`
        + (top.length ? `<div style="color:${MUTED};font-size:12px">Top scores</div><ul style="margin:4px 0 12px;padding-left:20px">${li(top)}</ul>` : "")
        + (imp.length ? `<div style="color:${MUTED};font-size:12px">Biggest improvements</div><ul style="margin:4px 0 0;padding-left:20px">${li(imp)}</ul>` : "") + `</td></tr>`);
      text.push("HIGHLIGHTS", ...(top.length ? ["Top scores:", ...top.map((x) => `  ${x}`)] : []), ...(imp.length ? ["Biggest improvements:", ...imp.map((x) => `  ${x}`)] : []), "");
    }
    if (has("ATTENTION")) {
      parts.push(heading("Attention needed"), s.attention.length
        ? `<tr><td style="padding:0 28px;${FONT}font-size:14px;color:${INK}"><ul style="margin:0;padding-left:20px">${s.attention.map((a) => `<li style="padding:2px 0"><strong>${e(a.name)}</strong> — ${e(a.issue)}</li>`).join("")}</ul></td></tr>`
        : `<tr><td style="padding:0 28px;${FONT}font-size:14px;color:${MUTED}">Nothing needs attention for this period.</td></tr>`);
      text.push("ATTENTION NEEDED", ...(s.attention.length ? s.attention.map((a) => `- ${a.name}: ${a.issue}`) : ["Nothing needs attention for this period."]), "");
    }
    if (has("INSIGHTS") && s.insights.length) {
      parts.push(heading("Insights"), `<tr><td style="padding:0 28px;${FONT}font-size:14px;color:${INK}"><ul style="margin:0;padding-left:20px">${s.insights.map((x) => `<li style="padding:3px 0">${e(x)}</li>`).join("")}</ul>`
        + `<div style="color:${MUTED};font-size:11px;padding-top:6px">Generated by a rules engine from the reported scores. No AI was used.</div></td></tr>`);
      text.push("INSIGHTS", ...s.insights.map((x) => `- ${x}`), "");
    }
  }
  if (link) { parts.push(`<tr><td style="padding:24px 28px"><a href="${e(link)}" style="${FONT}display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">Open the full report</a></td></tr>`); text.push(`Open the full report: ${link}`, ""); }
  text.push("—", `You receive this because you are a recipient of "${o.scheduleName}". Figures are at Business Unit level and come from the scores already published in 4CORE OKR.`);

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subjectFor(s))}</title></head>`
    + `<body style="margin:0;padding:0;background:#f1f5f9"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:20px 8px">`
    + `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid ${LINE};border-radius:12px">`
    + `<tr><td style="background:${BRAND};padding:22px 28px;border-radius:12px 12px 0 0;${FONT}color:#ffffff"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85">4CORE OKR · ${e(KIND[s.frequency])} summary</div><div style="font-size:22px;font-weight:700;padding-top:4px">${e(s.periodLabel)}</div></td></tr>`
    + (o.testNotice ? `<tr><td style="background:#fef3c7;padding:8px 28px;${FONT}font-size:13px;color:#92400e">Test email: sent to you only, to show how this summary looks.</td></tr>` : "")
    + parts.join("")
    + `<tr><td style="padding:20px 28px;border-top:1px solid ${LINE};${FONT}font-size:12px;color:${MUTED}">You receive this because you are a recipient of “${e(o.scheduleName)}”. Figures are at Business Unit level and come from the scores already published in 4CORE OKR.</td></tr>`
    + `</table></td></tr></table></body></html>`;
  return { subject: subjectFor(s), html, text: text.join("\n") };
}
