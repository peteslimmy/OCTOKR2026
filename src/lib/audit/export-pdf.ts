import "server-only";
import PDFDocument from "pdfkit";
import type { AuditRow } from "@/lib/data/audit";

const WAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const watText = (iso: string) => `${WAT.format(new Date(iso))} WAT`;

export interface AuditPdfInput { generatedAt: string; generatedFor: string; filterText: string; rows: AuditRow[]; truncated: boolean; chainNote: string }

/** The audit events as a PDF: one block per event, newest first, with the filter, who generated it and when, and page numbers. Times are West Africa Time. */
export function auditPdf(m: AuditPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true, info: { Title: "Audit & Security Centre export", Author: "4CORE-OKR", CreationDate: new Date(m.generatedAt) } });
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#17191c").text("Audit & Security Centre: event export", left, doc.y, { width });
    doc.font("Helvetica").fontSize(8.5).fillColor("#565d66")
      .text(`Generated ${watText(m.generatedAt)} for ${m.generatedFor}. ${m.rows.length} event${m.rows.length === 1 ? "" : "s"}${m.truncated ? " (stopped at the export limit; narrow the filter for the rest)" : ""}.`, left, doc.y, { width })
      .text(`Filter: ${m.filterText || "none"}`, left, doc.y, { width })
      .text(m.chainNote, left, doc.y, { width });
    doc.moveDown(0.6);

    for (const r of m.rows) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      const head = `${watText(r.occurred_at)}  |  ${r.action}  |  ${r.outcome}${r.severity ? `  |  ${r.severity}` : ""}`;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(r.outcome === "SUCCESS" ? "#17191c" : "#7f1519").text(head, left, doc.y, { width });
      const who = [r.actor_name, r.actor_email && `<${r.actor_email}>`, r.actor_role && `(${r.actor_role})`, r.actor_bu_name].filter(Boolean).join(" ") || "system";
      const where = [r.ip_address, r.browser, r.os, r.device, r.channel].filter(Boolean).join(" · ");
      const lines = [
        `By: ${who}`, `On: ${r.entity_type}${r.entity_id ? ` ${r.entity_id}` : ""}${r.event_category ? `  ·  ${r.event_category}` : ""}`,
        r.reason ? `Reason: ${r.reason}` : null, where ? `From: ${where}` : null,
        `Event ${r.id}${r.request_id ? `  ·  request ${r.request_id}` : ""}${r.workflow_id ? `  ·  workflow ${r.workflow_id}` : ""}`,
        r.old_values ? `Before: ${JSON.stringify(r.old_values).slice(0, 600)}` : null, r.new_values ? `After: ${JSON.stringify(r.new_values).slice(0, 600)}` : null,
      ].filter(Boolean) as string[];
      doc.font("Helvetica").fontSize(7.5).fillColor("#17191c");
      for (const l of lines) doc.text(l, left + 8, doc.y, { width: width - 8, lineGap: 0.5 });
      doc.moveDown(0.5);
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#565d66").text(`Confidential · page ${i + 1} of ${pages.count} · 4CORE-OKR`, left, doc.page.height - 32, { width, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
