import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption of integration secrets (passwords, API keys, signing secrets), ADR-076.
 *
 * AES-256-GCM. The key is a 32-byte value in the server environment (INTEGRATIONS_ENCRYPTION_KEY, base64); the database only ever holds the result,
 * written `v1.<key id>.<iv>.<tag>.<data>` (base64url parts). The name of the field is bound into the ciphertext, so a secret copied from one field to another
 * does not decrypt. A previous key (INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS, comma-separated) still decrypts while secrets are re-encrypted under the new one
 * (`npm run integrations:rewrap`). Losing every key loses the secrets, never anything else: they are typed in again.
 */
export class KeyMissingError extends Error {
  constructor(message = "INTEGRATIONS_ENCRYPTION_KEY is not set, so secrets cannot be stored. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"") { super(message); }
}
export class DecryptError extends Error {}

export interface Keyring { primary: { id: string; key: Buffer }; all: Map<string, Buffer> }

const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);
function parseKey(b64: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new KeyMissingError("INTEGRATIONS_ENCRYPTION_KEY must be 32 random bytes encoded as base64.");
  return key;
}

/** The keys in use, from the environment. Throws KeyMissingError when there is no current key. */
export function keyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring {
  const current = env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!current) throw new KeyMissingError();
  const primary = parseKey(current);
  const all = new Map<string, Buffer>([[keyId(primary), primary]]);
  for (const p of (env.INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) { const k = parseKey(p); all.set(keyId(k), k); }
  return { primary: { id: keyId(primary), key: primary }, all };
}
export const encryptionConfigured = (env: Record<string, string | undefined> = process.env) => { try { keyringFromEnv(env); return true; } catch { return false; } };

const aad = (field: string) => Buffer.from(`okr-integration-secret:${field}`);
const b64 = (b: Buffer) => b.toString("base64url");

export function encryptSecret(plain: string, field: string, ring: Keyring = keyringFromEnv()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ring.primary.key, iv);
  c.setAAD(aad(field));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${ring.primary.id}.${b64(iv)}.${b64(c.getAuthTag())}.${b64(data)}`;
}

export function decryptSecret(token: string, field: string, ring: Keyring = keyringFromEnv()): string {
  const [v, kid, iv, tag, data] = token.split(".");
  if (v !== "v1" || !kid || !iv || !tag || !data) throw new DecryptError("not an encrypted secret");
  const key = ring.all.get(kid);
  if (!key) throw new DecryptError("the key that encrypted this secret is no longer configured; enter the secret again");
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAAD(aad(field));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch { throw new DecryptError("the secret could not be decrypted (wrong key or altered data); enter it again"); }
}

/** Is this secret encrypted under the current key? Used to decide what a key rotation still has to do. */
export const needsRewrap = (token: string, ring: Keyring = keyringFromEnv()) => token.split(".")[1] !== ring.primary.id;
