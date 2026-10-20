import type { BlockedReport, ReportDefinition } from "./types";

export const REPORTS_VERSION = "reports-1.0.0";

const ALL: ReportDefinition["outputs"] = ["TABLE", "CHART", "CSV", "XLSX", "PDF"];
const ORG: ReportDefinition["outputs"] = [...ALL, "SNAPSHOT"];

/** Reports that run today against real data. Each is read-only and uses the existing scoring results. */
export const REPORTS: ReportDefinition[] = [
  {
    id: "org-performance-summary", title: "Organisation performance summary", category: "Executive and organisation",
    description: "Week-by-week average of BU scores for the quarter with movement, spread and reporting health, compared with the previous quarter.",
    audience: "Executives, Directors, Presenters, Admins", requires: [], params: ["quarter"],
    metricIds: ["weekly_score", "org_mean_bu_score", "score_movement", "quarterly_score", "quarter_vs_previous", "compliance_rate"], outputs: ORG, organisationWide: true,
  },
  {
    id: "bu-scorecard", title: "Business Unit scorecard and ranking", category: "Business Unit performance",
    description: "Each BU's quarterly score, change from the previous quarter, last-week movement, rank and rank movement, and reporting discipline.",
    audience: "Executives, Directors, Presenters, BU Leads (own BU)", requires: [], params: ["quarter", "bu"],
    metricIds: ["quarterly_score", "quarter_vs_previous", "score_movement", "rank", "rank_movement", "compliance_rate", "missing_reports"], outputs: ORG, organisationWide: true,
  },
  {
    id: "performance-trends", title: "Performance trends by week", category: "Business Unit performance",
    description: "Every BU's weekly score across the quarter with week-on-week movement. Shows direction, which a rank alone cannot.",
    audience: "Executives, Directors, Presenters, BU Leads (own BU)", requires: [], params: ["quarter", "bu"],
    metricIds: ["weekly_score", "score_movement"], outputs: ORG, organisationWide: true,
  },
  {
    id: "quarter-forecast", title: "Quarter-end projection", category: "Forecasts",
    description: "Projected final quarterly score per BU with a 95% range, the method used, back-test error and a what-if figure. Projections are labelled and never mixed with actuals.",
    audience: "Executives, Directors, BU Leads (own BU)", requires: [], params: ["quarter", "bu"],
    metricIds: ["forecast_quarter_score", "quarterly_score", "weekly_score"], outputs: ALL, organisationWide: false,
  },
  {
    id: "weekly-compliance", title: "Reporting compliance by BU", category: "Weekly reporting and compliance",
    description: "Compliant, non-compliant, holiday and pending weeks per BU, with review rate and late-report exceptions kept separate from compliance.",
    audience: "Executives, Directors, Presenters, HR, Admins, BU Leads (own BU)", requires: [], params: ["quarter", "bu"],
    metricIds: ["compliance_rate", "early_submission_rate", "review_rate", "missing_reports", "late_exceptions"], outputs: ORG, organisationWide: true,
  },
  {
    id: "reporting-register", title: "Weekly reporting register", category: "Weekly reporting and compliance",
    description: "One row per BU and week: result state, submission time, whether it beat the content lock, compliance, review and any late-report exception, with links to the report.",
    audience: "Executives, Presenters, Admins, BU Leads (own BU)", requires: [], params: ["quarter", "bu"],
    metricIds: ["weekly_score", "compliance_rate", "late_exceptions"], outputs: ALL, organisationWide: false,
  },
  {
    id: "late-report-register", title: "Late-report exceptions", category: "Weekly reporting and compliance",
    description: "Authorised late-report exceptions with stage, reviewer, applier and the score change when applied. Compliance is shown unchanged.",
    audience: "Admins, Executives, Presenters, BU Leads (own BU)", requires: [], params: ["bu"],
    metricIds: ["late_exceptions", "weekly_score", "quarterly_score"], outputs: ALL, organisationWide: false,
  },
  {
    id: "okr-health", title: "OKR health: Sub-KR execution", category: "Strategy and OKR",
    description: "Execution of every Sub-KR in the quarter's objective with its weekly trend. Execution is goals done over goals mapped; no numeric KR targets exist to compare.",
    audience: "Executives, Directors, Presenters, Admins, BU Leads (own BU)", requires: [], params: ["quarter"],
    metricIds: ["sub_kr_execution", "sub_kr_trend"], outputs: ALL, organisationWide: false,
  },
  {
    id: "governance-outstanding", title: "Outstanding governance and approvals", category: "Session and governance",
    description: "Pending attendance amendments, disbursement requests, late-report exceptions, unreviewed reports and weeks awaiting finalisation, oldest first, with where to act.",
    audience: "Executives, Admins, Presenters, HR, Finance (items they may see)", requires: [], params: [],
    metricIds: ["governance_age"], outputs: ALL, organisationWide: false,
  },
  {
    id: "integrity-corrections", title: "Integrity corrections", category: "Session and governance",
    description: "Post-lock task corrections for the quarter with penalty decision, reason and who made them.",
    audience: "Executives, Presenters, Admins, BU Leads (own BU)", requires: [], params: ["quarter", "bu"],
    metricIds: ["integrity_corrections"], outputs: ALL, organisationWide: false,
  },
  {
    id: "holiday-impact", title: "Organisation holidays and amendments", category: "Session and governance",
    description: "Reporting weeks that are or were holidays, how often their state changed and whether post-lock amendments were applied.",
    audience: "Executives, Admins, HR, Presenters", requires: [], params: ["quarter"],
    metricIds: ["quarterly_score"], outputs: ALL, organisationWide: false,
  },
  {
    id: "fund-actuals", title: "Violation fund: actuals by month", category: "Financial",
    description: "Monthly credits, debits, net movement and closing balance of the violation fund, violations raised and disbursement request status. Actuals only: the application holds no budget or projection.",
    audience: "Finance, Admins, Executives, Directors, HR", requires: ["finance.fund.view", "finance.ledger.view"], params: ["period"],
    metricIds: ["ledger_balance"], outputs: ALL, organisationWide: false,
  },
  {
    id: "data-quality", title: "Data quality and reporting integrity", category: "Data quality",
    description: "Checks that the figures in these reports can be trusted: missing weekly scores, unreviewed backlog, provisional scores, unfinalised weeks and excluded units.",
    audience: "Admins, Executives, Directors, Presenters", requires: ["weekly_report.view_all"], params: ["quarter"],
    metricIds: ["quarterly_score"], outputs: ALL, organisationWide: true,
  },
];

