// Password policy (ADR-052). Length over composition (NIST 800-63B), plus a few cheap checks that stop the worst choices.
// The auth server enforces the same minimum length and character classes; this gives precise, early feedback and a stable error list.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON = new Set([
  "password1234", "password12345", "123456789012", "qwertyuiop12", "letmein12345", "welcome12345", "admin1234567", "iloveyou1234",
  "changeme1234", "passw0rd1234", "p@ssw0rd1234", "abcdefgh1234", "1q2w3e4r5t6y",
]);

export type PasswordIssue = "TOO_SHORT" | "TOO_LONG" | "NEEDS_LOWER" | "NEEDS_UPPER" | "NEEDS_DIGIT" | "COMMON" | "CONTAINS_EMAIL" | "REPEATED";

export function checkPassword(password: string, email?: string | null): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) issues.push("TOO_SHORT");
  if (password.length > MAX_PASSWORD_LENGTH) issues.push("TOO_LONG");
  if (!/[a-z]/.test(password)) issues.push("NEEDS_LOWER");
  if (!/[A-Z]/.test(password)) issues.push("NEEDS_UPPER");
  if (!/[0-9]/.test(password)) issues.push("NEEDS_DIGIT");
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) issues.push("COMMON");
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) issues.push("CONTAINS_EMAIL");
  if (password.length >= MIN_PASSWORD_LENGTH && new Set(password).size <= 3) issues.push("REPEATED");
  return issues;
}

const TEXT: Record<PasswordIssue, string> = {
  TOO_SHORT: `use at least ${MIN_PASSWORD_LENGTH} characters`,
  TOO_LONG: `use at most ${MAX_PASSWORD_LENGTH} characters`,
  NEEDS_LOWER: "include a lowercase letter",
  NEEDS_UPPER: "include an uppercase letter",
  NEEDS_DIGIT: "include a digit",
  COMMON: "avoid a commonly used password",
  CONTAINS_EMAIL: "do not include your email name",
  REPEATED: "avoid repeating the same few characters",
};
export const describeIssues = (issues: PasswordIssue[]) => issues.map((i) => TEXT[i]);
