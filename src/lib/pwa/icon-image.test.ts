// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  FAVICON_PATH,
  FAVICON_SIZES,
  ICON_FILES,
  LAUNCHER_BACKGROUND,
  PNG_SIGNATURE,
  SPLASH_FILES,
  buildIconFiles,
  crc32,
  encodeIco,
  encodePng,
  iconColorAt,
  renderIcon,
  renderSplash,
} from "./icon-image";

/** Minimal decoder for the PNGs encodePng writes (RGBA, filter 0). */
function decodePng(png: Buffer): { width: number; height: number; pixels: Buffer } {
  expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    expect(png.readUInt32BE(offset + 8 + length)).toBe(
      crc32(png.subarray(offset + 4, offset + 8 + length)),
    );
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    }
    if (type === "IDAT") idat.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

function alphaAt(pixels: Uint8Array, size: number, x: number, y: number): number {
  return pixels[(y * size + x) * 4 + 3];
}

const root = join(__dirname, "..", "..", "..");

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("encodePng", () => {
  it("round-trips the pixels", () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4]);
    const decoded = decodePng(encodePng(2, 2, pixels));
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect([...decoded.pixels]).toEqual([...pixels]);
  });

  it("rejects a buffer of the wrong size", () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow(/16 bytes/);
  });
});

describe("encodeIco", () => {
  it("writes a directory entry per image pointing at its PNG", () => {
    const a = encodePng(1, 1, new Uint8Array([1, 2, 3, 4]));
    const b = encodePng(1, 1, new Uint8Array([5, 6, 7, 8]));
    const ico = encodeIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(0); // 256 is written as 0
    expect(ico.readUInt16LE(6 + 6)).toBe(32);
    const firstOffset = ico.readUInt32LE(6 + 12);
    const secondOffset = ico.readUInt32LE(22 + 12);
    expect(firstOffset).toBe(38);
    expect(ico.subarray(firstOffset, firstOffset + a.length)).toEqual(a);
    expect(ico.subarray(secondOffset)).toEqual(b);
  });
});

describe("renderIcon", () => {
  it("leaves the corners of the 'any' icon transparent and fills the 'full' one", () => {
    const any = renderIcon(64, "any");
    const full = renderIcon(64, "full");
    for (const [x, y] of [
      [0, 0],
      [63, 0],
      [0, 63],
      [63, 63],
    ]) {
      expect(alphaAt(any, 64, x, y)).toBe(0);
      expect(alphaAt(full, 64, x, y)).toBe(255);
    }
    expect(alphaAt(any, 64, 32, 2)).toBe(255);
  });

  it("is opaque everywhere in the 'full' shape (maskable and Apple icons)", () => {
    const full = renderIcon(48, "full");
    for (let i = 3; i < full.length; i += 4) expect(full[i]).toBe(255);
  });

  it("keeps the card inside the maskable safe zone (radius 0.4)", () => {
    const background = iconColorAt(0.01, 0.01, "full");
    for (let i = 0; i <= 200; i++) {
      for (let j = 0; j <= 200; j++) {
        const x = i / 200;
        const y = j / 200;
        if (Math.hypot(x - 0.5, y - 0.5) <= 0.4) continue;
        expect(iconColorAt(x, y, "full")).toEqual(background);
      }
    }
  });
});

