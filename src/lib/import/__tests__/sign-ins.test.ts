import { describe, expect, it } from "vitest";
import { parseSignInSheet } from "../sign-ins";

const roles = [{ code: "BU_LEAD", name: "BU Lead" }, { code: "PRESENTER", name: "Presenter" }, { code: "HR", name: "HR" }];

describe("sign-in sheet parser", () => {
  it("accepts role codes and names, several per person, in any case", () => {
    const r = parseSignInSheet(["E-mail address", "Roles"].map((x) => x.replace("E-mail address", "Email")), [["Ben@Fics.com", "bu lead; PRESENTER"], ["omoye@fics.com", "HR, BU_LEAD"]], roles);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([{ row: 2, email: "ben@fics.com", roles: ["BU_LEAD", "PRESENTER"] }, { row: 3, email: "omoye@fics.com", roles: ["HR", "BU_LEAD"] }]);
  });
  it("reports bad emails, duplicates, unknown and missing roles by row", () => {
    const r = parseSignInSheet(["Email", "Roles"], [["nope", "HR"], ["a@b.co", "Wizard"], ["a@b.co", "HR"], ["c@d.co", ""], ["ok@b.co", "HR"], ["ok@b.co", "HR"]], roles);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.map((p) => p.row)).toEqual([2, 3, 4, 5, 7]);
    expect(r.problems.find((p) => p.row === 3)?.message).toMatch(/not a role/);
    expect(r.rows.map((x) => x.row)).toEqual([6]);
  });
  it("names missing columns", () => {
    expect(parseSignInSheet(["Email"], [["a@b.co"]], roles)).toEqual({ error: expect.stringContaining("Roles column") });
  });
});
