import { expect, test } from "@playwright/test";
import { forgetSession, loginAs, PASSWORD } from "./helpers";

test.describe("authentication journeys", () => {
  test("unauthenticated visitors are sent to the sign-in page", async ({ page }) => {
    await page.goto("/weekly");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("a wrong password gives one generic message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("lead.eng@4core.local");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("main [role=alert]")).toHaveText("Invalid email or password.");
    await page.getByLabel("Email").fill("nobody@4core.local");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("main [role=alert]")).toHaveText("Invalid email or password.");
  });

  test("an ordinary user signs in with a password and signs out", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await expect(page.getByRole("link", { name: "Weekly reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin overview" })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    forgetSession("lead.eng@4core.local");           // sign-out ends the session everywhere
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an elevated user must also enter the authenticator code", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@4core.local");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    // the half-signed-in session cannot open anything
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?mfa=1/);
    await page.getByLabel("Authenticator code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.locator("main [role=alert]")).toHaveText("That code is not valid.");
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test("the elevated user signs in with a correct code and reaches Administration", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.getByRole("link", { name: "Admin overview" }).click();
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  });

  test("forgot-password answers the same for any address", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody-at-all@4core.local");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists for that address");
  });

  test("an invalid reset link explains itself and offers a new one", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=garbage&type=recovery");
    await expect(page).toHaveURL(/forgot-password\?expired=1/);
    await expect(page.locator("main [role=alert]")).toContainText("invalid or has expired");
  });
});
