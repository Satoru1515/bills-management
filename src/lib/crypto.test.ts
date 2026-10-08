import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CryptoError, decrypt, encrypt, encryptionKey, parseEncryptionKey } from "./crypto";

// Test-only key (32 bytes of 0x01..0x20); never a real secret.
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const OTHER_KEY = Buffer.alloc(32, 7);
const TOKEN = "1//0test-refresh-token_abcDEF-123";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encrypt / decrypt", () => {
  it("round-trips a token", () => {
    const payload = encrypt(TOKEN, KEY);
    expect(decrypt(payload, KEY)).toBe(TOKEN);
  });

  it("round-trips unicode and empty strings", () => {
    expect(decrypt(encrypt("ñandú · €", KEY), KEY)).toBe("ñandú · €");
    expect(decrypt(encrypt("", KEY), KEY)).toBe("");
  });

  it("uses the v1.iv.tag.data format with base64url parts", () => {
    const payload = encrypt(TOKEN, KEY);
    const parts = payload.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    for (const part of parts.slice(1)) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(Buffer.from(parts[1]!, "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2]!, "base64url")).toHaveLength(16);
  });

  it("never contains the plaintext", () => {
    const payload = encrypt(TOKEN, KEY);
    expect(payload).not.toContain(TOKEN);
    expect(payload).not.toContain(Buffer.from(TOKEN).toString("base64url"));
  });

  it("uses a fresh IV each time", () => {
    const a = encrypt(TOKEN, KEY);
    const b = encrypt(TOKEN, KEY);
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("binds the context (user id)", () => {
    const payload = encrypt(TOKEN, KEY, "user-a");
    expect(decrypt(payload, KEY, "user-a")).toBe(TOKEN);
    expect(() => decrypt(payload, KEY, "user-b")).toThrow(CryptoError);
    expect(() => decrypt(payload, KEY)).toThrow(CryptoError);
  });

  it("fails with a different key", () => {
    const payload = encrypt(TOKEN, KEY);
    expect(() => decrypt(payload, OTHER_KEY)).toThrow(/Decryption failed/);
  });

  it("detects a modified ciphertext or tag", () => {
    const [version, iv, tag, data] = encrypt(TOKEN, KEY).split(".") as [
      string,
      string,
      string,
      string,
    ];
    const flip = (part: string) => {
      const bytes = Buffer.from(part, "base64url");
      bytes[0] = bytes[0]! ^ 0xff;
      return bytes.toString("base64url");
    };
    expect(() => decrypt([version, iv, tag, flip(data)].join("."), KEY)).toThrow(CryptoError);
    expect(() => decrypt([version, iv, flip(tag), data].join("."), KEY)).toThrow(CryptoError);
    expect(() => decrypt([version, flip(iv), tag, data].join("."), KEY)).toThrow(CryptoError);
  });

  it("rejects malformed payloads", () => {
    const [, iv, tag, data] = encrypt(TOKEN, KEY).split(".");
    expect(() => decrypt("", KEY)).toThrow(/Unsupported/);
    expect(() => decrypt(TOKEN, KEY)).toThrow(/Unsupported/);
    expect(() => decrypt(`v2.${iv}.${tag}.${data}`, KEY)).toThrow(/Unsupported/);
    expect(() => decrypt(`v1.${iv}.${tag}`, KEY)).toThrow(/Unsupported/);
    expect(() => decrypt(`v1.${iv}.${tag}.${data}.x`, KEY)).toThrow(/Unsupported/);
    expect(() => decrypt(`v1.${iv}.${tag}.da+ta`, KEY)).toThrow(/base64url/);
    expect(() => decrypt(`v1.AAAA.${tag}.${data}`, KEY)).toThrow(/IV or tag/);
    expect(() => decrypt(`v1.${iv}.AAAA.${data}`, KEY)).toThrow(/IV or tag/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encrypt(TOKEN, Buffer.alloc(16))).toThrow(/32 bytes/);
    expect(() => decrypt(encrypt(TOKEN, KEY), Buffer.alloc(31))).toThrow(/32 bytes/);
  });

  it("round-trips a long random token", () => {
    const token = randomBytes(600).toString("base64url");
    expect(decrypt(encrypt(token, KEY, "u"), KEY, "u")).toBe(token);
  });
});

describe("parseEncryptionKey", () => {
  it("decodes a base64 key of 32 bytes", () => {
    expect(parseEncryptionKey(KEY.toString("base64"))).toEqual(KEY);
  });

  it("accepts base64url and surrounding whitespace", () => {
    const key = Buffer.alloc(32, 0xfb); // encodes with "+" and "/" in standard base64
    expect(key.toString("base64")).toMatch(/[+/]/);
    expect(parseEncryptionKey(` ${key.toString("base64url")}\n`)).toEqual(key);
  });

  it("rejects a missing or blank key", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/Missing ENCRYPTION_KEY/);
    expect(() => parseEncryptionKey("   ")).toThrow(/Missing ENCRYPTION_KEY/);
  });

  it("rejects invalid base64", () => {
    expect(() => parseEncryptionKey("not a key!")).toThrow(/not valid base64/);
  });

  it("rejects keys of the wrong length without echoing them", () => {
    const short = Buffer.alloc(16, 9).toString("base64");
    expect(() => parseEncryptionKey(short)).toThrow(
      "ENCRYPTION_KEY must decode to 32 bytes, got 16",
    );
    try {
      parseEncryptionKey(short);
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });
});

describe("encryptionKey", () => {
  it("reads ENCRYPTION_KEY", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY.toString("base64"));
    expect(encryptionKey()).toEqual(KEY);
  });

  it("names the variable when it is missing", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => encryptionKey()).toThrow(/ENCRYPTION_KEY/);
  });
});
