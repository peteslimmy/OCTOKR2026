import "server-only";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { METRICS_VERSION, metricsFor } from "./metrics";
import { csvEscape, safeCell } from "./sanitize";
import type { ReportColumn, ReportResult } from "./types";

// Exports carry the same rows the user sees (the report was run under their own permissions) plus the metadata a formal record needs:
// report, period, scope, filters, generation time and definition versions. They are built in memory from a bounded row set (MAX_EXPORT_ROWS).

export interface ExportFile { body: Buffer; contentType: string; filename: string }

const fmtParams = (r: ReportResult) => Object.entries(r.params).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ") || "none";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const stamp = (r: ReportResult) => r.generatedAt.slice(0, 16).replace(/[-:T]/g, "");
export const exportFilename = (r: ReportResult, ext: string) => `${slug(r.title)}_${slug(r.periodLabel)}_${stamp(r)}.${ext}`;

function metadata(r: ReportResult, generatedFor: string): [string, string][] {
  return [
    ["Report", r.title], ["Period", r.periodLabel], ["Scope", r.scopeLabel], ["Filters", fmtParams(r)],
    ["Generated at (server time)", r.generatedAt], ["Generated for", generatedFor], ["Rows", String(r.rows.length)],
    ["Report definition version", r.definitionVersion], ["Metric definitions version", METRICS_VERSION],
    ["Data status", r.dataStatus === "COMPLETE" ? "Complete" : r.dataStatus === "PARTIAL" ? "Partial: see notes" : "No data for this selection"],
  ];
}

const cellValue = (c: ReportColumn, v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if ((c.type === "date" || c.type === "datetime") && typeof v === "string") return v;
  return v;
};

// ---------------------------------------------------------------- CSV
export function toCsv(r: ReportResult, generatedFor: string): ExportFile {
  const lines: string[] = [];
  for (const [k, v] of metadata(r, generatedFor)) lines.push(`# ${csvEscape(k)},${csvEscape(v)}`);
  for (const n of r.notes) lines.push(`# Note,${csvEscape(n)}`);
  lines.push("");
  lines.push(r.columns.map((c) => csvEscape(c.label)).join(","));
  for (const row of r.rows) lines.push(r.columns.map((c) => csvEscape(cellValue(c, row[c.key]))).join(","));
  return { body: Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8"), contentType: "text/csv; charset=utf-8", filename: exportFilename(r, "csv") };
}

// ---------------------------------------------------------------- XLSX
export async function toXlsx(r: ReportResult, generatedFor: string): Promise<ExportFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "4CORE-OKR Reports";
  wb.created = new Date(r.generatedAt);
  const ws = wb.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 0 }] });
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  for (const [k, v] of metadata(r, generatedFor)) { const row = ws.addRow([k, safeCell(v)]); row.getCell(1).font = { bold: true, color: { argb: "FF565D66" } }; }
  ws.addRow([]);
  const headerRowNo = ws.rowCount + 1;
  const header = ws.addRow(r.columns.map((c) => (c.hint ? `${c.label} (${c.hint})` : c.label)));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7F1519" } };
  header.alignment = { vertical: "middle", wrapText: true };
  for (const row of r.rows) {
    const xr = ws.addRow(r.columns.map((c) => {
      const v = safeCell(cellValue(c, row[c.key]));
      if ((c.type === "date" || c.type === "datetime") && typeof v === "string") { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d; }
      return v;
    }));
    r.columns.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      if (c.type === "money") cell.numFmt = "#,##0.00";
      else if (c.type === "percent") cell.numFmt = '0.0"%"';
      else if (c.type === "number") cell.numFmt = r.rows.some((rw) => typeof rw[c.key] === "number" && !Number.isInteger(rw[c.key])) ? "0.0" : "0";   // one decimal wherever a value has a fraction; the cell keeps its full precision
      else if (c.type === "date") cell.numFmt = "yyyy-mm-dd";
      else if (c.type === "datetime") cell.numFmt = "yyyy-mm-dd hh:mm";
    });
  }
  r.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(12, c.label.length + 4, c.type === "text" ? 28 : 14)); });
  ws.views = [{ state: "frozen", ySplit: headerRowNo }];
  if (r.rows.length) ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo + r.rows.length, column: r.columns.length } };

  const defs = wb.addWorksheet("Metric definitions");
  defs.addRow(["Metric", "Status", "Definition", "Formula", "Numerator", "Denominator", "Unit", "Source", "Missing-data rules", "Caveats", "Version"]).font = { bold: true };
  for (const m of metricsFor(r.metricIds)) defs.addRow([m.name, m.status, m.definition, m.formula, m.numerator ?? "", m.denominator ?? "", m.unit, m.source, m.nullRules, m.caveats.join(" "), m.version]);
  defs.columns.forEach((col) => { col.width = 32; col.alignment = { wrapText: true, vertical: "top" }; });

  const notes = wb.addWorksheet("Notes");
  notes.addRow(["Notes and limitations"]).font = { bold: true };
  for (const n of r.notes.length ? r.notes : ["None."]) notes.addRow([n]);
  notes.getColumn(1).width = 120;

  const body = Buffer.from(await wb.xlsx.writeBuffer());
  return { body, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: exportFilename(r, "xlsx") };
}

