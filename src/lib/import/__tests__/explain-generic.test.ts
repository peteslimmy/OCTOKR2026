import { describe, expect, it } from "vitest";
import { GENERAL_FIX, fixFor, withFixes } from "../explain-generic";

describe("what to do, for every bulk upload", () => {
  it.each([
    ["This is not a valid email address.", /name@company\.com/],
    ["This email already appears on row 4.", /listed twice/],
    ['"Boss" is not a role. Use a role code or name.', /Roles page/],
    ["No employee has this email. Add the person under Import employees first.", /Import employees first/],
    ["This person already has a sign-in.", /already sign in/],
    ['Quarter "9" must be 1 to 4 (or Q1 to Q4).', /1, 2, 3 or 4/],
    ["Goal title is empty.", /Fill in/],
    ["The goal starts with a formula character (= + @). Formulas are not accepted.", /values only/],
  ])("%s", (message, fix) => expect(fixFor(message)).toMatch(fix));
  it("never leaves a problem without an instruction", () => {
    expect(fixFor("Something nobody anticipated")).toBe(GENERAL_FIX);
    expect(withFixes([{ row: 2, message: "x" }])[0].fix).toBeTruthy();
  });
});
