import type { MetricDefinition } from "./types";

/**
 * The metrics catalogue: one definition per figure shown anywhere in Reports, so tables, charts, insights and exports always
 * agree. OFFICIAL = produced by the existing scoring engine or ledger and only read here. DERIVED = arithmetic on official
 * values with a documented formula. PENDING_APPROVAL = a proposed definition the business has not yet approved; shown with a label.
 */
export const METRICS_VERSION = "metrics-1.0.0";

const m = (x: Omit<MetricDefinition, "version">): MetricDefinition => ({ ...x, version: METRICS_VERSION });

export const METRICS: MetricDefinition[] = [
  m({
    id: "weekly_score", name: "Weekly BU score", status: "OFFICIAL",
    definition: "A BU's equal-weight goal score for one finalised reporting week, after any applied integrity penalty.",
    formula: "max(0, goals done ÷ goals × 100 × (1 − combined penalty rate)), rounded to 2 places; 0.00 when no report was submitted",
    numerator: "Goals whose every task is Done", denominator: "Goals in the submitted report", unit: "points (0–100)",
    source: "weekly_score_snapshots (latest version per BU and week)", aggregation: "None: one value per BU and week",
    nullRules: "Weeks not yet finalised show no score. Holiday weeks have no score and are excluded, never treated as zero.",
    caveats: ["A later integrity correction or late-report amendment adds a new snapshot version; reports show the latest version.", "Not comparable across weeks with very different goal counts without context."],
  }),
  m({
    id: "quarterly_score", name: "Quarterly BU score", status: "OFFICIAL",
    definition: "The mean of a BU's weekly scores over all non-holiday reporting weeks of the quarter, with a fixed denominator.",
    formula: "sum of weekly final scores ÷ number of eligible non-holiday weeks, rounded to 2 places; N/A when there are no eligible weeks",
    numerator: "Sum of weekly final scores of finalised weeks", denominator: "All eligible (non-holiday) weeks in the quarter, scored or not", unit: "points (0–100)",
    source: "quarterly_score_snapshots (latest version per BU and quarter)", aggregation: "Mean over weeks, computed by the scoring engine",
    nullRules: "A missing report scores 0.00 and counts. Weeks still pending count in the denominator, so the score rises as weeks are finalised.",
    caveats: ["PROVISIONAL until the quarter is locked and every week is finalised and reviewed.", "Late-report and holiday amendments create new versions; earlier versions are kept."],
  }),
  m({
    id: "org_mean_bu_score", name: "Average of BU scores", status: "PENDING_APPROVAL",
    definition: "The simple average of the BU weekly (or quarterly) scores visible to the viewer. It is a summary of the BUs, not an official organisation score.",
    formula: "sum of BU scores ÷ number of BUs with a score", numerator: "BU scores", denominator: "BUs with a score for that week", unit: "points (0–100)",
    source: "Derived from weekly_score_snapshots / quarterly_score_snapshots", aggregation: "Unweighted mean across BUs",
    nullRules: "BUs without a score for the week are left out of that week's average and the count is shown.",
    caveats: ["The application has no approved organisation-level score; this label is provisional until one is defined.", "A BU Lead sees only their own BU, so for them the average is that BU's score."],
  }),
  m({
    id: "score_movement", name: "Score movement", status: "DERIVED",
    definition: "Change between a score and the immediately preceding comparable score of the same metric and BU.",
    formula: "current − previous (points). Percent change = (current − previous) ÷ previous × 100, shown only when previous ≠ 0",
    unit: "points", source: "Derived from weekly or quarterly snapshots", aggregation: "None",
    nullRules: "No previous comparable value means no movement is shown. Holiday and pending weeks are skipped, not compared as zero.",
    caveats: ["Week-on-week movement can reflect a different number of goals, not only performance."],
  }),
  m({
    id: "quarter_vs_previous", name: "Quarter-on-quarter change", status: "DERIVED",
    definition: "Latest quarterly score minus the latest score of the immediately preceding calendar quarter for the same BU.",
    formula: "this quarter's score − previous quarter's score", unit: "points", source: "quarterly_score_snapshots", aggregation: "None",
    nullRules: "No score in either quarter, or no previous quarter, means no comparison. A provisional current quarter is flagged.",
    caveats: ["A quarter in progress is compared with a finished one: the current score is still rising as weeks are finalised."],
  }),
  m({
    id: "rank", name: "Rank", status: "DERIVED",
    definition: "Position of a BU when BUs are ordered by quarterly score, highest first. Ties share a rank.",
    formula: "1 + number of BUs with a strictly higher score (standard competition ranking)", unit: "position",
    source: "quarterly_score_snapshots", aggregation: "Ordering across the BUs visible to the viewer",
    nullRules: "BUs without a score are unranked. No bonus, penalty or weighting is added.",
    caveats: ["Rank alone does not show direction: read it with rank movement and score movement.", "BUs have different objectives and goal counts; a rank is not a judgement of effort."],
  }),
  m({
    id: "rank_movement", name: "Rank movement", status: "DERIVED",
    definition: "How many places a BU moved between two points in time, using the cumulative average of its finalised weekly scores.",
    formula: "rank before the latest finalised week − rank after it (positive = moved up)", unit: "places",
    source: "weekly_score_snapshots", aggregation: "Ranking of cumulative means across visible BUs",
    nullRules: "Needs at least two finalised weeks and a score in both positions.", caveats: ["Cumulative means move slowly early in the quarter."],
  }),
  m({
    id: "compliance_rate", name: "Reporting compliance rate", status: "OFFICIAL",
    definition: "Share of finalised, reportable weeks in which the BU's report was submitted by the final lock, as recorded by the compliance determination.",
    formula: "compliant weeks ÷ (compliant weeks + non-compliant weeks) × 100",
    numerator: "Weeks recorded COMPLIANT", denominator: "Finalised non-holiday weeks the BU was expected to report", unit: "%",
    source: "weekly_compliance", aggregation: "Counted per BU, or across BUs for the organisation",
    nullRules: "Holiday weeks and weeks before the BU existed are excluded from the denominator. Weeks not yet finalised are excluded. No finalised week means no rate.",
    caveats: ["A report accepted later through a late-report exception does NOT change this: compliance stays non-compliant unless a separate approved decision says otherwise."],
  }),
  m({
    id: "early_submission_rate", name: "Submitted before content lock", status: "PENDING_APPROVAL",
    definition: "Share of expected weeks in which the report was submitted before the content lock.",
    formula: "reports submitted at or before the content lock ÷ finalised expected weeks × 100", unit: "%",
    source: "weekly_reports.submitted_at, reporting_weeks.content_lock_at", aggregation: "Counted per BU or across BUs",
    nullRules: "Same denominator as the compliance rate.", caveats: ["The official deadline is the final lock; this stricter measure is informational and needs approval before it is used for judgement."],
  }),
  m({
    id: "review_rate", name: "Review rate", status: "DERIVED",
    definition: "Share of submitted, final-locked reports that a reviewer has marked reviewed.",
    formula: "reviewed reports ÷ submitted final-locked reports × 100", unit: "%", source: "weekly_reports.review_status", aggregation: "Counted",
    nullRules: "No submitted final-locked reports means no rate.", caveats: ["Unreviewed reports keep the quarterly score PROVISIONAL."],
  }),
  m({
    id: "missing_reports", name: "Missing reports", status: "OFFICIAL",
    definition: "Finalised, reportable weeks in which no report was submitted by the final lock.",
    formula: "count of compliance records with status NON_COMPLIANT", unit: "weeks", source: "weekly_compliance", aggregation: "Sum",
    nullRules: "Holiday weeks never count.", caveats: ["Includes weeks later filed under a late-report exception; the exception is shown in its own column."],
  }),
  m({
    id: "late_exceptions", name: "Late-report exceptions", status: "OFFICIAL",
    definition: "Weeks for which a late-report exception was authorised, with its current stage.",
    formula: "count of exceptions per stage (AUTHORISED, SUBMITTED, APPLIED)", unit: "weeks", source: "late_report_exceptions", aggregation: "Count",
    nullRules: "Revoked exceptions are not shown.", caveats: ["APPLIED means the score was amended; it does not make the original week compliant."],
  }),
  m({
    id: "sub_kr_execution", name: "Sub-KR execution", status: "OFFICIAL",
    definition: "Share of goals mapped to a Sub-KR, in submitted final-locked reports, whose every task is Done. It is an execution measure, not the underlying business outcome.",
    formula: "done mapped goals ÷ total mapped goals × 100", numerator: "Mapped goals with every task Done", denominator: "Goals mapped to the Sub-KR", unit: "%",
    source: "smart_goals, weekly_reports (same definition as the Strategy screen)", aggregation: "Counts summed across BUs and weeks",
    nullRules: "No mapped goals means no value, shown as 'no goals mapped', never 0%.",
    caveats: ["The application stores no numeric KR target or actual, so target-versus-actual KR attainment cannot be computed."],
  }),
  m({
    id: "sub_kr_trend", name: "Sub-KR execution trend", status: "DERIVED",
    definition: "Direction of weekly execution over the last finalised weeks of the quarter.",
    formula: "slope of a straight line through weekly execution % of the last 6 weeks with goals; IMPROVING above +2 points/week, DECLINING below −2, else STEADY",
    unit: "points per week", source: "Derived from the weekly mapped and done goal counts", aggregation: "Least-squares slope",
    nullRules: "Fewer than 3 weeks with goals gives 'not enough history'.", caveats: ["The ±2 threshold is a documented default awaiting approval."],
  }),
  m({
    id: "forecast_quarter_score", name: "Projected quarter-end score", status: "DERIVED",
    definition: "Where a BU's official quarterly score is expected to finish if the remaining weeks resemble the weeks scored so far. A projection, never an actual.",
    formula: "(sum of scored weeks + projected remaining weeks) ÷ fixed denominator; remaining weeks use the average or a fitted trend, whichever back-tested better",
    unit: "points (0–100)", source: "weekly_score_snapshots + quarterly denominator", aggregation: "Per BU",
    nullRules: "Fewer than 4 scored weeks: no projection is shown.", caveats: ["Does not predict holidays, amendments, corrections or penalties.", "The 95% range is approximate and assumes independent weeks."],
  }),
  m({
    id: "governance_age", name: "Outstanding item age and priority", status: "PENDING_APPROVAL",
    definition: "Days an approval, review or exception has waited, with a priority band.",
    formula: "whole days since the item was raised; priority HIGH above 7 days, MEDIUM above 3, otherwise LOW", unit: "days", source: "approval and exception tables", aggregation: "None",
    nullRules: "Completed items are not listed.", caveats: ["The bands are a proposed default; no approved service-level targets exist in the application."],
  }),
  m({
    id: "ledger_balance", name: "Violation fund balance", status: "OFFICIAL",
    definition: "Credits minus debits on the append-only fund ledger (actuals only; the application holds no budget or projection).",
    formula: "sum of CREDIT entries − sum of DEBIT entries", unit: "NGN", source: "financial_ledger_entries", aggregation: "Sum per month, running closing balance",
    nullRules: "Months with no entries show zero movement.", caveats: ["Month boundaries use the Africa/Lagos calendar."],
  }),
  m({
    id: "integrity_corrections", name: "Integrity corrections", status: "OFFICIAL",
    definition: "Task-status corrections made after content lock, with the penalty decision taken.",
    formula: "count of corrections; applied = decision APPLY, waived = decision WAIVE", unit: "corrections", source: "integrity_corrections", aggregation: "Count",
    nullRules: "None.", caveats: ["A count is not a judgement: a correction can fix an honest error."],
  }),
];

export const metricById = (id: string) => METRICS.find((x) => x.id === id);
export const metricsFor = (ids: string[]) => ids.map((i) => metricById(i)).filter((x): x is MetricDefinition => !!x);
