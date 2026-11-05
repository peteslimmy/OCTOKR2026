import "server-only";
import PDFDocument from "pdfkit";
import { markdownToText } from "./markdown";

export interface MinutesPdfInput {
  reference: string; revision: number | null; status: string; generatedAt: string; generatedFor: string; contentHash: string | null; finalisedBy: string | null; finalisedAt: string | null;
  content: string; audience: string; aiDrafted: boolean;
}

/** The minutes as a PDF: the text exactly as saved (no HTML), with the session reference, revision, status and the generation date and person on the first page and the page number on every page. */
export function minutesPdf(m: MinutesPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54, bufferPages: true, info: { Title: `Minutes ${m.reference}`, Author: "4CORE-OKR Session Notes", CreationDate: new Date(m.generatedAt) } });
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#7f1519").text(m.status === "FINALISED" ? "FINAL MINUTES" : `DRAFT MINUTES (${m.status.toLowerCase()}) - not final`, left, doc.y);
    doc.font("Helvetica").fontSize(8.5).fillColor("#565d66")
      .text(`${m.reference}${m.revision ? ` · revision ${m.revision}` : ""} · audience: ${m.audience === "MANAGEMENT" ? "management" : "participants"}${m.aiDrafted ? " · first draft proposed by AI, reviewed by a person" : ""}`, left, doc.y, { width })
      .text(`Generated ${m.generatedAt.slice(0, 16).replace("T", " ")} (server time) for ${m.generatedFor}`, left, doc.y, { width });
    if (m.status === "FINALISED") doc.text(`Finalised by ${m.finalisedBy ?? "-"} on ${m.finalisedAt?.slice(0, 16).replace("T", " ") ?? "-"} · integrity hash ${m.contentHash?.slice(0, 16)}...`, left, doc.y, { width });
    doc.moveDown(0.8);

    for (const raw of m.content.replace(/\r\n?/g, "\n").split("\n")) {
      const h = /^(#{1,3}) (.+)$/.exec(raw);
      if (h) {
        doc.moveDown(h[1].length === 1 ? 0.4 : 0.6).font("Helvetica-Bold").fontSize(h[1].length === 1 ? 16 : h[1].length === 2 ? 12 : 10.5).fillColor("#17191c").text(markdownToText(h[2]), left, doc.y, { width });
        doc.moveDown(0.2);
        continue;
      }
      if (raw.trim() === "") { doc.moveDown(0.4); continue; }
      doc.font("Helvetica").fontSize(9.5).fillColor("#17191c").text(markdownToText(raw), left, doc.y, { width, lineGap: 1.5 });
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#565d66").text(`${m.reference} · page ${i + 1} of ${pages.count} · 4CORE-OKR`, left, doc.page.height - 40, { width, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
