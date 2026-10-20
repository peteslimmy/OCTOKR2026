/**
 * Display formatting for numbers (ADR-055). Rule: every percentage, and every 0–100 score shown with a % sign, is displayed to
 * ONE decimal place. Stored and calculated values keep their full precision (weekly and quarterly scores are still computed and
 * stored to two places by the scoring engine, and exports keep the unrounded value); only the display is rounded.
 */
export const PERCENT_DECIMALS = 1;

const nf = (decimals: number) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false });
const ONE = nf(PERCENT_DECIMALS);

/** "50.0". Null, undefined and NaN give "N/A". */
export function formatDecimal1(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  return Number.isFinite(n) ? ONE.format(n) : "N/A";
}

/** A value already on a 0–100 scale: 50 → "50.0%". */
export function formatPercent(v: number | string | null | undefined): string {
  const s = formatDecimal1(v);
  return s === "N/A" ? s : `${s}%`;
}

/** A fraction: 0.05 → "5.0%". */
export function formatFraction(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  return Number.isFinite(n) ? formatPercent(n * 100) : "N/A";
}

/** A signed movement in points: +3.3, −1.0, 0.0. */
export function formatSigned1(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = ONE.format(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export type MetricKind = "count" | "percent" | "currency";
const NAIRA = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
const COUNT = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** One place that turns a metric value into text, so an animated counter and a static figure always read the same at rest. */
export function formatMetric(v: number, kind: MetricKind): string {
  if (kind === "percent") return formatPercent(v);
  if (kind === "currency") return NAIRA.format(v);
  return COUNT.format(Math.round(v));
}

/** Ease-out cubic for counters: progress 0..1 → 0..1. Clamped, so a late frame never overshoots the real value. */
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
