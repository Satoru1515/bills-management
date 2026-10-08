// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { isProtectedPath } from "@/lib/auth/redirect";
import { ICON_FILES } from "./icon-image";
import { webAppManifest } from "./manifest";

const root = join(__dirname, "..", "..", "..");

describe("webAppManifest", () => {
  const m = webAppManifest();

  it("has what browsers need to offer installing the app", () => {
    expect(m.name).toBe("Bills Management");
    expect(m.short_name).toBe("Bills");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/app");
    expect(isProtectedPath(m.start_url!)).toBe(true);
    expect(m.scope).toBe("/");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/);
    const sizes = m.icons!.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(m.icons!.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("points every icon at a generated file of the declared size", () => {
    for (const icon of m.icons!) {
      const file = ICON_FILES.find(({ path }) => path === `public${icon.src}`);
      expect(file, icon.src).toBeDefined();
      expect(icon.sizes).toBe(`${file!.size}x${file!.size}`);
      expect(file!.shape).toBe(icon.purpose === "maskable" ? "full" : "any");
      // PNG width lives right after the signature and the IHDR length and type.
      const png = readFileSync(join(root, file!.path));
      expect(png.readUInt32BE(16)).toBe(file!.size);
    }
  });

  it("is what /manifest.webmanifest serves", () => {
    expect(manifest()).toEqual(m);
  });
});
