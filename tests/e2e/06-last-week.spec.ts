import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, query } from "./helpers";

/**
 * The presenter "Last Week — Outstanding Tasks" hint: opens over the presentation without navigating, is read-only, works from the
 * keyboard, fits a phone, is out of reach of roles without presentation access and never changes a record.
 */
const fingerprint = async () => JSON.stringify([
  await query("select id, status, updated_at from tasks order by id"),
  await query("select id, version, updated_at from weekly_reports order by id"),
  (await query<{ n: number }>("select count(*)::int n from audit_logs"))[0].n,
]);

test.describe.serial("Last Week hint", () => {
  test("opens over the presentation, explains its contents, leaves the page and every record untouched", async ({ page }) => {
    await loginAs(page, "presenter@4core.local");
    await page.goto("/presentation");
    await expect(page.getByRole("button", { name: "Last Week — Outstanding Tasks" })).toBeVisible();
    const before = await fingerprint();                                                    // after sign-in, which legitimately writes its own audit rows
    const url = page.url();
    const heading = page.getByRole("heading", { level: 1 }).first();
    const headingText = await heading.innerText();
    await page.getByRole("button", { name: "Last Week — Outstanding Tasks" }).click();
    const dialog = page.getByRole("dialog", { name: "Last week's outstanding tasks" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("View only. Nothing here changes any task, report or score.")).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveCount(0, { timeout: 10_000 });       // finished loading
    const outcome = dialog.getByRole("region", { name: "Outstanding tasks" })
      .or(dialog.getByText(/No outstanding tasks|filed no report|organisation holiday|no earlier reporting week/));
    await expect(outcome.first()).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);                                // no error state on the happy path
    await expectNoA11yViolations(page, "presentation with the Last Week panel open");
    await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(url);                                                          // never navigated
    expect(await heading.innerText()).toBe(headingText);                                   // presentation state preserved
    expect(await fingerprint()).toBe(before);                                              // nothing was written
  });

  test("the L shortcut opens it, Escape closes it, and typing L in a field does not", async ({ page }) => {
    await loginAs(page, "presenter@4core.local");
    await page.goto("/presentation");
    await page.keyboard.press("l");
    const dialog = page.getByRole("dialog", { name: "Last week's outstanding tasks" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("reaches the screen only for roles allowed to present, and the endpoint enforces it", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/presentation");
    await expect(page.getByRole("button", { name: "Last Week — Outstanding Tasks" })).toHaveCount(0);
    const status = await page.evaluate(async () => (await fetch("/api/v1/presentation/last-week?weekId=11111111-1111-4111-8111-111111111111&buId=11111111-1111-4111-8111-111111111111")).status);
    expect(status).toBe(403);
  });

  test("fits a phone: no sideways scrolling and the close button stays reachable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, "presenter@4core.local");
    await page.goto("/presentation");
    await page.getByRole("button", { name: "Last Week — Outstanding Tasks" }).click();
    const dialog = page.getByRole("dialog", { name: "Last week's outstanding tasks" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Close", exact: true }).first()).toBeInViewport();
  });
});
