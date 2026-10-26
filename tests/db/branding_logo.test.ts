import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

describe("logo size is a Super Admin / Admin branding setting", () => {
  it("is stored, audited, optional and range-checked", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const hr = await c.user(["HR"], bu, "hr");
      const height = async () => (await c.q<{ logo_height: number }>("select logo_height from app_branding"))[0].logo_height;

      const before = await height();
      expect(before).toBe(32);                                                         // the default
      await c.rpc("set_branding", admin, "Acme OKR", "A", "#0f4c81", 48);
      expect(await height()).toBe(48);
      // the four-argument call (older callers) leaves the size alone
      await c.rpc("set_branding", admin, "Acme OKR", "A", "#0f4c81");
      expect(await height()).toBe(48);
      // out of range is refused and changes nothing
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_branding", admin, "Acme OKR", "A", "#0f4c81", 8));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_branding", admin, "Acme OKR", "A", "#0f4c81", 200));
      expect(await height()).toBe(48);
      // permission
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_branding", hr, "Acme OKR", "A", "#0f4c81", 20));
      // audited with before and after
      const audit = await c.q<{ old_values: { logoHeight: number }; new_values: { logoHeight: number } }>(
        "select old_values, new_values from audit_logs where action = 'BRANDING_CHANGED' order by seq asc limit 1");
      expect(audit[0].old_values.logoHeight).toBe(32);
      expect(audit[0].new_values.logoHeight).toBe(48);
    });
  });
});