export const reportById = (id: string) => REPORTS.find((r) => r.id === id);

/** What was asked for but cannot be produced truthfully today, and what would unblock it. Shown in the catalogue, never faked. */
export const BLOCKED_REPORTS: BlockedReport[] = [
  { title: "Employee KPI scorecard, personal deliverables, individual trends, team and manager views", category: "Business Unit performance",
    reason: "The application stores no employee KPIs, individual deliverables or personal-development, mentorship or cross-functional metrics. Goals belong to a BU's weekly report.",
    needs: "An approved employee KPI model (categories, weights, owners) and data capture." },
  { title: "Target-versus-actual and KR attainment rate", category: "Strategy and OKR",
    reason: "Key results and Sub-KRs have titles but no numeric target, actual or achievement rule. Only goal execution is measurable.",
    needs: "Numeric targets, actuals and an approved achievement definition per KR." },
  { title: "Financial projections, revenue, budget variance and forecast accuracy", category: "Financial",
    reason: "No budget, projection, revenue or actuals module exists. Only the violation fund ledger is available.",
    needs: "A financial planning module and approved projection versions." },
  { title: "Session-outcome correction and ledger reversal registers", category: "Session and governance",
    reason: "Both workflows are approved (decision 3) but not yet built, so there is no history to report.",
    needs: "Implementation of the two correction workflows." },
  { title: "Strategy definition version comparison", category: "Strategy and OKR",
    reason: "Edits to an active quarter's objective, KRs and Sub-KRs overwrite the text (audited, but not versioned).",
    needs: "The controlled strategy-change workflow with superseding versions (decision 5)." },
  { title: "Outstanding BU Lead comments and report rejection", category: "Weekly reporting and compliance",
    reason: "Reports have a reviewed flag only; there are no review comments or rejection state.",
    needs: "A review-comment and rejection workflow." },
  { title: "Scheduled report delivery by email", category: "Executive and organisation",
    reason: "No email provider is configured and no scheduler runs outside a user's request.",
    needs: "An SMTP provider, a managed scheduler and a verified end-to-end delivery test (decision 8)." },
  { title: "AI-written narrative and free-text assistant", category: "Forecasts",
    reason: "No AI provider or data-handling approval exists. The Insights page uses a rules engine; the assistant routes questions to approved reports.",
    needs: "An approved provider, a data-minimisation policy and an evaluation set." },
];
