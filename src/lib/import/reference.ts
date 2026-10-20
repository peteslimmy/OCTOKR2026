import "server-only";
import { z } from "zod";
import { fail } from "@/lib/api/handler";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";
import { validateBusinessUnitRows, type BuReference } from "./business-units";
import { ENTITIES, isEntityId, type EntityId } from "./entities";
import { IMPORT_LIMITS, validateRows, type Policy, type Reference, type RowResult, type ValidationSummary } from "./employees";

export const policySchema = z.enum(["ABORT_ON_CONFLICT", "SKIP_EXISTING", "UPDATE_EXISTING"]);

/** The server side of each import: who may run it, which database function commits it, and how rows are checked against live data. */
interface ServerEntity {
  permission: string;
  rpc: string;
  validate: (rows: Record<string, string>[], policy: Policy) => Promise<{ results: RowResult[]; summary: ValidationSummary }>;
}

async function employeeReference(): Promise<Reference> {
  const sb = await userClient();
  const bus = await sb.from("business_units").select("id, code, name, status");
  if (bus.error) throw dbError(bus.error, "import reference: business units");
  const employees: Reference["employees"] = [];
  for (let from = 0; from < 50_000; from += 1000) {   // paged past the 1000-row API default
    const page = await sb.from("employees").select("email, first_name, last_name, business_unit_id, employment_status").order("email").range(from, from + 999);
    if (page.error) throw dbError(page.error, "import reference: employees");
    for (const e of page.data) employees.push({ email: String(e.email), firstName: e.first_name, lastName: e.last_name, businessUnitId: e.business_unit_id, status: e.employment_status });
    if (page.data.length < 1000) break;
  }
  return { businessUnits: bus.data, employees };
}

async function buReference(): Promise<BuReference> {
  const sb = await userClient();
  const { data, error } = await sb.from("business_units").select("code, name, status, reports_weekly");
  if (error) throw dbError(error, "import reference: business units");
  return { businessUnits: data.map((b) => ({ code: b.code, name: b.name, status: b.status, reportsWeekly: !!b.reports_weekly })) };
}

const SERVER: Record<EntityId, ServerEntity> = {
  employees: { permission: "users.manage", rpc: "commit_employee_import", validate: async (rows, policy) => validateRows(rows as never, policy, await employeeReference()) },
  "business-units": { permission: "business_units.manage", rpc: "commit_business_unit_import", validate: async (rows, policy) => validateBusinessUnitRows(rows, policy, await buReference()) },
};

/** Looks the entity up from the URL. Anything that is not a known import is a 404, never a guess. */
export function entityFor(param: string | undefined) {
  if (!param || !isEntityId(param)) throw fail("NOT_FOUND", 404, "That import does not exist.");
  return { id: param, ui: ENTITIES[param], ...SERVER[param] };
}

/** A strict list of rows: only this import's own fields, text only, bounded. Unknown fields are refused (no mass assignment). */
export function rowsSchemaFor(id: EntityId) {
  const shape = Object.fromEntries(ENTITIES[id].fields.map((f) => [f.key, z.string().max(IMPORT_LIMITS.maxCellChars)]));
  return z.array(z.object(shape).strict()).min(1).max(IMPORT_LIMITS.maxRows);
}

/** Reads and checks a JSON body against a schema, with the same error shape as the rest of the API. */
export async function readBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw fail("VALIDATION_ERROR", 422, "The request body must be valid JSON."); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fail("VALIDATION_ERROR", 422, "Some of the information provided is not valid.", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  return parsed.data;
}
