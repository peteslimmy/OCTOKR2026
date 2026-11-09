import { describe, expect, it } from "vitest";
import { toDomainError } from "../errors";

describe("a validation error says why", () => {
  it("adds the reason the database attached, as a sentence", () => {
    const e = toDomainError({ message: "VALIDATION_ERROR", details: "public mail providers cannot be approved. As Super Admin you can add a person on any address without approving it" });
    expect(e.status).toBe(422);
    expect(e.message).toBe("Some of the information provided is not valid: Public mail providers cannot be approved. As Super Admin you can add a person on any address without approving it.");
  });
  it("keeps the generic message when there is no reason, or when the details are a list of fields", () => {
    expect(toDomainError({ message: "VALIDATION_ERROR" }).message).toBe("Some of the information provided is not valid.");
    expect(toDomainError({ message: "VALIDATION_ERROR", details: '[{"field":"x"}]' }).message).toBe("Some of the information provided is not valid.");
    expect(toDomainError({ message: "VALIDATION_ERROR", details: "x".repeat(300) }).message).toBe("Some of the information provided is not valid.");
  });
  it("does not add a reason to other errors", () => {
    expect(toDomainError({ message: "PERMISSION_DENIED", details: "secret detail" }).message).not.toContain("secret");
  });
});
