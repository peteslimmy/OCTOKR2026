import { describe, expect, it } from "vitest";
import { checkPassword } from "../password-policy";

describe("password policy", () => {
  it("accepts a long mixed password", () => expect(checkPassword("Correct-Horse-Battery9", "ada@4core.local")).toEqual([]));
  it("requires length and character classes", () => {
    expect(checkPassword("Short1A")).toContain("TOO_SHORT");
    expect(checkPassword("alllowercase1234")).toContain("NEEDS_UPPER");
    expect(checkPassword("ALLUPPERCASE1234")).toContain("NEEDS_LOWER");
    expect(checkPassword("NoDigitsHereAtAll")).toContain("NEEDS_DIGIT");
  });
  it("rejects common, email-derived and repetitive passwords", () => {
    expect(checkPassword("Password12345")).toContain("COMMON");
    expect(checkPassword("xxAda.Lovelace1xx", "ada.lovelace@4core.local")).toContain("CONTAINS_EMAIL");
    expect(checkPassword("aaaaAAAA1111aaaa")).toContain("REPEATED");
  });
  it("caps length", () => expect(checkPassword("Aa1" + "x".repeat(130))).toContain("TOO_LONG"));
});
