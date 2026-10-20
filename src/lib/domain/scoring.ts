import Decimal from "decimal.js";

// Deterministic decimal arithmetic mirrors the SQL scoring functions (ADR-012).
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const WEEKLY_RULE_VERSION = "weekly-rules-1.0.0";

export function calcBaseScore(doneGoals: number, totalGoals: number): Decimal {
  if (totalGoals <= 0) return new Decimal(0);
  return new Decimal(doneGoals).times(100).div(totalGoals);
}

/** combinedRate = sum(appliedRates); final = round2(max(0, base * (1 - combinedRate))). */
export function calcFinalScore(
  base: Decimal.Value,
  appliedRates: Decimal.Value[],
): { combinedRate: Decimal; final: Decimal } {
  const combinedRate = appliedRates.reduce<Decimal>((s, r) => s.plus(r), new Decimal(0));
  const raw = new Decimal(base).times(new Decimal(1).minus(combinedRate));
  const final = Decimal.max(0, raw).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { combinedRate, final };
}

export type WeekContribution = { value: Decimal.Value; excluded?: boolean };

/** Fixed-denominator quarterly mean; holiday weeks are excluded, N/A when nothing is eligible. */
export function calcQuarterlyScore(weeks: WeekContribution[]): {
  score: Decimal | null;
  reason: string | null;
  denominator: number;
  numerator: Decimal;
} {
  const eligible = weeks.filter((w) => !w.excluded);
  if (eligible.length === 0) {
    return { score: null, reason: "NO_ELIGIBLE_REPORTING_WEEKS", denominator: 0, numerator: new Decimal(0) };
  }
  const numerator = eligible.reduce<Decimal>((s, w) => s.plus(w.value), new Decimal(0));
  return {
    score: numerator.div(eligible.length).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    reason: null,
    denominator: eligible.length,
    numerator,
  };
}

export const formatScore = (d: Decimal.Value | null | undefined): string =>
  d === null || d === undefined ? "N/A" : new Decimal(d).toFixed(2);
