/**
 * AES-256-GCM encryption for secrets stored in the database (the Gmail refresh
 * token in `gmail_connections.refresh_token_encrypted`). Server-only.
 *
 * Payload format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url without
 * padding. The IV is 12 random bytes per call and the auth tag is 16 bytes.
 * An optional `context` string (the user id) is bound as additional
 * authenticated data, so a payload copied to another user's row fails to
 * decrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

/** A key or payload is malformed, or decryption failed (wrong key, context or tampered data). */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

/**
 * Decodes a base64 (or base64url) key and checks it is exactly 32 bytes.
 * The error never includes the key itself.
 */
export function parseEncryptionKey(encoded: string | undefined): Buffer {
  const value = encoded?.trim() ?? "";
  if (!value) {
    throw new CryptoError(
      "Missing ENCRYPTION_KEY; generate one with " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!BASE64_RE.test(standard)) {
    throw new CryptoError("ENCRYPTION_KEY is not valid base64");
  }
  const key = Buffer.from(standard, "base64");
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(`ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

/** The key from `ENCRYPTION_KEY` (see .env.example). */
export function encryptionKey(): Buffer {
  return parseEncryptionKey(process.env.ENCRYPTION_KEY);
}

/** Encrypts `plaintext` with a fresh random IV. `context` must be given again to decrypt. */
export function encrypt(plaintext: string, key: Buffer, context = ""): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, toBase64Url(iv), toBase64Url(tag), toBase64Url(ciphertext)].join(".");
}

/** Decrypts a payload made by {@link encrypt} with the same key and context. */
export function decrypt(payload: string, key: Buffer, context = ""): string {
  assertKey(key);
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new CryptoError(`Unsupported encrypted payload (expected ${VERSION}.iv.tag.data)`);
  }
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const iv = fromBase64Url(ivPart);
  const tag = fromBase64Url(tagPart);
  const ciphertext = fromBase64Url(dataPart);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CryptoError("Malformed encrypted payload (bad IV or tag length)");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("Decryption failed (wrong key or context, or the data was modified)");
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function fromBase64Url(part: string): Buffer {
  if (!BASE64URL_RE.test(part)) {
    throw new CryptoError("Malformed encrypted payload (invalid base64url)");
  }
  return Buffer.from(part, "base64url");
}
