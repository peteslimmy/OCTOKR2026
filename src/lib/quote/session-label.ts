/**
 * What the weekly quote allocation says about a week's session. A quote can only be presented in a session that took place, so a presented quote means the session was held
 * whether or not the session was marked as held. A week that has passed with nothing recorded is "Not recorded", never "Coming".
 */
export interface SessionLabelInput {
  reporting_state: string;
  session_outcome: string | null;
  week_start_at: string;
  turn: { status: string } | null;
}
const WEEK_MS = 7 * 86_400_000;

export function sessionLabel(r: SessionLabelInput, now: number = Date.now()): "Holiday" | "Skipped" | "Held" | "Not recorded" | "Coming" {
  if (r.reporting_state !== "NORMAL") return "Holiday";
  if (r.session_outcome === "SKIPPED") return "Skipped";
  if (r.session_outcome === "HELD" || r.turn?.status === "PRESENTED") return "Held";
  return new Date(r.week_start_at).getTime() + WEEK_MS <= now ? "Not recorded" : "Coming";
}
