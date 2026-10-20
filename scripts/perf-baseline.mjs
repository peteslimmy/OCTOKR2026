/**
 * PERFORMANCE BASELINE. Measures how long the most-used screens and reports take against a running production build, so a change that makes
 * them slower is noticed. It is a rehearsal on whatever machine runs it, not a promise about production: record the machine with the result.
 *
 *   npm run build && npm run start         (in one terminal, with a seeded database; `npm run dev:history -- 6` gives it realistic history)
 *   npm run perf:baseline                  (in another)
 *   npm run perf:baseline -- --requests 200 --concurrency 8
 *
 * Signs in as two ordinary seeded accounts (a BU Lead and an Executive: no authenticator needed), then times each target: sequentially first
 * (the latency one person sees), then with several requests at once (does it hold up under a busy minute). Exits non-zero if a target misses
 * its budget so it can gate a release.
 */
import os from "node:os";

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const REQUESTS = arg("requests", 60), CONCURRENCY = arg("concurrency", 6);
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PASSWORD = "DevPassword!2026";

// Budgets (milliseconds, 95th percentile, sequential). Proposed defaults, to be confirmed by the owner (docs/25-IMPLEMENTATION-NOTES.md).
const PAGE_BUDGET = 1500, API_BUDGET = 600;

async function signIn(email) {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  const res = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (res.status !== 200) throw new Error(`sign-in as ${email} returned ${res.status}`);
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { cookie: jar, ip };
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function time(session, path) {
  const t = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: session.cookie, "x-forwarded-for": session.ip }, redirect: "manual" });
  await res.arrayBuffer();
  return { ms: performance.now() - t, ok: res.status === 200 };
}

async function measure(label, session, path, budget) {
  await time(session, path);                                                // warm up: the first request compiles and fills caches
  const seq = [];
  let failures = 0;
  for (let i = 0; i < REQUESTS; i++) { const r = await time(session, path); seq.push(r.ms); if (!r.ok) failures++; }
  const started = performance.now();
  const conc = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < REQUESTS) { next++; const r = await time(session, path); conc.push(r.ms); if (!r.ok) failures++; }
  }));
  const wall = (performance.now() - started) / 1000;
  seq.sort((a, b) => a - b); conc.sort((a, b) => a - b);
  return { label, path, budget, p50: pct(seq, 50), p95: pct(seq, 95), p99: pct(seq, 99), cp95: pct(conc, 95), rps: conc.length / wall, failures };
}

const lead = await signIn("lead.eng@4core.local");
const exec = await signIn("exec@4core.local");
const targets = [
  ["BU Lead dashboard (page)", lead, "/dashboard", PAGE_BUDGET],
  ["Weekly reports list (page)", lead, "/weekly", PAGE_BUDGET],
  ["Executive dashboard (page)", exec, "/dashboard", PAGE_BUDGET],
  ["Reports overview (page)", exec, "/reports", PAGE_BUDGET],
  ["BU scorecard report (API)", exec, "/api/v1/reports/bu-scorecard", API_BUDGET],
  ["Performance trends report (API)", exec, "/api/v1/reports/performance-trends", API_BUDGET],
  ["Reporting register report (API)", exec, "/api/v1/reports/reporting-register", API_BUDGET],
  ["Insights (API)", exec, "/api/v1/reports/insights", API_BUDGET],
  ["Notifications (API)", lead, "/api/v1/notifications", API_BUDGET],
];
const rows = [];
for (const [label, s, path, budget] of targets) rows.push(await measure(label, s, path, budget));

const f = (n) => n.toFixed(0).padStart(6);
console.log(`\nMachine: ${os.cpus()[0]?.model.trim()} x${os.cpus().length}, ${(os.totalmem() / 1e9).toFixed(0)} GB, ${os.platform()}; ${REQUESTS} requests each, ${CONCURRENCY} at once; ${new Date().toISOString()}\n`);
console.log("Target".padEnd(36) + " p50 ms p95 ms p99 ms | at once p95 | req/s | budget p95 | result");
let failed = 0;
for (const r of rows) {
  const ok = r.p95 <= r.budget && r.failures === 0;
  if (!ok) failed++;
  console.log(`${r.label.padEnd(36)} ${f(r.p50)} ${f(r.p95)} ${f(r.p99)} | ${f(r.cp95).padStart(9)} | ${r.rps.toFixed(1).padStart(5)} | ${String(r.budget).padStart(10)} | ${ok ? "within budget" : r.failures ? `FAILED (${r.failures} bad responses)` : "OVER BUDGET"}`);
}
console.log(failed ? `\n${failed} of ${rows.length} targets missed their budget.` : `\nAll ${rows.length} targets are within budget.`);
process.exit(failed ? 1 : 0);
