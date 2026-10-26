import { beforeAll, expect } from "vitest";
import { assertTestEnvironment } from "./guard";

// Every file under tests/db, tests/api and tests/concurrency passes the guard before its first test; unit tests under src/ are not affected.
let checked: Promise<void> | null = null;
beforeAll(async () => {
  const file = expect.getState().testPath ?? "";
  if (/[\\/]tests[\\/](db|api|concurrency)[\\/]/.test(file)) await (checked ??= assertTestEnvironment());
});
