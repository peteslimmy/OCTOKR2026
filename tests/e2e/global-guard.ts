import { assertTestEnvironment } from "../guard";

/** Playwright global setup: the browser suite resets and rewrites data, so it must only ever run against the test stack. */
export default async function globalSetup() {
  await assertTestEnvironment();
}
