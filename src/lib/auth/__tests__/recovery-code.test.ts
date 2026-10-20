import { describe, expect, it } from "vitest";
import { RECOVERY_CODE_COUNT, generateRecoveryCodes, looksLikeRecoveryCode, normaliseRecoveryCode } from "../recovery-code";

describe("recovery codes", () => {
  it("issues ten distinct codes in the XXXX-XXXX-XXXX form without look-alike letters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) {
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(looksLikeRecoveryCode(c)).toBe(true);
    }
  });
  it("is random: two batches do not share codes", () => {
    const a = new Set(generateRecoveryCodes()); const b = generateRecoveryCodes();
    expect(b.some((c) => a.has(c))).toBe(false);
  });
  it("reads what a person typed: case, spaces and dashes do not matter, I and L mean 1, O means 0", () => {
    expect(normaliseRecoveryCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normaliseRecoveryCode(" ABCD EFGH JKMN ")).toBe("ABCDEFGHJKMN");
    expect(normaliseRecoveryCode("1l1l-ioio-0000")).toBe("111110100000");
    expect(looksLikeRecoveryCode("abcd efgh jkmn")).toBe(true);
  });
  it("rejects anything that cannot be a code, so guesses are not even looked up", () => {
    for (const bad of ["", "short", "ABCD-EFGH-JKM", "ABCD-EFGH-JKMNP", "ABCD-EFGH-JKM!", "ABCD-EFGH-JKMU", "123456", "'; drop table users;--"]) expect(looksLikeRecoveryCode(bad), bad).toBe(false);
  });
});
