// Shared, client-safe types for the Reports module (ADR-053).

export type ColumnType = "text" | "number" | "percent" | "date" | "datetime" | "money" | "status" | "link";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Metric in the catalogue that defines this column's value, if it is a metric. */
  metricId?: string;
  /** Hint shown beside the heading (unit, caveat). */
  hint?: string;
}

export interface SummaryItem { label: string; value: string | number | null; unit?: string; metricId?: string; note?: string; tone?: "good" | "warn" | "bad" | "neutral" }

export interface ChartPoint { x: string; /** Full label for tooltips and the text table, e.g. "Week 14, 30 Mar – 5 Apr 2026". */ label?: string; y: number | null; low?: number | null; high?: number | null; kind?: "actual" | "projected" }
export interface ChartSeries { name: string; points: ChartPoint[] }
export interface ChartSpec {
  id: string;
  kind: "line" | "bar" | "forecast";
  title: string;
  unit: string;
  yMin?: number;
  yMax?: number;
  series: ChartSeries[];
  caption?: string;
}

export type DataStatus = "COMPLETE" | "PARTIAL" | "NO_DATA";

export interface ReportParams {
  quarterId?: string;
  buId?: string;
  from?: string;      // yyyy-mm-dd (finance)
  to?: string;
}

export interface ReportResult {
  reportId: string;
  title: string;
  definitionVersion: string;
  generatedAt: string;           // server time of the database that produced the data
  scope: "ORGANISATION" | "BUSINESS_UNIT";
  scopeLabel: string;
  periodLabel: string;
  params: ReportParams;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: SummaryItem[];
  charts: ChartSpec[];
  notes: string[];
  dataStatus: DataStatus;
  metricIds: string[];
}

export type MetricStatus = "OFFICIAL" | "DERIVED" | "PENDING_APPROVAL";

export interface MetricDefinition {
  id: string;
  name: string;
  status: MetricStatus;
  definition: string;
  formula: string;
  numerator?: string;
  denominator?: string;
  unit: string;
  source: string;
  aggregation: string;
  nullRules: string;
  version: string;
  caveats: string[];
}

export type ReportCategory =
  | "Executive and organisation" | "Strategy and OKR" | "Business Unit performance" | "Weekly reporting and compliance"
  | "Session and governance" | "Financial" | "Data quality" | "Forecasts";

export interface ReportDefinition {
  id: string;
  title: string;
  category: ReportCategory;
  description: string;
  audience: string;
  /** Holders of any one of these data permissions may run it, on top of `reports.view`. Empty means any report viewer (scope is still enforced by RLS). */
  requires: string[];
  /** Which parameters the report understands. */
  params: ("quarter" | "bu" | "period")[];
  metricIds: string[];
  outputs: ("TABLE" | "CHART" | "CSV" | "XLSX" | "PDF" | "SNAPSHOT")[];
  /** Organisation-wide results only: required for official snapshots. */
  organisationWide: boolean;
}

export interface BlockedReport { title: string; category: ReportCategory; reason: string; needs: string }
