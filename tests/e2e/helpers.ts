import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { DEV_MFA_FILE, totp } from "../../scripts/totp";
import { formatWeekLabel } from "../../src/lib/domain/week-label";

export const PASSWORD = "DevPassword!2026"; // local-only seed credential (scripts/dev-seed.ts)
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

type Cookie = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>[number];
const sessionCache = new Map<string, Cookie[]>();   // one real sign-in per account; the server limits sign-ins to 10 per minute per account

/** Signs in as the user. The first time per account goes through the real form (including the authenticator step); later calls reuse that session if it is still valid. */
export async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  const cached = sessionCache.get(email);
  if (cached) {
    await page.context().addCookies(cached);
    await page.goto("/dashboard");
    if (/\/dashboard/.test(page.url())) return;       // still signed in
    await page.context().clearCookies();
    sessionCache.delete(email);
  }
  await signInThroughForm(page, email);
  sessionCache.set(email, await page.context().cookies());
}

/** Forgets a cached session (use after a test that signs the account out everywhere). */
export const forgetSession = (email: string) => sessionCache.delete(email);

async function signInThroughForm(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const code = page.getByLabel("Authenticator code");
  await Promise.race([page.waitForURL(/\/dashboard/), code.waitFor()]);
  if (await code.isVisible().catch(() => false)) {
    if (!existsSync(DEV_MFA_FILE)) throw new Error(`${email} needs an authenticator code: run npm run dev:seed first`);
    const secret = (JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) as Record<string, string>)[email];
    // a code may already have been used by an earlier sign-in in the same 30 s window, so neighbouring windows are tried too
    for (const offset of [0, 30_000, -30_000, 60_000]) {
      await code.fill(totp(secret, Date.now() + offset));
      await page.getByRole("button", { name: "Verify" }).click();
      const ok = await page.waitForURL(/\/dashboard/, { timeout: 6_000 }).then(() => true, () => false);
      if (ok) return;
    }
    throw new Error(`could not complete the authenticator step for ${email}`);
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

/** WCAG 2.2 A/AA plus best-practice rules, the same set used for the manual audits. */
export async function expectNoA11yViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const summary = result.violations.map((v) => `${v.id} (${v.impact}) on ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `accessibility violations on ${label}`).toEqual([]);
}

/** Freezes the DATABASE clock (local development only; the same mechanism as `npm run dev:clock`). */
export function setClock(iso: string | "off") {
  execFileSync("npm", ["run", "dev:clock", "--", iso], { stdio: "pipe", shell: true });
}

/** Runs the scheduler once, as the platform cron would. */
export async function runJobs() {
  const res = await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/internal/jobs/run`, {
    method: "POST",
    headers: { "x-jobs-secret": process.env.JOBS_SECRET ?? "" },
  });
  expect(res.status).toBe(200);
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export interface WeekTimes { id: string; start: Date; contentLock: Date; finalLock: Date; number: number; year: number }

/** The n-th reporting week of the active quarter (0 = first). The seed activates the quarter containing today. */
export async function activeWeek(n: number): Promise<WeekTimes> {
  const rows = await query<{ id: string; week_start_at: Date; content_lock_at: Date; final_lock_at: Date; week_number: number; week_year: number }>(
    `select w.* from reporting_weeks w join quarters q on q.id = w.quarter_id where q.status = 'ACTIVE' order by w.week_start_at offset $1 limit 1`, [n]);
  if (!rows[0]) throw new Error("no active quarter: run npm run dev:seed");
  const r = rows[0];
  return { id: r.id, start: r.week_start_at, contentLock: r.content_lock_at, finalLock: r.final_lock_at, number: r.week_number, year: r.week_year };
}

export const at = (d: Date, plusMinutes: number) => new Date(d.getTime() + plusMinutes * 60_000).toISOString();

/** The standard on-screen label for a week, e.g. "Week 14, 30 Mar – 5 Apr 2026" (same formatter the app uses). */
export const weekLabel = (w: WeekTimes) => formatWeekLabel({ week_number: w.number, week_start_at: w.start });

/** If the app asks for a fresh authenticator code (a high-risk action after 15 minutes), answers it as the given account would. */
export async function answerStepUpIfAsked(page: Page, email: string) {
  const dialog = page.getByRole("dialog", { name: "Confirm with your authenticator" });
  const asked = await dialog.waitFor({ state: "visible", timeout: 2_500 }).then(() => true, () => false);
  if (!asked) return;
  const secret = (JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) as Record<string, string>)[email];
  for (const offset of [0, 30_000, -30_000, 60_000]) {
    await dialog.getByRole("textbox").fill(totp(secret, Date.now() + offset));
    await dialog.getByRole("button", { name: /confirm|verify/i }).click();
    if (await dialog.waitFor({ state: "hidden", timeout: 4_000 }).then(() => true, () => false)) return;
  }
  throw new Error("could not answer the step-up prompt");
}
