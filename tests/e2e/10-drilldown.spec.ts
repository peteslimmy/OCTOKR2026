import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

/** Executive ranking: filters narrow what is shown, a Business Unit opens a read-only week-by-week drawer, and it all works from the keyboard and on a phone. */
const rows = (page: import("@playwright/test").Page) => page.getByRole("table", { name: /ranked by quarterly execution score/ }).locator("tbody tr");

test.describe("ranking filters and drill-down", () => {
  test("filters narrow the list, say how many are shown, and reset", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    const all = await rows(page).count();
    expect(all).toBeGreaterThan(0);
    await page.getByLabel("Quarter score below").fill("5");               // the slider: anything under 5.0%
    await expect(page.getByText(/Business Units shown/)).toContainText(`of ${all}`);
    await expect(page.locator("output[for=rank-below]")).toHaveText("5.0%");
    expect(await rows(page).count()).toBeLessThanOrEqual(all);
    await page.getByLabel("Show").selectOption("MISSING");
    const missing = await rows(page).count();
    expect(missing).toBeLessThanOrEqual(all);
    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect(rows(page)).toHaveCount(all);
    await expect(page.locator("output[for=rank-below]")).toHaveText("any");
    await expectNoA11yViolations(page, "executive ranking filters");
  });

  test("a Business Unit opens a read-only week-by-week drawer that closes with Escape and returns focus", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    const opener = rows(page).first().getByRole("button");
    const name = (await opener.innerText()).split("\n")[0].trim();
    await opener.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: new RegExp(`${name}: week by week`) });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("table", { name: new RegExp(`Weekly register for ${name}`) })).toBeVisible();
    await expect(drawer.getByText("View only.")).toBeVisible();
    expect(await drawer.locator("button:not([aria-label='Close panel']):not(:has-text('Try again'))").count()).toBe(0);   // nothing inside can change a record
    await expectNoA11yViolations(page, "ranking drawer");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the drawer fills a phone and does not scroll the page sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, "exec@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    await rows(page).first().getByRole("button").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await drawer.getByRole("button", { name: "Close panel" }).click();
    await expect(drawer).toBeHidden();
  });

  test("a BU Lead cannot read another unit through the drawer's endpoint", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    const out = await page.evaluate(async () => {
      const q = await (await fetch("/api/v1/reports/reporting-register")).json();
      const sales = await (await fetch("/api/v1/business-units")).json();
      const other = (sales.data as { id: string; code: string }[]).find((b) => b.code !== "ENG" && b.code !== "HQ")?.id ?? "";
      const r = await fetch(`/api/v1/reports/reporting-register?buId=${other}`);
      const body = await r.json();
      return { own: (q.data.rows as { business_unit: string }[]).map((x) => x.business_unit), otherStatus: r.status, otherRows: (body.data?.rows ?? []).map((x: { business_unit: string }) => x.business_unit) };
    });
    expect(new Set(out.own).size).toBeLessThanOrEqual(1);
    expect(out.otherRows.filter((n: string) => !out.own.includes(n))).toEqual([]);
  });
});
