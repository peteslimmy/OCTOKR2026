/**
 * Report assistant (ADR-053). It does NOT use a language model and it never writes SQL. It maps a plain-language question to one
 * of the approved reports and their filters, and says plainly when the question needs data the application does not hold.
 * The answer to the question is the report itself, run with the asker's own permissions.
 */
export const ASSISTANT_VERSION = "intent-router-1.0.0";

export interface AssistantAnswer {
  matched: boolean;
  reportId: string | null;
  quarterOffset: 0 | -1;
  answer: string;
  caveat?: string;
  blocked?: { needs: string };
  suggestions: string[];
}

const SUGGESTIONS = [
  "Which Business Units improved the most this quarter?", "Compare reporting compliance across BUs", "Which BUs are at risk of finishing low?",
  "What approvals are outstanding?", "Show performance trends by week", "How are the key results progressing?",
];

const has = (q: string, re: RegExp) => re.test(q);

export function routeQuestion(question: string): AssistantAnswer {
  const q = question.toLowerCase().trim();
  const offset: 0 | -1 = has(q, /(last|previous|prior) quarter/) ? -1 : 0;
  const out = (reportId: string, answer: string, caveat?: string): AssistantAnswer => ({ matched: true, reportId, quarterOffset: offset, answer, caveat, suggestions: SUGGESTIONS });
  const blocked = (answer: string, needs: string): AssistantAnswer => ({ matched: true, reportId: null, quarterOffset: 0, answer, blocked: { needs }, suggestions: SUGGESTIONS });

  if (q.length < 3) return { matched: false, reportId: null, quarterOffset: 0, answer: "Ask about performance, compliance, forecasts, key results, approvals, corrections, holidays or the violation fund.", suggestions: SUGGESTIONS };

  // data the application does not hold: say so instead of improvising
  if (has(q, /\b(employee|individual|personal|staff|kpi|mentor|deliverable)\b/)) {
    return blocked("Employee-level KPIs and deliverables are not stored in the application, so they cannot be reported.", "An approved employee KPI model with data capture.");
  }
  if (has(q, /\b(revenue|budget|projection variance|financial projection|profit|sales target)\b/)) {
    return blocked("There is no budget, revenue or financial projection data. Only the violation fund ledger (actuals) is available.", "A financial planning module and approved projection versions.");
  }
  if (has(q, /\b(targets?|attainment)\b/) && has(q, /\b(krs?|key results?|okrs?)\b/)) {
    return blocked("Key results have no numeric targets or actuals in the application, so target-versus-actual attainment cannot be computed. Goal execution per Sub-KR is available.", "Numeric KR targets, actuals and an approved achievement definition.");
  }
  if (has(q, /\bwhy\b|\bcause|\broot cause|\bdriver|\breason for\b/)) {
    return { matched: true, reportId: "performance-trends", quarterOffset: offset, suggestions: SUGGESTIONS,
      answer: "The data shows what changed, not why. The trends report shows when each BU moved; the reporting register and integrity corrections show missing reports and corrections that coincide with those moves.",
      caveat: "Coincidence is not cause. No causal analysis is performed." };
  }

  if (has(q, /\b(forecast|project|predict|likely|finish|end of (the )?quarter|at risk of)/)) return out("quarter-forecast", "Projected quarter-end scores with a 95% range, shown separately from official scores.", "Projections assume remaining weeks resemble weeks scored so far.");
  if (has(q, /\b(compliance|compliant|late|missing|on.?time|submitted|submission|overdue report)/)) {
    return out(has(q, /\b(which weeks|register|list|each week)\b/) ? "reporting-register" : "weekly-compliance", "Reporting compliance, with late-report exceptions shown separately.", "A report accepted late does not become compliant.");
  }
  if (has(q, /\b(trend|over time|week by week|weekly|decline|declin|deteriorat|improv|getting (better|worse)|since)\b/)) return out("performance-trends", "Weekly score by BU with movement from the previous scored week.");
  if (has(q, /\b(rank|ranking|top|best|worst|bottom|leader|compare|comparison|scorecard|score)\b/)) return out("bu-scorecard", "BU scores, change from the previous quarter, rank and rank movement.", "Rank alone does not show direction; read it with the change columns.");
  if (has(q, /\b(krs?|key results?|sub-krs?|okrs?|objectives?|goals?)\b/)) return out("okr-health", "Sub-KR execution with weekly trend.", "Execution is goals done over goals mapped, not a business outcome.");
  if (has(q, /\b(approval|approve|pending|outstanding|governance|amendment|exception|awaiting|backlog)\b/)) return out("governance-outstanding", "Everything waiting for a decision, oldest first.");
  if (has(q, /\b(integrity|penalt|correction)\b/)) return out("integrity-corrections", "Post-lock task corrections with penalty decisions.");
  if (has(q, /\bholiday\b/)) return out("holiday-impact", "Holiday weeks and post-lock holiday amendments.");
  if (has(q, /\b(fund|ledger|disburse|violation|balance|money|financ)/)) return out("fund-actuals", "Violation fund actuals by month and disbursement status.", "Actuals only; no budget or projection data exists.");
  if (has(q, /\b(quality|reliab|trust|accura|complete|stale)\b/)) return out("data-quality", "Checks on whether the figures can be trusted.");
  if (has(q, /\b(organisation|organization|overall|summary|company|everyone)\b/)) return out("org-performance-summary", "Average BU score by week and quarter, with reporting health.");

  return { matched: false, reportId: null, quarterOffset: 0, answer: "I could not match that to an approved report. Try one of the suggestions, or browse the catalogue.", suggestions: SUGGESTIONS };
}
