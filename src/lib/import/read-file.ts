import "server-only";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { IMPORT_LIMITS, parseCsv, sniffFile } from "./employees";

export interface ParsedFile { fileName: string; sha256: string; kind: "csv" | "xlsx"; headers: string[]; rows: string[][]; truncated: boolean }
export class ImportFileError extends Error {}

/**
 * Reads an uploaded file as untrusted DATA. Nothing is executed or evaluated: workbook formulas are not calculated, they are turned
 * into text that starts with "=" so validation rejects them. The first worksheet only; limits on size, rows and columns apply.
 */
export interface ReadLimits { maxBytes: number; maxRows: number; maxColumns: number }
export async function readImportFile(fileName: string, bytes: Uint8Array, limits: ReadLimits = IMPORT_LIMITS): Promise<ParsedFile> {
  const sniff = sniffFile(fileName, bytes, limits.maxBytes);
  if ("error" in sniff) throw new ImportFileError(sniff.error);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let table: string[][];

  if (sniff.kind === "csv") {
    table = parseCsv(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  } else {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(bytes) as never);
    } catch {
      throw new ImportFileError("The workbook could not be read. Save it again as .xlsx or export it as .csv.");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new ImportFileError("The workbook has no worksheet.");
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (table.length > limits.maxRows + 1) return;
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(ws.columnCount, limits.maxColumns); c++) {
        const v = row.getCell(c).value as unknown;
        if (v === null || v === undefined) cells.push("");
        else if (typeof v === "object" && v !== null && "formula" in v) cells.push(`=${String((v as { formula: string }).formula)}`);
        else if (typeof v === "object" && v !== null && "richText" in v) cells.push((v as { richText: { text: string }[] }).richText.map((t) => t.text).join(""));
        else if (typeof v === "object" && v !== null && "text" in v) cells.push(String((v as { text: unknown }).text));   // hyperlink cell: its visible text
        else if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
        else cells.push(String(v));
      }
      table.push(cells);
    });
    table = table.filter((r) => r.some((c) => c.trim() !== ""));
  }

  if (table.length < 2) throw new ImportFileError("The file needs a header row and at least one data row.");
  const width = Math.max(...table.slice(0, 50).map((r) => r.length));
  if (width > limits.maxColumns) throw new ImportFileError(`The file has more than ${limits.maxColumns} columns.`);
  const headers = table[0].map((h) => h.trim());
  const body = table.slice(1);
  const truncated = body.length > limits.maxRows;
  if (truncated) throw new ImportFileError(`The file has more than ${limits.maxRows} rows. Split it into smaller files.`);
  return { fileName, sha256, kind: sniff.kind, headers, rows: body, truncated };
}
