import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

describe("shared rate limiter (ADR-071)", () => {
  it("counts attempts per key, trips after the maximum, and keeps keys apart", async () => {
    await withTx(async (c) => {
      const hit = (k: string, max = 3, secs = 60) => c.rpc<boolean>("rate_limit_hit", k, max, secs);
      expect([await hit("a"), await hit("a"), await hit("a")]).toEqual([false, false, false]);
      expect(await hit("a")).toBe(true);                                                  // the fourth attempt in the window is over the limit of three
      expect(await hit("b")).toBe(false);                                                 // another key is unaffected
      expect(await hit("a")).toBe(true);
    });
  });

  it("forgets attempts once they are older than the window", async () => {
    await withTx(async (c) => {
      for (let i = 0; i < 4; i++) await c.rpc("rate_limit_hit", "old", 3, 60);
      await c.q("update rate_limit_hits set at = clock_timestamp() - interval '2 minutes' where key = 'old'");
      expect(await c.rpc<boolean>("rate_limit_hit", "old", 3, 60)).toBe(false);          // the old attempts no longer count
      expect((await c.q<{ n: number }>("select count(*)::int n from rate_limit_hits where key = 'old'"))[0].n).toBe(1);
    });
  });

  it("rejects nonsense and cannot be called from a browser session", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("OP");
      const u = await c.user(["BU_LEAD"], bu, "lead");
      await c.expectError("VALIDATION_ERROR", () => c.rpc("rate_limit_hit", "", 3, 60));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("rate_limit_hit", "k", 0, 60));
      await c.client.query("savepoint s1");
      let denied = false;
      try { await c.asUser(u, () => c.rpc("rate_limit_hit", "k", 3, 60)); } catch { denied = true; await c.client.query("rollback to savepoint s1"); }
      expect(denied).toBe(true);
    });
  });
});

describe("scheduler heartbeat and health (ADR-071)", () => {
  it("every run of the scheduler leaves a heartbeat, and health shows how long ago", async () => {
    await withTx(async (c) => {
      await c.q("delete from job_heartbeats");
      expect((await c.rpc<{ scheduler_age_seconds: number | null }>("ops_health")).scheduler_age_seconds).toBeNull();
      await c.rpc("run_scheduled_jobs");
      await c.rpc("run_scheduled_jobs");
      const row = (await c.q<{ runs: string }>("select runs from job_heartbeats where job = 'scheduler'"))[0];
      expect(Number(row.runs)).toBe(2);
      const h = await c.rpc<{ scheduler_age_seconds: number; database: string; email_pending: number; job_failures_24h: number }>("ops_health");
      expect(h.database).toBe("ok");
      expect(h.scheduler_age_seconds).toBeLessThan(5);
      expect(h.job_failures_24h).toBe(0);
    });
  });

  it("health counts queued mail and failed job steps", async () => {
    await withTx(async (c) => {
      const before = await c.rpc<{ job_failures_24h: number }>("ops_health");
      await c.q("select write_audit(null, 'JOB_FAILED', 'job', 'x', null, null, null, null, 'FAILURE')");
      expect((await c.rpc<{ job_failures_24h: number }>("ops_health")).job_failures_24h).toBe(before.job_failures_24h + 1);
    });
  });

  it("notices a development clock left on the database, which would make every deadline wrong", async () => {
    await withTx(async (c) => {
      const has = async (settings: string[]) => (await c.q<{ p: boolean }>("select clock_override_in($1::text[]) as p", [settings]))[0].p;
      expect(await has([])).toBe(false);
      expect(await has(["search_path=public", "statement_timeout=3s"])).toBe(false);
      expect(await has(["app.dev_clock=2031-01-01T10:00:00+01:00"])).toBe(true);
      expect(await has(["app.test_now=2031-01-01"])).toBe(true);
      expect(await has(["app.environment=development"])).toBe(true);
      expect(await has(["app.environment=production"])).toBe(false);
      expect(await c.rpc<boolean>("clock_override_present")).toBe(false);                 // nothing is set on this database
    });
  });

  it("only the service role can read health or the heartbeat table", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("OP2");
      const u = await c.user(["ADMIN"], bu, "admin");
      await c.client.query("savepoint s2");
      let denied = false;
      try { await c.asUser(u, () => c.rpc("ops_health")); } catch { denied = true; await c.client.query("rollback to savepoint s2"); }
      expect(denied).toBe(true);
      await c.client.query("savepoint s3");
      let tableDenied = false;
      try { await c.asUser(u, async () => c.q("select * from job_heartbeats")); } catch { tableDenied = true; await c.client.query("rollback to savepoint s3"); }
      expect(tableDenied).toBe(true);                                                      // the table is not readable by people at all
    });
  });
});
