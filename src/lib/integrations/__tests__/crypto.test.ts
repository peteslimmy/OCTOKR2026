import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DecryptError, KeyMissingError, decryptSecret, encryptSecret, encryptionConfigured, keyringFromEnv, needsRewrap } from "../crypto";

const key = () => randomBytes(32).toString("base64");
const ring = (env: Record<string, string | undefined>) => keyringFromEnv(env);

describe("integration secret encryption", () => {
  it("round-trips, and the stored text has the shape the database accepts and reveals nothing", () => {
    const r = ring({ INTEGRATIONS_ENCRYPTION_KEY: key() });
    const token = encryptSecret("S3cret-pass word!", "password", r);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);      // the shape validate_integration_payload() demands
    expect(token).not.toContain("S3cret");
    expect(decryptSecret(token, "password", r)).toBe("S3cret-pass word!");
    expect(encryptSecret("S3cret-pass word!", "password", r)).not.toBe(token);                           // a fresh random value every time
  });

  it("refuses altered data, the wrong key, and a secret moved to another field", () => {
    const r = ring({ INTEGRATIONS_ENCRYPTION_KEY: key() });
    const token = encryptSecret("abc", "apiKey", r);
    const parts = token.split(".");
    const tampered = [...parts.slice(0, 4), Buffer.from("xyz").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered, "apiKey", r)).toThrow(DecryptError);
    expect(() => decryptSecret(token, "signingSecret", r)).toThrow(DecryptError);                         // bound to its field name
    expect(() => decryptSecret(token, "apiKey", ring({ INTEGRATIONS_ENCRYPTION_KEY: key() }))).toThrow(DecryptError);
    expect(() => decryptSecret("plain text", "apiKey", r)).toThrow(DecryptError);
  });

  it("a previous key still decrypts during a rotation, and says what still needs re-encrypting", () => {
    const oldKey = key(); const newKey = key();
    const old = encryptSecret("abc", "password", ring({ INTEGRATIONS_ENCRYPTION_KEY: oldKey }));
    const during = ring({ INTEGRATIONS_ENCRYPTION_KEY: newKey, INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS: oldKey });
    expect(decryptSecret(old, "password", during)).toBe("abc");
    expect(needsRewrap(old, during)).toBe(true);
    const fresh = encryptSecret(decryptSecret(old, "password", during), "password", during);
    expect(needsRewrap(fresh, during)).toBe(false);
    expect(decryptSecret(fresh, "password", ring({ INTEGRATIONS_ENCRYPTION_KEY: newKey }))).toBe("abc");    // the old key is no longer needed
    expect(() => decryptSecret(old, "password", ring({ INTEGRATIONS_ENCRYPTION_KEY: newKey }))).toThrow(/no longer configured/);
  });

  it("says plainly when there is no usable key", () => {
    expect(() => ring({})).toThrow(KeyMissingError);
    expect(() => ring({ INTEGRATIONS_ENCRYPTION_KEY: Buffer.from("too short").toString("base64") })).toThrow(/32 random bytes/);
    expect(encryptionConfigured({})).toBe(false);
    expect(encryptionConfigured({ INTEGRATIONS_ENCRYPTION_KEY: key() })).toBe(true);
  });
});
