// @vitest-environment node
/**
 * Guards from the security checklist (docs/security.md): no real secret is committed, the
 * env template holds placeholders only, and browser code never touches server-only secrets.
 * Scans the files git tracks, so it also covers docs, the Android project and fixtures.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Shapes of real credentials. Test fakes ("1//0test-refresh-token", "ya29.test-1") are too short. */
const SECRET_PATTERNS: Record<string, RegExp> = {
  "Google OAuth client secret": /GOCSPX-[A-Za-z0-9_-]{20,}/,
  "Google refresh token": /\b1\/\/0[A-Za-z0-9_-]{40,}/,
  "Google access token": /\bya29\.[A-Za-z0-9_-]{40,}/,
  "Supabase secret key": /\bsb_secret_[A-Za-z0-9_-]{20,}/,
  "JWT (Supabase anon or service_role key)":
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/,
  "Private key": /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/,
};

const BINARY = /\.(?:png|ico|jpg|jpeg|gif|webp|jar|woff2?|ttf|otf|zip)$/i;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function findSecrets(text: string): string[] {
  return Object.entries(SECRET_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

/** Built at runtime so this file itself never contains a match. */
const fake = (prefix: string, length: number) => prefix + "a1B2_c3-D4".repeat(length / 10 + 1);

describe("secret patterns", () => {
  it("recognise real-looking credentials", () => {
    expect(findSecrets(fake("GOCSPX-", 28))).toEqual(["Google OAuth client secret"]);
    expect(findSecrets(`token=${fake("1//0", 100)}`)).toEqual(["Google refresh token"]);
    expect(findSecrets(fake("ya29.", 150))).toEqual(["Google access token"]);
    expect(findSecrets(fake("sb_secret_", 30))).toEqual(["Supabase secret key"]);
    expect(findSecrets([fake("eyJ", 20), fake("eyJ", 60), fake("", 40)].join("."))).toEqual([
      "JWT (Supabase anon or service_role key)",
    ]);
    expect(findSecrets(["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "))).toEqual(["Private key"]);
  });

  it("let the fake tokens used by the tests through", () => {
    expect(findSecrets('"1//0test-refresh-token" "ya29.test-1" sb_secret_… GOCSPX-x')).toEqual([]);
  });
});

describe("committed files", () => {
  const files = trackedFiles();

  it("hold no real secrets", () => {
    const found: string[] = [];
    for (const file of files) {
      if (BINARY.test(file)) continue;
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue; // Deleted in the working tree but still tracked.
      }
      if (text.includes("\0")) continue;
      for (const name of findSecrets(text)) found.push(`${file}: ${name}`);
    }
    expect(found).toEqual([]);
  });

  it("include no env files, keystores or certificates besides .env.example", () => {
    const forbidden = files.filter(
      (file) =>
        (/(^|\/)\.env(\..+)?$/.test(file) && file !== ".env.example") ||
        /\.(?:jks|keystore|pem|p12|pfx)$/i.test(file) ||
        /(^|\/)google-services\.json$/.test(file),
    );
    expect(forbidden).toEqual([]);
  });
});

describe(".env.example", () => {
  const SECRETS = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_CLIENT_SECRET",
    "ENCRYPTION_KEY",
    "CRON_SECRET",
  ];
  const values = new Map(
    readFileSync(join(ROOT, ".env.example"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2].trim()]),
  );

  it.each(SECRETS)("leaves %s empty or as a placeholder", (name) => {
    expect(values.has(name)).toBe(true);
    expect(values.get(name)).toMatch(/^(?:|your-[a-z-]+)$/);
  });
});

describe("browser code", () => {
  const SERVER_ONLY = [
    "@/lib/supabase/admin",
    "@/lib/crypto",
    "node:crypto",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_CLIENT_SECRET",
    "ENCRYPTION_KEY",
    "CRON_SECRET",
  ];
  const clientFiles = trackedFiles().filter((file) => {
    if (!/^src\/.*\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) return false;
    const text = readFileSync(join(ROOT, file), "utf8");
    return /^\s*["']use client["'];?/m.test(text.split("\n").slice(0, 5).join("\n"));
  });

  it("finds the client components", () => {
    expect(clientFiles).toContain("src/app/app/sync-button.tsx");
  });

  it("never imports or names a server-only secret", () => {
    const found = clientFiles.flatMap((file) => {
      const text = readFileSync(join(ROOT, file), "utf8");
      return SERVER_ONLY.filter((name) => text.includes(name)).map((name) => `${file}: ${name}`);
    });
    expect(found).toEqual([]);
  });
});