// ---------------------------------------------------------------- PDF
function display(c: ReportColumn, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (c.type === "percent") return `${Number(v).toFixed(1)}%`;
  if (c.type === "money") return Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (c.type === "number") return Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(1);
  if (c.type === "date" && typeof v === "string") return v.slice(0, 10);
  if (c.type === "datetime" && typeof v === "string") return v.slice(0, 16).replace("T", " ");
  return String(v);
}

export function toPdf(r: ReportResult, generatedFor: string): Promise<ExportFile> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: r.title, Author: "4CORE-OKR Reports", CreationDate: new Date(r.generatedAt) } });
    const chunks: Buffer[] = [];
    doc.on("data", (d: Buffer) => chunks.push(d));
    doc.on("error", reject);
    doc.on("end", () => resolve({ body: Buffer.concat(chunks), contentType: "application/pdf", filename: exportFilename(r, "pdf") }));

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#17191c").text(r.title, left, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor("#565d66");
    const meta = metadata(r, generatedFor);
    for (let i = 0; i < meta.length; i += 2) {
      const a = meta[i], b = meta[i + 1];
      doc.text(`${a[0]}: ${a[1]}${b ? `      ${b[0]}: ${b[1]}` : ""}`, left, doc.y, { width });
    }
    doc.moveDown(0.6);
    if (r.summary.length) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#17191c").text("Summary", left, doc.y);
      doc.font("Helvetica").fontSize(9);
      for (const s of r.summary) doc.text(`${s.label}: ${s.value ?? "n/a"}${s.unit ? ` ${s.unit}` : ""}${s.note ? `  (${s.note})` : ""}`, left, doc.y, { width });
      doc.moveDown(0.6);
    }

    const cols = r.columns.filter((c) => c.type !== "link");
    const weight = (c: ReportColumn) => (c.type === "text" ? (/reason|detail|note|item|latest|kr|sub/i.test(c.key) ? 3 : 2) : c.type === "datetime" ? 1.6 : 1);
    const total = cols.reduce((a, c) => a + weight(c), 0);
    const widths = cols.map((c) => (weight(c) / total) * width);
    const rowH = 15;
    const drawRow = (vals: string[], bold: boolean, fill?: string) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 18) doc.addPage();
      const y = doc.y;
      if (fill) doc.rect(left, y - 2, width, rowH).fill(fill);
      doc.fillColor(fill ? "#ffffff" : "#17191c").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
      let x = left;
      vals.forEach((v, i) => { doc.text(v, x + 2, y + 1, { width: widths[i] - 4, height: rowH - 2, lineBreak: false, ellipsis: true }); x += widths[i]; });
      doc.y = y + rowH;
    };
    drawRow(cols.map((c) => c.label), true, "#7f1519");
    for (const row of r.rows) drawRow(cols.map((c) => display(c, row[c.key])), false);
    if (!r.rows.length) { doc.fillColor("#565d66").font("Helvetica").fontSize(9).text("No data for this selection.", left, doc.y + 4); }

    if (r.notes.length) {
      doc.moveDown(1).font("Helvetica-Bold").fontSize(9).fillColor("#17191c").text("Notes and limitations", left, doc.y);
      doc.font("Helvetica").fontSize(8).fillColor("#565d66");
      for (const n of r.notes) doc.text(`• ${n}`, left, doc.y, { width });
    }
    const defs = metricsFor(r.metricIds);
    if (defs.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#17191c").text("Metric definitions", left, doc.y);
      doc.moveDown(0.4);
      for (const m of defs) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#17191c").text(`${m.name}  [${m.status.replace("_", " ").toLowerCase()}]`, left, doc.y, { width });
        doc.font("Helvetica").fontSize(8).fillColor("#333").text(`${m.definition}  Formula: ${m.formula}.  Source: ${m.source}.`, left, doc.y, { width });
        doc.fillColor("#565d66").text(`Missing data: ${m.nullRules}${m.caveats.length ? `  Caveats: ${m.caveats.join(" ")}` : ""}`, left, doc.y, { width });
        doc.moveDown(0.4);
      }
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7).fillColor("#565d66").text(`${r.title}  |  ${r.periodLabel}  |  generated ${r.generatedAt.slice(0, 16).replace("T", " ")} (server time)  |  page ${i + 1} of ${range.count}`,
        left, doc.page.height - 30, { width, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
