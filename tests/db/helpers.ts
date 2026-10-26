import { Client } from "pg";
import { randomUUID } from "node:crypto";

export const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";

export type Role = "SUPER_ADMIN" | "ADMIN" | "BU_LEAD" | "PRESENTER" | "EXECUTIVE" | "DIRECTOR" | "HR" | "FINANCE";

export interface Ctx {
  client: Client;
  q<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  rpc<T = unknown>(fn: string, ...args: unknown[]): Promise<T>;
  setNow(iso: string): Promise<void>;
  expectError(code: string, fn: () => Promise<unknown>): Promise<void>;
  asUser<T>(userId: string, fn: () => Promise<T>, aal?: "aal1" | "aal2", claims?: Record<string, unknown>): Promise<T>;
  org: string;
  bu(code: string): Promise<string>;
  user(roles: Role[], buId: string, name?: string): Promise<string>;
}

/** Runs fn in a transaction that is always rolled back, so tests never leave data behind. */
export async function withTx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  await client.query("begin");
  try {
    const q = async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[];
    let org = (await q<{ id: string }>("select id from organisations limit 1"))[0]?.id;
    if (!org) org = (await q<{ id: string }>("insert into organisations (name, code) values ('4CORE Test', 'TEST') returning id"))[0].id;

    const ctx: Ctx = {
      client,
      q,
      org,
      async rpc<R>(name: string, ...args: unknown[]) {
        const ph = args.map((_, i) => `$${i + 1}`).join(", ");
        const rows = await q<Record<string, unknown>>(`select ${name}(${ph}) as r`, args.map((a) => {
          if (a === null || typeof a !== "object" || a instanceof Date) return a;
          // arrays of scalars are Postgres arrays (uuid[]); everything else is jsonb
          if (Array.isArray(a) && a.every((x) => typeof x === "string" || typeof x === "number")) return a;
          return JSON.stringify(a);
        }));
        return rows[0].r as R;
      },
      async setNow(iso) {
        await client.query("select set_config('app.test_now', $1, true)", [iso]);
      },
      async expectError(code, f) {
        await client.query("savepoint expect_err");
        try {
          await f();
        } catch (e) {
          await client.query("rollback to savepoint expect_err");
          const msg = (e as Error).message ?? "";
          if (!msg.startsWith(code)) throw new Error(`expected error ${code} but got: ${msg}`);
          return;
        }
        await client.query("rollback to savepoint expect_err");
        throw new Error(`expected error ${code} but call succeeded`);
      },
      async asUser(userId, f, aal = "aal2", claims = {}) {
        await client.query("savepoint as_user");
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aal, ...claims })]);
        try {
          return await f();
        } catch (e) {
          await client.query("rollback to savepoint as_user"); // also restores the previous role
          throw e;
        } finally {
          await client.query("reset role");
          await client.query("select set_config('request.jwt.claims', '', true)");
          await client.query("release savepoint as_user").catch(() => undefined);
        }
      },
      async bu(code) {
        return (await q<{ id: string }>("insert into business_units (organisation_id, code, name) values ($1, $2, $3) returning id", [org, code, `BU ${code}`]))[0].id;
      },
      async user(roles, buId, name = "user") {
        const id = randomUUID();
        const email = `${name}-${id.slice(0, 8)}@test.local`;
        await q("insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())", [id, email]);
        const emp = (await q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, $2, $3, 'Tester', $4) returning id", [org, email, name, buId]))[0].id;
        await q("insert into users (id, employee_id, email) values ($1, $2, $3)", [id, emp, email]);
        for (const r of roles) await q("insert into user_roles (user_id, role_id) select $1, id from roles where code = $2", [id, r]);
        return id;
      },
    };
    try {
      return await fn(ctx);
    } finally {
      await client.query("rollback");
    }
  } finally {
    await client.end();
  }
}

