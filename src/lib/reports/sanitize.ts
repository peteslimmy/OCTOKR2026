/**
 * Spreadsheet formula-injection defence for exported text (OWASP "CSV injection"). A cell that begins with = + - @ tab or CR can be
 * executed as a formula by Excel or Sheets. Such text is prefixed with an apostrophe so it is displayed, never evaluated.
 * Only strings are changed: numbers and dates are written as typed values.
 */
export function safeCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export const csvEscape = (value: unknown): string => {
  const v = safeCell(value);
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const MAX_EXPORT_ROWS = 20_000;

/** Keeps only the requested column keys that really exist, in the report's own order. Unknown keys are ignored, never trusted. */
export function pickColumns<T extends { key: string }>(columns: T[], requested: string | null | undefined): T[] {
  if (!requested) return columns;
  const want = new Set(requested.split(",").map((k) => k.trim()).filter(Boolean));
  const kept = columns.filter((c) => want.has(c.key));
  return kept.length ? kept : columns;
}

/**
 * Canonical JSON for checksums: object keys sorted at every depth. PostgreSQL's jsonb does not keep key order, so a checksum over
 * plain JSON.stringify would stop matching after a round trip through the database.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
