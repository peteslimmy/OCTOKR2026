import { clamp, linearRegression, mean, predictAt, round, tCritical95 } from "./stats";

/**
 * Quarter-end projection for one BU (ADR-053). Transparent baselines only:
 *   MEAN   remaining weeks score the average of the weeks observed so far (carry-forward);
 *   TREND  remaining weeks follow a straight line fitted to the most recent weeks.
 * The method is chosen by rolling-origin back-testing on the BU's own history, never by preference: TREND is used only if it
 * beat MEAN on at least three held-out weeks. The quarterly formula is the official one: (sum of weekly scores) ÷ (fixed
 * denominator of eligible weeks), so a projection is "what the official score will be if the remaining weeks look like this".
 */
export const FORECAST_VERSION = "forecast-1.0.0";
export const MIN_WEEKS_FOR_FORECAST = 4;
const TREND_WINDOW = 8;

export type ForecastStatus = "OK" | "INSUFFICIENT_DATA" | "COMPLETE";

export interface ForecastInput {
  /** Final weekly scores of the finalised, non-holiday weeks, oldest first. */
  weeklyScores: number[];
  /** The fixed denominator of the quarter (all eligible weeks, scored or not). */
  denominator: number;
}

export interface Forecast {
  status: ForecastStatus;
  method: "MEAN" | "TREND" | null;
  weeksObserved: number;
  weeksRemaining: number;
  currentToDate: number | null;     // official-formula score if the quarter ended today (numerator ÷ denominator)
  projected: number | null;
  low: number | null;
  high: number | null;
  projectedWeeklyPath: number[];    // projected score of each remaining week
  /** Official-formula score at the end of each remaining week (running), with the 95% range widening as the horizon grows. */
  cumulative: { score: number; low: number; high: number }[];
  backtest: { points: number; maeMean: number | null; maeTrend: number | null; trendBeatMean: boolean };
  assumptions: string[];
  limitations: string[];
}

function trendPredict(history: number[]): number | null {
  const window = history.slice(-TREND_WINDOW);
  const reg = linearRegression(window.map((y, i) => ({ x: i, y })));
  return reg ? clamp(predictAt(reg, window.length), 0, 100) : null;
}

function backtest(scores: number[]) {
  let eMean = 0, eTrend = 0, nMean = 0, nTrend = 0, points = 0;
  for (let t = 3; t < scores.length; t++) {
    const history = scores.slice(0, t);
    const actual = scores[t];
    const m = mean(history)!;
    eMean += Math.abs(actual - m); nMean++;
    const tr = trendPredict(history);
    if (tr !== null) { eTrend += Math.abs(actual - tr); nTrend++; }
    points++;
  }
  return {
    points,
    maeMean: nMean ? round(eMean / nMean) : null,
    maeTrend: nTrend ? round(eTrend / nTrend) : null,
  };
}

export function projectQuarterEnd({ weeklyScores, denominator }: ForecastInput): Forecast {
  const n = weeklyScores.length;
  const remaining = Math.max(0, denominator - n);
  const sum = weeklyScores.reduce((a, b) => a + b, 0);
  const base: Forecast = {
    status: "INSUFFICIENT_DATA", method: null, weeksObserved: n, weeksRemaining: remaining,
    currentToDate: denominator > 0 ? round(sum / denominator) : null, projected: null, low: null, high: null, projectedWeeklyPath: [], cumulative: [],
    backtest: { points: 0, maeMean: null, maeTrend: null, trendBeatMean: false }, assumptions: [], limitations: [],
  };
  if (denominator <= 0) return { ...base, limitations: ["The quarter has no eligible reporting weeks."] };
  if (remaining === 0) return { ...base, status: "COMPLETE", projected: round(sum / denominator), low: round(sum / denominator), high: round(sum / denominator),
    limitations: ["Every eligible week is scored: the result is final, not a projection."] };
  if (n < MIN_WEEKS_FOR_FORECAST) {
    return { ...base, limitations: [`Only ${n} scored week${n === 1 ? "" : "s"}; at least ${MIN_WEEKS_FOR_FORECAST} are needed before a projection is shown.`] };
  }

  const bt = backtest(weeklyScores);
  const trendBeatMean = bt.points >= 3 && bt.maeTrend !== null && bt.maeMean !== null && bt.maeTrend < bt.maeMean;
  const method: "MEAN" | "TREND" = trendBeatMean ? "TREND" : "MEAN";

  // projected path
  const path: number[] = [];
  const hist = [...weeklyScores];
  for (let i = 0; i < remaining; i++) {
    const next = method === "TREND" ? (trendPredict(hist) ?? mean(hist)!) : mean(weeklyScores)!;
    path.push(round(clamp(next, 0, 100)));
    hist.push(next);
  }
  const projected = (sum + path.reduce((a, b) => a + b, 0)) / denominator;

  // interval: week-to-week spread of the history, treated as independent across the remaining weeks (stated as an assumption)
  const reg = linearRegression(weeklyScores.slice(-TREND_WINDOW).map((y, i) => ({ x: i, y })));
  const sdWeek = method === "TREND" && reg ? reg.residualSd : Math.sqrt(weeklyScores.reduce((a, b) => a + (b - mean(weeklyScores)!) ** 2, 0) / Math.max(1, n - 1));
  const df = method === "TREND" && reg ? reg.n - 2 : n - 1;
  const half = (tCritical95(df) * sdWeek * Math.sqrt(remaining)) / denominator;

  const cumulative = path.map((_, i) => {
    const score = (sum + path.slice(0, i + 1).reduce((a, b) => a + b, 0)) / denominator;
    const h = (tCritical95(df) * sdWeek * Math.sqrt(i + 1)) / denominator;
    return { score: round(clamp(score, 0, 100)), low: round(clamp(score - h, 0, 100)), high: round(clamp(score + h, 0, 100)) };
  });

  return {
    ...base,
    cumulative,
    status: "OK", method, projected: round(clamp(projected, 0, 100)), low: round(clamp(projected - half, 0, 100)), high: round(clamp(projected + half, 0, 100)),
    projectedWeeklyPath: path,
    backtest: { ...bt, trendBeatMean },
    assumptions: [
      method === "TREND"
        ? `Each remaining week continues a straight-line trend fitted to the last ${Math.min(n, TREND_WINDOW)} scored weeks.`
        : "Each remaining week scores the average of the weeks scored so far.",
      "The quarterly score uses the official rule: sum of weekly scores divided by the fixed number of eligible weeks.",
      "The 95% range assumes remaining weeks vary like the observed weeks and are independent of each other.",
    ],
    limitations: [
      bt.points < 3
        ? "Too few weeks to back-test the methods, so the simpler average is used and its accuracy is unmeasured."
        : `Back-test over ${bt.points} held-out weeks: mean absolute error ${bt.maeMean} points (average method)` + (bt.maeTrend !== null ? ` and ${bt.maeTrend} points (trend method).` : "."),
      "Future holidays, late-report amendments, integrity corrections and penalties are not predicted.",
      ...(sdWeek === 0 ? ["Every scored week was identical, so the range shows no spread. That is not certainty about the weeks to come."] : []),
    ],
  };
}

/** What-if: the official score if the remaining weeks all averaged `assumedWeeklyAverage`. Hypothetical; never stored. */
export function scenarioQuarterEnd(sumSoFar: number, denominator: number, weeksRemaining: number, assumedWeeklyAverage: number): number | null {
  if (denominator <= 0) return null;
  return round(clamp((sumSoFar + weeksRemaining * clamp(assumedWeeklyAverage, 0, 100)) / denominator, 0, 100));
}
