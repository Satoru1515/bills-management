// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capacitorConfig, resolveServerUrl } from "../../capacitor.config";

const root = join(__dirname, "..", "..");

describe("resolveServerUrl", () => {
  it("uses CAP_SERVER_URL, then NEXT_PUBLIC_APP_URL", () => {
    expect(
      resolveServerUrl({
        CAP_SERVER_URL: "https://bills.example.com",
        NEXT_PUBLIC_APP_URL: "https://other.example.com",
      }),
    ).toBe("https://bills.example.com");
    expect(resolveServerUrl({ NEXT_PUBLIC_APP_URL: "https://bills.example.com/" })).toBe(
      "https://bills.example.com",
    );
    expect(
      resolveServerUrl({ CAP_SERVER_URL: " ", NEXT_PUBLIC_APP_URL: "https://b.example" }),
    ).toBe("https://b.example");
  });

  it("is undefined when neither is set", () => {
    expect(resolveServerUrl({})).toBeUndefined();
    expect(resolveServerUrl({ CAP_SERVER_URL: "" })).toBeUndefined();
  });

  it("allows plain http only for local development hosts", () => {
    expect(resolveServerUrl({ CAP_SERVER_URL: "http://10.0.2.2:3000" })).toBe(
      "http://10.0.2.2:3000",
    );
    expect(resolveServerUrl({ CAP_SERVER_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
    expect(() => resolveServerUrl({ CAP_SERVER_URL: "http://bills.example.com" })).toThrow(/https/);
    expect(() => resolveServerUrl({ CAP_SERVER_URL: "http://192.168.1.20:3000" })).toThrow(/https/);
  });

  it("rejects malformed URLs, other schemes, credentials, queries and hashes", () => {
    expect(() => resolveServerUrl({ CAP_SERVER_URL: "bills.example.com" })).toThrow(/valid URL/);
    expect(() => resolveServerUrl({ CAP_SERVER_URL: "file:///sdcard/index.html" })).toThrow(
      /https/,
    );
    expect(() => resolveServerUrl({ CAP_SERVER_URL: "https://user:pw@bills.example.com" })).toThrow(
      /credentials/,
    );
    expect(() => resolveServerUrl({ CAP_SERVER_URL: "https://bills.example.com/?a=1" })).toThrow(
      /query/,
    );
    expect(() => resolveServerUrl({ CAP_SERVER_URL: "https://bills.example.com/#x" })).toThrow(
      /hash/,
    );
  });
});

describe("capacitorConfig", () => {
  it("loads the deployed app over https without cleartext", () => {
    const config = capacitorConfig("https://bills.example.com");
    expect(config.appId).toBe("com.satoru1515.bills");
    expect(config.appName).toBe("Bills");
    expect(config.server).toEqual({ url: "https://bills.example.com", cleartext: false });
    expect(config.android?.allowMixedContent).toBe(false);
  });

  it("enables cleartext only for an http development URL", () => {
    expect(capacitorConfig("http://10.0.2.2:3000").server?.cleartext).toBe(true);
  });

  it("falls back to the bundled page when no URL is set", () => {
    const config = capacitorConfig(undefined);
    expect(config.server).toBeUndefined();
    const page = join(root, config.webDir!, "index.html");
    expect(existsSync(page)).toBe(true);
    expect(readFileSync(page, "utf8")).toContain("CAP_SERVER_URL");
  });

  it("matches the generated Android project", () => {
    const gradle = readFileSync(join(root, "android", "app", "build.gradle"), "utf8");
    expect(gradle).toContain(`applicationId "${capacitorConfig(undefined).appId}"`);
    const strings = readFileSync(
      join(root, "android", "app", "src", "main", "res", "values", "strings.xml"),
      "utf8",
    );
    expect(strings).toContain(
      `<string name="app_name">${capacitorConfig(undefined).appName}</string>`,
    );
  });
});
