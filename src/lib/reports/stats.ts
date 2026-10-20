// Small, dependency-free statistics used by the reporting module. Pure functions: no I/O, fully unit-tested.

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Sample standard deviation (n − 1). Null for fewer than two values. */
export function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Two-sided 95% Student t critical values for 1..30 degrees of freedom; 1.96 beyond. */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tCritical95 = (df: number) => (df < 1 ? Infinity : df <= 30 ? T95[df - 1] : 1.96);

export interface Regression { slope: number; intercept: number; n: number; residualSd: number; r2: number }

/** Ordinary least squares on (x, y). Needs at least three points; residual SD uses n − 2 degrees of freedom. */
export function linearRegression(points: { x: number; y: number }[]): Regression | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = mean(points.map((p) => p.x))!;
  const my = mean(points.map((p) => p.y))!;
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
  const intercept = my - slope * mx;
  const sse = points.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const sst = points.reduce((a, p) => a + (p.y - my) ** 2, 0);
  return { slope, intercept, n, residualSd: Math.sqrt(sse / (n - 2)), r2: sst === 0 ? 1 : 1 - sse / sst };
}

export const predictAt = (r: Regression, x: number) => r.intercept + r.slope * x;

/** z-score of `value` against a history, or null when the history is too short or has no spread. */
export function zScore(value: number, history: number[]): number | null {
  const sd = stdev(history);
  const m = mean(history);
  if (sd === null || m === null || sd === 0) return null;
  return (value - m) / sd;
}

/** Change between two comparable values. Percent change only when the base is non-zero (never divides by zero). */
export function change(current: number | null | undefined, previous: number | null | undefined): { abs: number | null; pct: number | null } {
  if (current === null || current === undefined || previous === null || previous === undefined) return { abs: null, pct: null };
  return { abs: round(current - previous), pct: previous === 0 ? null : round(((current - previous) / Math.abs(previous)) * 100) };
}

/** Standard competition ranking ("1224"): ties share a rank. Higher score ranks first; nulls are unranked. */
export function rankDescending(scores: (number | null)[]): (number | null)[] {
  return scores.map((s) => (s === null ? null : 1 + scores.filter((o) => o !== null && o > s).length));
}
