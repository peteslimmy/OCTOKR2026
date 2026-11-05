import type { Cell } from "@/lib/analytics";
import type { BuTrendPoint } from "@/lib/data/analytics";
import type { ExecutiveReport } from "@/lib/insights/executive-report";
import type { UnitAnalysis } from "@/lib/insights/management-brief";
import type { ActionRow, DecisionRow, RiskRow, SessionSummary, Workspace } from "@/lib/session-notes/types";
import type { Pseudonymiser } from "../safety";

/** Who is asking. The tools use only this: never anything the model said about who it is talking to. */
export interface Asker { id: string; buId: string | null; permissions: ReadonlySet<string> }

export interface Unit { id: string; code: string; name: string }
export interface Quarter { id: string; label: string }
export interface TaskRow { id: string; description: string; status: string; goalTitle: string; reportId: string; weekNumber: number; weekStart: string; dueAt: string; buId: string; buCode: string }
export interface TaskHistoryRow { from: string; to: string; source: string; at: string }

/** What the tools read. Every method runs as the signed-in person, so row-level security has already narrowed it; the tools check scope again in code. */
export interface ToolData {
  quarter(spec?: string): Promise<Quarter | null>;
  units(): Promise<Unit[]>;
  buAnalysis(unit: Unit, quarterId: string): Promise<{ quarterLabel: string; analysis: UnitAnalysis } | null>;
  orgReport(quarterId: string): Promise<{ quarterLabel: string; report: ExecutiveReport } | null>;
  trend(buId: string, quarterId: string): Promise<BuTrendPoint[]>;
  cells(quarterId: string): Promise<Cell[]>;
  unresolvedTasks(buId: string | null, limit: number): Promise<TaskRow[]>;
  taskHistory(taskId: string): Promise<TaskHistoryRow[] | null>;
  sessions?: SessionToolData;
}

/** The OKR session notes, read as the signed-in person (optional: a data source without them simply has no session tools). */
export interface SessionToolData {
  search(f: { q?: string; bu?: string; quarter?: string; from?: string; to?: string; status?: string; noteCategory?: string; decisionStatus?: string; actionStatus?: string; limit?: number }): Promise<{ total: number; rows: SessionSummary[] }>;
  detail(id: string): Promise<Workspace | null>;
  actions(f: { bu?: string; quarter?: string; status?: string; assignee?: string; overdue?: boolean; limit?: number }): Promise<ActionRow[]>;
  decisions(f: { bu?: string; quarter?: string; status?: string; from?: string; to?: string; limit?: number }): Promise<DecisionRow[]>;
  risks(f: { bu?: string; quarter?: string; status?: string; severity?: string; openOnly?: boolean; limit?: number }): Promise<RiskRow[]>;
}

export interface Source { label: string; href: string; period: string; kind: "organisation" | "unit" | "weekly report" | "task" | "session" }
export interface ToolOutput { data: unknown; sources: Source[]; period: string; limitations?: string[] }
export interface ToolError { error: "OUT_OF_SCOPE" | "NOT_FOUND" | "NO_DATA" | "INVALID"; message: string }
export type ToolRun = ToolOutput | ToolError;
export const isError = (r: ToolRun): r is ToolError => "error" in r;

export interface ToolContext { asker: Asker; data: ToolData; px: Pseudonymiser }
export interface ToolDef {
  name: string;
  description: string;
  /** The arguments, as one line for the model. */
  args: string;
  /** Throws nothing: validates the raw arguments itself and returns an error result for a bad one. */
  run(ctx: ToolContext, raw: unknown): Promise<ToolRun>;
}