describe("Android icons", () => {
  it("draws the round icon as a circle", () => {
    const round = renderIcon(64, "round");
    expect(alphaAt(round, 64, 0, 0)).toBe(0);
    expect(alphaAt(round, 64, 6, 6)).toBe(0);
    expect(alphaAt(round, 64, 32, 1)).toBe(255);
    expect(alphaAt(round, 64, 1, 32)).toBe(255);
  });

  it("keeps the adaptive foreground (only the card) inside the 66dp circle of 108dp", () => {
    let drawn = 0;
    for (let i = 0; i <= 200; i++) {
      for (let j = 0; j <= 200; j++) {
        const x = i / 200;
        const y = j / 200;
        const color = iconColorAt(x, y, "foreground");
        if (!color) continue;
        drawn++;
        expect(Math.hypot(x - 0.5, y - 0.5)).toBeLessThanOrEqual(33 / 108);
      }
    }
    expect(drawn).toBeGreaterThan(0);
    expect(iconColorAt(0.5, 0.15, "foreground")).toBeNull();
  });

  it("uses the accent blue behind the adaptive foreground", () => {
    const xml = readFileSync(
      join(root, "android/app/src/main/res/values/ic_launcher_background.xml"),
      "utf8",
    );
    expect(xml).toContain(`>${LAUNCHER_BACKGROUND}</color>`);
    expect(iconColorAt(0.01, 0.5, "full")).toEqual([
      parseInt(LAUNCHER_BACKGROUND.slice(1, 3), 16),
      parseInt(LAUNCHER_BACKGROUND.slice(3, 5), 16),
      parseInt(LAUNCHER_BACKGROUND.slice(5, 7), 16),
    ]);
  });

  it("covers every launcher density with the three icons", () => {
    const launcher = ICON_FILES.filter(({ path }) => path.startsWith("android/"));
    expect(launcher).toHaveLength(15);
    expect(launcher.filter(({ path }) => path.includes("mipmap-xxxhdpi"))).toEqual([
      expect.objectContaining({ size: 192, shape: "any" }),
      expect.objectContaining({ size: 192, shape: "round" }),
      expect.objectContaining({ size: 432, shape: "foreground" }),
    ]);
  });

  it("centers the icon on an opaque light splash", () => {
    const splash = renderSplash(90, 60);
    for (let i = 3; i < splash.length; i += 4) expect(splash[i]).toBe(255);
    expect([...splash.subarray(0, 3)]).toEqual([0xf7, 0xf7, 0xf5]);
    // The icon is 20 px wide, from x = 35 to 54 and y = 20 to 39.
    const center = (30 * 90 + 45) * 4;
    expect([...splash.subarray(center, center + 3)]).not.toEqual([0xf7, 0xf7, 0xf5]);
    const outside = (30 * 90 + 30) * 4;
    expect([...splash.subarray(outside, outside + 3)]).toEqual([0xf7, 0xf7, 0xf5]);
  });
});

describe("committed icon files", () => {
  const built = new Set(buildIconFiles().map(({ path }) => path));

  it.each(ICON_FILES.map((file) => [file.path, file] as const))(
    "%s matches the drawing (run `npm run icons` after changing it)",
    (path, { size, shape }) => {
      const decoded = decodePng(readFileSync(join(root, path)));
      expect(decoded.width).toBe(size);
      expect(decoded.height).toBe(size);
      expect(decoded.pixels.equals(Buffer.from(renderIcon(size, shape)))).toBe(true);
      expect(built.has(path)).toBe(true);
    },
  );

  it.each(SPLASH_FILES.map((file) => [file.path, file] as const))(
    "%s matches the drawing",
    (path, { width, height }) => {
      const decoded = decodePng(readFileSync(join(root, path)));
      expect([decoded.width, decoded.height]).toEqual([width, height]);
      expect(decoded.pixels.equals(Buffer.from(renderSplash(width, height)))).toBe(true);
      expect(built.has(path)).toBe(true);
    },
  );

  it("favicon.ico holds the 'any' icon at 16, 32 and 48 px", () => {
    const ico = readFileSync(join(root, FAVICON_PATH));
    expect(built.has(FAVICON_PATH)).toBe(true);
    expect(ico.readUInt16LE(4)).toBe(FAVICON_SIZES.length);
    FAVICON_SIZES.forEach((size, i) => {
      const entry = 6 + i * 16;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const decoded = decodePng(ico.subarray(offset, offset + length));
      expect(decoded.width).toBe(size);
      expect(decoded.pixels.equals(Buffer.from(renderIcon(size, "any")))).toBe(true);
    });
  });
});
