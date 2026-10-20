import { randomInt } from "node:crypto";

/** Crockford base32: no I, L, O or U, so a code read aloud or from paper is hard to mistake. 12 characters = 60 bits per code. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  });
}

/** What a person typed, as the canonical code: spaces and dashes ignored, case ignored, I/L read as 1 and O as 0 (as Crockford base32 defines). */
export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
}
export const looksLikeRecoveryCode = (input: string) => new RegExp(`^[${ALPHABET}]{12}$`).test(normaliseRecoveryCode(input));
