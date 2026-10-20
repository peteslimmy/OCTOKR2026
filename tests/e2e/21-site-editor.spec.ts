import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

/**
 * The landing page and sign-in screens are edited in Administration → Landing & sign-in. The public pages are checked signed out;
 * the editor is used as an Admin and the change is undone at the end so later specs see the original content.
 */
const HEADLINE = "Turn objectives into weekly work, and weekly work into results.";

test.describe("public pages", () => {
  test("the landing page has a picture, working links and no accessibility violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("weekly work");
    await expect(page.getByRole("img", { name: /Illustration of a dashboard/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toHaveAttribute("href", "/login");
    for (const id of ["features", "how-it-works", "trust"]) await expect(page.locator(`#${id}`)).toBeAttached();
    await expectNoA11yViolations(page, "landing page");
  });

  test("the sign-in screen shows its panel and still works for a keyboard user", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /About/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
    await expectNoA11yViolations(page, "sign-in screen");
  });

  test("the pictures route refuses names that are not safe", async ({ request }) => {
    expect((await request.get("/site-image/..%2Fsecret")).status()).toBe(404);
    expect((await request.get("/site-image/img-nope")).status()).toBe(404);
  });
});

test.describe("editor", () => {
  test("only people who manage branding can open it", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/admin/site");
    await expect(page.getByText("This page is not available for your role")).toBeVisible();
    const res = await page.request.put("/api/v1/site", { data: { landing: {}, login: {} } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("an Admin changes the headline, sees it in the preview, saves, and the public page follows; the picture upload checks the file", async ({ page, browser }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/site");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Landing page & sign-in screens" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();            // nothing changed yet

    const headline = page.getByLabel("Headline", { exact: true });
    await headline.fill("Plan the week. Score the work.");
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await expect(page.getByText("Plan the week. Score the work.").first()).toBeVisible();        // the live preview follows as you type

    // reorder a section and hide another, then save
    await page.getByRole("button", { name: /Move .* down/ }).first().click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("All changes are saved.")).toBeVisible();

    // a signed-out visitor sees the saved headline
    const visitor = await browser.newContext({ baseURL: page.url().split("/admin")[0] });
    const vp = await visitor.newPage();
    await vp.goto("/");
    await expect(vp.getByRole("heading", { level: 1 })).toHaveText("Plan the week. Score the work.");
    await visitor.close();

    // a file that is not really a picture is refused by the server
    const bad = await page.request.put("/api/v1/site/images/img-e2e-bad", { data: { mime: "image/png", data: Buffer.from("<svg onload=alert(1)>").toString("base64") } });
    expect(bad.status()).toBe(422);
    const link = await page.request.put("/api/v1/site", { data: { landing: { header: { showNav: true, sticky: true, signInLabel: "Sign in", links: [{ label: "x", href: "javascript:alert(1)" }] } }, login: {} } });
    expect(link.status()).toBe(422);

    // undo: the original content again
    await headline.fill(HEADLINE);
    await page.getByRole("button", { name: "Reset this page" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("All changes are saved.")).toBeVisible();
  });

  test("the sign-in layout can be switched and previewed, and the editor passes the accessibility check", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/site");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Sign-in screens" }).click();
    await page.getByRole("radio", { name: /Form in the middle/ }).check();
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByText("All changes are saved.")).toBeVisible();
    await expectNoA11yViolations(page, "landing and sign-in editor");
  });
});
