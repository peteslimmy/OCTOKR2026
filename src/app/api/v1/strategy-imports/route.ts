import { api, fail, requirePerm } from "@/lib/api/handler";
import { IMPORT_LIMITS } from "@/lib/import/employees";
import { explainFileError, interpretTechnicalError } from "@/lib/import/history-explain";
import { withFixes } from "@/lib/import/explain-generic";
import { parseStrategyRows } from "@/lib/import/strategy";
import { receiveUpload } from "@/lib/import/upload";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Strategy import, step 1 (ADR-079): reads the sheet as data, checks the layout here and the quarter rules in the database, and returns every problem
 * with its spreadsheet row and what to do about it, plus the rows themselves. Nothing is saved.
 */
export const POST = api({}, async ({ actor, req }) => {
  requirePerm(actor, "strategy.import");
  const parsed = await receiveUpload(req, IMPORT_LIMITS);
  const result = parseStrategyRows(parsed.headers, parsed.rows);
  if ("error" in result) throw fail("VALIDATION_ERROR", 422, result.error, explainFileError(result.error));
  let issues: { row: number; message: string }[] = result.problems;
  if (!issues.length) {
    const { data, error } = await adminClient().rpc("strategy_import_issues", { p_rows: result.rows });
    if (error) { const x = interpretTechnicalError(error.message); throw fail("IMPORT_FAILED", 422, `Checking the sheet against the quarters failed: ${x.problem}`, { problem: x.problem, fix: x.fix, technical: error.message.slice(0, 300) }); }
    issues = (data as StrategyIssue[]).map((i) => ({ row: i.row, message: i.message }));
  }
  const quarters = [...new Set(result.rows.map((r) => `${r.year} Q${r.quarter}`))];
  const shown = withFixes(issues.slice(0, 200));
  return { fileName: parsed.fileName, sha256: parsed.sha256, rows: result.rows, quarters, issues: shown, issueCount: issues.length };
});
interface StrategyIssue { row: number; message: string }
