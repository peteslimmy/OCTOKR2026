/**
 * HTTP-level tests for health, the scheduler heartbeat and secret rotation (ADR-071). Needs a built app started with
 * JOBS_SECRET_PREVIOUS=previous-secret-used-only-by-the-api-tests (the serial runner does this) and a seeded database.
 */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const SECRET = process.env.JOBS_SECRET!;
const PREVIOUS = "previous-secret-used-only-by-the-api-tests";
const get = (path: string, secret?: string) => fetch(`${BASE}${path}`, { headers: secret ? { "x-jobs-secret": secret } : {} });
const run = (secret?: string) => fetch(`${BASE}/api/internal/jobs/run`, { method: "POST", headers: secret ? { "x-jobs-secret": secret } : {} });

describe("health", () => {
  it("the public liveness check says only whether the application can serve, with no details", async () => {
    const r = await get("/api/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("the detailed check needs the shared secret, and shows a heartbeat once the scheduler has run", async () => {
    expect((await get("/api/internal/health")).status).toBe(401);
    expect((await get("/api/internal/health", "wrong-secret-value-1234")).status).toBe(401);
    expect((await run(SECRET)).status).toBe(200);
    const r = await get("/api/internal/health", SECRET);
    const body = await r.json();
    // the test server runs with internal addresses allowed (the integration tests need it), which health rightly calls critical in a production build; nothing else may be
    expect(body.alerts.filter((a: { severity: string }) => a.severity === "critical").map((a: { code: string }) => a.code)).toEqual(["PRIVATE_HOSTS_ALLOWED"]);
    expect(r.status).toBe(503);
    expect(body.figures.scheduler_age_seconds).toBeLessThan(60);
    expect(body.figures.clock_override_present).toBe(false);
    expect(body.alerts.map((a: { code: string }) => a.code)).not.toContain("SCHEDULER_SILENT");
    expect(JSON.stringify(body)).not.toMatch(/@|password|secret/i);                                             // figures, never people or credentials
  });
});

describe("scheduler secret rotation", () => {
  it("accepts the new and the previous secret, and nothing else", async () => {
    expect((await run(SECRET)).status).toBe(200);
    expect((await run(PREVIOUS)).status).toBe(200);
    expect((await run("previous-secret-used-only-by-the-api-tesx")).status).toBe(401);                          // one character off
    expect((await run()).status).toBe(401);
    expect([200, 503]).toContain((await get("/api/internal/health", PREVIOUS)).status);          // accepted (not 401); 503 only because of the test server's private-hosts setting
  });
});
