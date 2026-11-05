import { api, fail, requirePerm } from "@/lib/api/handler";
import { listRoles } from "@/lib/data/config";
import { IMPORT_LIMITS } from "@/lib/import/employees";
import { withFixes } from "@/lib/import/explain-generic";
import { explainFileError } from "@/lib/import/history-explain";
import { parseSignInSheet } from "@/lib/import/sign-ins";
import { checkSignIns } from "@/lib/import/sign-ins-server";
import { receiveUpload } from "@/lib/import/upload";

/** Sign-in import, step 1: reads the sheet as data and checks each person against the database. Nothing is saved. Every problem says which row and what to do. */
export const POST = api({}, async ({ actor, req }) => {
  requirePerm(actor, "users.manage");
  const parsed = await receiveUpload(req, IMPORT_LIMITS);
  const roles = (await listRoles()).map((r) => ({ code: r.code, name: r.name }));
  const result = parseSignInSheet(parsed.headers, parsed.rows, roles);
  if ("error" in result) throw fail("VALIDATION_ERROR", 422, result.error, explainFileError(result.error));
  const checked = await checkSignIns(result.rows, actor);
  const problems = [...result.problems, ...checked.problems].sort((a, b) => a.row - b.row);
  return { fileName: parsed.fileName, people: checked.ok, problems: withFixes(problems.slice(0, 200)), problemCount: problems.length };
});
