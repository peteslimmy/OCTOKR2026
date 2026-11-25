/**
 * A task's text sometimes arrives with its own list number ("1. Optimize the portal"), typed in a sheet or a pasted list. The screens already number
 * tasks by position (1.1, 1.2), so the typed number shows twice. This removes ONE leading number of the form "1." or "2)" followed by a space.
 * It never changes text that merely starts with a number ("2026 targets", "3.5% growth review") and never returns an empty string.
 */
export function stripLeadingNumber(text: string): string {
  const stripped = text.replace(/^\s*\d{1,3}\s*[.)]\s+/, "").trim();
  return stripped.length > 0 ? stripped : text;
}
