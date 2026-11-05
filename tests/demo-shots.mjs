import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto("http://localhost:3100/login");
await page.getByLabel("Email").fill("presenter@4core.local");
await page.getByLabel("Password").fill("DevPassword!2026");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(/dashboard/, { timeout: 60000 });
await page.goto("http://localhost:3100/session-notes");
await page.getByRole("link", { name: "Engineering weekly OKR review" }).first().waitFor({ timeout: 90000 });
await page.screenshot({ path: `${out}/1-library.png` });
await page.getByRole("link", { name: "Engineering weekly OKR review" }).first().click();
await page.getByRole("heading", { level: 1, name: "Engineering weekly OKR review" }).waitFor({ timeout: 90000 });
await page.getByTestId("note-card").first().waitFor();
await page.screenshot({ path: `${out}/2-workspace-notes.png`, fullPage: true });
await page.getByTestId("note-card").first().getByRole("button", { name: "Edit" }).click();
await page.getByTestId("visual-editor").waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-visual-editor.png` });
await page.getByRole("button", { name: "Done" }).click();
for (const [tab, file] of [["Decisions", "4-decisions"], ["Action items", "5-actions"], ["Risks & blockers", "6-risks"]]) {
  await page.getByRole("tab", { name: new RegExp(tab) }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });
}
await page.getByRole("tab", { name: /Minutes/ }).click();
await page.getByRole("button", { name: "Prepare the minutes" }).click();
await page.getByTestId("working-minutes").waitFor({ timeout: 60000 });
await page.screenshot({ path: `${out}/7-minutes.png`, fullPage: true });
await page.goto("http://localhost:3100/session-notes/registers?tab=actions");
await page.getByTestId("action-card").first().waitFor({ timeout: 60000 });
await page.screenshot({ path: `${out}/8-registers.png` });
await browser.close();
console.log("done");
