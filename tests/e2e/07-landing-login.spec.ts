import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

/** The public landing page and the redesigned sign-in screen: content, accessibility, phones, and that every sign-in behaviour is intact. */
const noSideScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("landing page", () => {
  test("is public, explains the product and leads to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Turn objectives into weekly work");
    await expect(page.getByRole("heading", { name: "How a week works" })).toBeVisible();
    await expect(page.getByText("At the content lock goals and tasks freeze; only outcomes can change.")).toBeVisible();   // the steps say what happens, and name no fixed day or time (lock times are a setting)
    await expectNoA11yViolations(page, "landing page");
    await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("fits a phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    expect(await noSideScroll(page)).toBe(true);
    await expectNoA11yViolations(page, "landing page on a phone");
  });

  test("sends a signed-in user to the dashboard", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("sign-in screen", () => {
  test("keeps the email and password fields password-manager friendly, with a working show/hide control", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
    const pw = page.getByLabel("Password");
    await expect(pw).toHaveAttribute("autocomplete", "current-password");
    await expect(pw).toHaveAttribute("type", "password");
    const toggle = page.getByRole("button", { name: "Show password" });
    await toggle.click();
    await expect(pw).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(pw).toHaveAttribute("type", "password");
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
  });

  test("reports a wrong password and an unknown address with the same words, without moving the form", async ({ page }) => {
    await page.goto("/login");
    const button = page.getByRole("button", { name: "Sign in" });
    const y = (await button.boundingBox())!.y;
    await page.getByLabel("Email").fill("lead.eng@4core.local");
    await page.getByLabel("Password").fill("wrong-password-1");
    await button.click();
    const alert = page.locator("main [role=alert]");
    await expect(alert).toHaveText("Invalid email or password.");
    expect((await button.boundingBox())!.y).toBe(y);                                   // the message has reserved room
    await page.getByLabel("Email").fill("nobody@4core.local");
    await button.click();
    await expect(alert).toHaveText("Invalid email or password.");
  });

  test("the authenticator step is still shown to elevated accounts and is accessible", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@4core.local");
    await page.getByLabel("Password").fill("DevPassword!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    await expect(page.getByLabel("Authenticator code")).toHaveAttribute("autocomplete", "one-time-code");
    await expectNoA11yViolations(page, "authenticator step");
  });

  test("the redesigned screen is accessible and fits a phone", async ({ page }) => {
    await page.goto("/login");
    await expectNoA11yViolations(page, "sign-in (desktop)");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    expect(await noSideScroll(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeInViewport();
    await expectNoA11yViolations(page, "sign-in (phone)");
  });
});