// ---- calendar fixture: Q1 2031 (Jan 1 is a Wednesday); first reporting Monday is 2031-01-06 ----
export const W1 = {
  monday: "2031-01-06",
  open: "2031-01-06T09:00:00+01:00",
  beforeContentLock: "2031-01-07T17:59:59+01:00",
  contentLock: "2031-01-07T18:00:00+01:00",
  afterContentLock: "2031-01-07T18:00:01+01:00",
  beforeFinal: "2031-01-14T10:59:59+01:00",
  finalLock: "2031-01-14T11:00:00+01:00",
};

export interface Strategy {
  quarterId: string;
  objectiveId: string;
  krIds: string[];
  subKrIds: string[];
}

/** Admin-built, activated Q1 2031 with 3 KRs, each with one Sub-KR, and its calendar weeks. */
export async function seedStrategy(c: Ctx, admin: string): Promise<Strategy> {
  await c.setNow("2030-12-01T09:00:00+01:00");
  await c.rpc("create_year_quarters", admin, 2031);
  const quarterId = (await c.q<{ id: string }>("select id from quarters where year = 2031 and quarter_number = 1"))[0].id;
  const objectiveId = await c.rpc<string>("create_objective", admin, quarterId, "Grow recurring revenue", null);
  const krIds: string[] = [];
  const subKrIds: string[] = [];
  for (const t of ["Pipeline", "Retention", "Delivery"]) {
    const kr = await c.rpc<string>("create_key_result", admin, objectiveId, `KR ${t}`, null);
    krIds.push(kr);
    subKrIds.push(await c.rpc<string>("create_sub_key_result", admin, kr, `Sub-KR ${t}`, null));
  }
  await c.rpc("activate_quarter", admin, quarterId);
  return { quarterId, objectiveId, krIds, subKrIds };
}

export const evalJson = {
  specific: 80, measurable: 70, achievable: 75, relevant: 80, timeBound: 60, overall: 73, warnings: [], suggestions: [], engineVersion: "smart-rules-1.0.0",
};

export async function weekId(c: Ctx, monday = W1.monday): Promise<string> {
  return (await c.q<{ id: string }>("select id from reporting_weeks where (week_start_at at time zone 'Africa/Lagos')::date = $1::date", [monday]))[0].id;
}

/** Opens report + lease and creates a goal with the given tasks. Returns ids. */
export async function draftGoal(
  c: Ctx, lead: string, wk: string, subKr: string | null, tasks: string[] = ["Task one"], title = "Publish 3 pricing sheets by Friday",
): Promise<{ reportId: string; goalId: string; version: number }> {
  const reportId = await c.rpc<string>("get_or_create_weekly_report", lead, wk);
  await c.rpc("acquire_edit_lease", lead, reportId, 300);
  const v = (await c.q<{ version: number }>("select version from weekly_reports where id = $1", [reportId]))[0].version;
  const res = await c.rpc<{ goal_id: string; version: number }>(
    "create_goal", lead, reportId, subKr ? "KR_ALIGNED" : "STRETCH", subKr, title, null, tasks.map((description) => ({ description })), evalJson, v,
  );
  return { reportId, goalId: res.goal_id, version: res.version };
}

/**
 * A holiday amendment on a CLOSED week takes two people (ADR-058): one requests, a different one approves, and approval applies it.
 * Returns what the amendment returned (amendment_id, impact, week_final_locked, ...) plus the request id.
 */
export async function amendClosed<T = Record<string, unknown>>(
  c: Ctx, requester: string, approver: string, week: string, direction: "DECLARE" | "REVERSE", reason: string, key: string,
): Promise<T & { request_id: string }> {
  const req = await c.rpc<{ request_id: string }>("request_holiday_amendment", requester, week, direction, reason, `${key}-request`);
  return c.rpc<T & { request_id: string }>("decide_holiday_amendment_request", approver, req.request_id, "APPROVE", null, `${key}-approve`);
}
