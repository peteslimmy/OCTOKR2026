import { expect, test } from "@playwright/test";
import { totp } from "../../scripts/totp";
import { expectNoA11yViolations, forgetSession, loginAs, PASSWORD, query } from "./helpers";

/**
 * Losing a phone, as a person experiences it: set up an authenticator, save the recovery codes, lose the device, sign in with a code,
 * and end up with no authenticator and no other sessions. Uses an ordinary role, for whom the authenticator is optional.
 */
const EMAIL = "presenter@4core.local";

test.describe.serial("recovery codes", () => {
  let codes: string[] = [];

  test("setting up an authenticator shows ten codes once and will not continue until they are saved", async ({ page }) => {
    await loginAs(page, EMAIL);
    await page.goto("/account/security");
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = (await page.locator("code").filter({ hasText: /^[A-Z2-7]{16,}$/ }).first().innerText()).trim();
    await page.getByLabel("Authenticator code").fill(totp(secret));
    await page.getByRole("button", { name: "Activate" }).click();

    const region = page.getByRole("region", { name: "Your recovery codes" });
    await expect(region).toBeVisible();
    codes = await region.getByRole("listitem").allInnerTexts();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const cont = region.getByRole("button", { name: "Continue" });
    await expect(cont).toBeDisabled();
    await expectNoA11yViolations(page, "recovery codes shown once");
    await region.getByLabel("I have saved these codes").check();
    await cont.click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/account/security");
    await expect(page.getByText("10 unused codes left.")).toBeVisible();
    expect(await query("select count(*)::int n from mfa_recovery_codes where code_hash = any($1)", [codes])).toEqual([{ n: 0 }]);   // the codes themselves are not stored
  });

  test("with the phone lost, a recovery code gets the person in, removes the authenticator and spends the code", async ({ page, context }) => {
    await context.clearCookies();
    forgetSession(EMAIL);
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    await page.getByRole("button", { name: "Lost your device? Use a recovery code" }).click();
    await expect(page.getByLabel("Recovery code")).toBeVisible();
    await expectNoA11yViolations(page, "sign-in: recovery code step");

    await page.getByLabel("Recovery code").fill("ZZZZ-ZZZZ-ZZZZ");
    await page.getByRole("button", { name: "Use recovery code" }).click();
    await expect(page.locator("main [role=alert]")).toHaveText("That recovery code is not valid.");

    const typed = codes[4].toLowerCase().replace(/-/g, " ");           // typed loosely: lower case, spaces for dashes
    await page.getByLabel("Recovery code").fill(typed);
    await page.getByRole("button", { name: "Use recovery code" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/account/security");
    await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeVisible();      // the old authenticator is gone
    const used = await query<{ used: number; open: number }>("select count(*) filter (where used_at is not null)::int used, count(*) filter (where used_at is null and revoked_at is null)::int open from mfa_recovery_codes m join users u on u.id = m.user_id where u.email = $1", [EMAIL]);
    expect(used[0]).toEqual({ used: 1, open: 0 });                                                  // one spent, the other nine cancelled with the authenticator
    const actions = await query<{ action: string }>("select a.action from audit_logs a join users u on u.id = a.actor_user_id where u.email = $1 and a.action like 'AUTH_%' order by a.seq", [EMAIL]);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["AUTH_MFA_ENROLLED", "AUTH_RECOVERY_CODES_ISSUED", "AUTH_RECOVERY_CODE_USED", "AUTH_MFA_RECOVERED"]));
  });

  test("the spent code and the cancelled codes no longer work, and the screen says one clear thing", async ({ page, context }) => {
    // an authenticator is required again for the code step to appear: set one up through the API-backed screen
    await loginAs(page, EMAIL);
    await page.goto("/account/security");
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = (await page.locator("code").filter({ hasText: /^[A-Z2-7]{16,}$/ }).first().innerText()).trim();
    await page.getByLabel("Authenticator code").fill(totp(secret));
    await page.getByRole("button", { name: "Activate" }).click();
    await page.getByRole("region", { name: "Your recovery codes" }).getByLabel("I have saved these codes").check();
    await page.getByRole("region", { name: "Your recovery codes" }).getByRole("button", { name: "Continue" }).click();

    await context.clearCookies();
    forgetSession(EMAIL);
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Lost your device? Use a recovery code" }).click();
    for (const old of [codes[4], codes[0]]) {                                                       // the spent one, and one from the cancelled first set
      await page.getByLabel("Recovery code").fill(old);
      await page.getByRole("button", { name: "Use recovery code" }).click();
      await expect(page.locator("main [role=alert]")).toHaveText("That recovery code is not valid.");
    }
    await page.getByRole("button", { name: "Back to your code" }).click();   // the screen's wording since emailed codes became a second factor
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    // leave the account as found: no authenticator
    const secretNow = secret;
    await page.getByLabel("Authenticator code").fill(totp(secretNow));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/account/security");
    await page.locator("#disable-code").fill(totp(secretNow, Date.now() + 30_000));
    await page.getByRole("button", { name: "Remove authenticator" }).click();
    await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeVisible();
  });
});
