import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EMAIL_CODE_TTL_SECONDS, emailCodeMail, generateEmailCode, hashEmailCode, looksLikeEmailCode, normaliseEmailCode } from "../email-otp";

// hashEmailCode reads the server environment on first use; the values only need to be valid, not real.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key-00000000000000000000";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-000000000000";
process.env.MFA_EMAIL_PEPPER = "test-pepper-000000000000000000000000000000000000";
process.env.JOBS_SECRET = "test-jobs-secret-0000";

const USER = "5a1c2b3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const OTHER = "aaaa1111-2222-4333-8444-555566667777";

describe("emailed one-time codes", () => {
  it("are six digits, including leading zeros", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateEmailCode();
      expect(code).toMatch(/^\d{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(1000);   // random, not a counter
  });

  it("read what a person types, but reject anything that cannot be a code", () => {
    expect(normaliseEmailCode(" 123 456 ")).toBe("123456");
    expect(normaliseEmailCode("123-456")).toBe("123456");
    expect(looksLikeEmailCode(" 123 456 ")).toBe(true);
    expect(looksLikeEmailCode("123-456")).toBe(true);
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a", "'; drop table users;--"]) {
      expect(looksLikeEmailCode(bad), bad).toBe(false);
    }
  });

  it("are stored only as a keyed hash, bound to the person and the purpose", () => {
    const hash = hashEmailCode(USER, "LOGIN", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashEmailCode(USER, "LOGIN", " 123 456 "));          // typing does not change the hash
    expect(hash).toBe(hashEmailCode(USER, "LOGIN", "123-456"));
    expect(hash).not.toContain("123456");
    expect(hash).not.toBe(hashEmailCode(OTHER, "LOGIN", "123456"));        // another person's code is a different hash
    expect(hash).not.toBe(hashEmailCode(USER, "STEP_UP", "123456"));       // a sign-in code cannot be replayed as a step-up
    expect(hash).not.toBe(hashEmailCode(USER, "ENROL", "123456"));
    expect(hash).not.toBe(hashEmailCode(USER, "LOGIN", "123457"));

    const pepper = process.env.MFA_EMAIL_PEPPER!;
    const expected = createHmac("sha256", pepper).update(`${USER}:LOGIN:123456`).digest("hex");
    expect(hash).toBe(expected);
  });

  it("say what the code is for, when it stops working, and what to do if it was not expected", () => {
    const login = emailCodeMail("LOGIN", "012345");
    expect(login.subject).toBe("Your 4CORE-OKR sign-in code");
    expect(login.text).toContain("finish signing in");
    expect(login.text).toContain("012345");
    expect(login.text).toContain(`expires in ${Math.round(EMAIL_CODE_TTL_SECONDS / 60)} minutes`);
    expect(login.text).toContain("change it now and tell your administrator");

    expect(emailCodeMail("STEP_UP", "012345").subject).toBe("Your 4CORE-OKR confirmation code");
    expect(emailCodeMail("STEP_UP", "012345").text).toContain("confirm this change");
    const enrol = emailCodeMail("ENROL", "012345");
    expect(enrol.subject).toBe("Your 4CORE-OKR email code");
    expect(enrol.text).toContain("turn on email codes");
    expect("to" in login).toBe(false);
  });
});
