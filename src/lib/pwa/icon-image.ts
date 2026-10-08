/**
 * The app icon, drawn in code so it needs no image tools: a white bank card
 * on the accent blue. `npm run icons` (scripts/generate-icons.mjs) writes
 * the web icons, the favicon and the Android launcher icons and splash
 * screens; the tests check the committed files still match what this module
 * draws.
 *
 * No imports besides node:zlib, so Node can run it directly (type stripping).
 */
import { deflateSync } from "node:zlib";

type Rgb = readonly [number, number, number];

/** Same values as --accent / --accent-soft in src/app/globals.css (light theme). */
const ACCENT: Rgb = [0x2f, 0x5d, 0x8a];
const ACCENT_DARK: Rgb = [0x1f, 0x3f, 0x5f];
const ACCENT_SOFT: Rgb = [0xdb, 0xe6, 0xf0];
const WHITE: Rgb = [0xff, 0xff, 0xff];
/** --background of src/app/globals.css (light theme), behind the Android splash icon. */
const SPLASH_BACKGROUND: Rgb = [0xf7, 0xf7, 0xf5];

/** Android adaptive icon background (android/app/src/main/res/values/ic_launcher_background.xml). */
export const LAUNCHER_BACKGROUND = "#2F5D8A";

/**
 * `any`: rounded square with transparent corners (browser tabs, desktop).
 * `full`: opaque edge to edge, for maskable icons (the launcher crops them)
 * and the Apple touch icon (iOS rounds it itself).
 * `round`: a circle (Android launchers that ask for a round icon).
 * `foreground`: only the card, smaller and on a transparent background, as
 * the foreground layer of the Android adaptive icon (the background layer is
 * LAUNCHER_BACKGROUND).
 */
export type IconShape = "any" | "full" | "round" | "foreground";

export interface IconFile {
  /** Path from the repo root. */
  path: string;
  size: number;
  shape: IconShape;
}

/** PNG icons: the manifest's, Apple's and the Android launcher's. */
export const ICON_FILES: readonly IconFile[] = [
  { path: "public/icons/icon-192.png", size: 192, shape: "any" },
  { path: "public/icons/icon-512.png", size: 512, shape: "any" },
  { path: "public/icons/maskable-512.png", size: 512, shape: "full" },
  // Next.js file convention: served as /apple-icon.png with a <link> in <head>.
  { path: "src/app/apple-icon.png", size: 180, shape: "full" },
  ...androidLauncherIcons(),
];

function androidLauncherIcons(): IconFile[] {
  const densities = [
    ["mdpi", 1],
    ["hdpi", 1.5],
    ["xhdpi", 2],
    ["xxhdpi", 3],
    ["xxxhdpi", 4],
  ] as const;
  const res = "android/app/src/main/res";
  return densities.flatMap(([density, scale]) => [
    { path: `${res}/mipmap-${density}/ic_launcher.png`, size: 48 * scale, shape: "any" },
    { path: `${res}/mipmap-${density}/ic_launcher_round.png`, size: 48 * scale, shape: "round" },
    {
      path: `${res}/mipmap-${density}/ic_launcher_foreground.png`,
      size: 108 * scale,
      shape: "foreground",
    },
  ]);
}

export interface SplashFile {
  path: string;
  width: number;
  height: number;
}

/** Android launch screens (drawable `splash`, used by the launch theme), at the sizes of the Capacitor template. */
export const SPLASH_FILES: readonly SplashFile[] = [
  ["drawable", 480, 320],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
].map(([folder, width, height]) => ({
  path: `android/app/src/main/res/${folder}/splash.png`,
  width: width as number,
  height: height as number,
}));

/** Next.js file convention: /favicon.ico. */
export const FAVICON_PATH = "src/app/favicon.ico";
export const FAVICON_SIZES: readonly number[] = [16, 32, 48];

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
}

function inRoundedRect(x: number, y: number, { x0, y0, x1, y1, r }: Rect): boolean {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

// Coordinates are fractions of the icon size. The card's corners stay inside
// the maskable safe zone (a circle of radius 0.4 around the center).
const BACKGROUND: Rect = { x0: 0, y0: 0, x1: 1, y1: 1, r: 0.22 };
const CARD: Rect = { x0: 0.22, y0: 0.31, x1: 0.78, y1: 0.69, r: 0.05 };
const STRIPE: Rect = { x0: 0.22, y0: 0.38, x1: 0.78, y1: 0.45, r: 0 };
const LINE_LONG: Rect = { x0: 0.29, y0: 0.55, x1: 0.53, y1: 0.59, r: 0.02 };
const LINE_SHORT: Rect = { x0: 0.59, y0: 0.55, x1: 0.71, y1: 0.59, r: 0.02 };
/**
 * The adaptive icon foreground is 108dp, of which launchers show the middle
 * 72dp and keep a circle of 66dp always visible; at this scale the card's
 * corners stay inside that circle (radius 0.305).
 */
const FOREGROUND_SCALE = 0.75;

/** Color of one point of the icon, or null where it is transparent. */
export function iconColorAt(x: number, y: number, shape: IconShape): Rgb | null {
  if (shape === "any" && !inRoundedRect(x, y, BACKGROUND)) return null;
  if (shape === "round" && Math.hypot(x - 0.5, y - 0.5) > 0.5) return null;
  if (shape === "foreground") {
    x = 0.5 + (x - 0.5) / FOREGROUND_SCALE;
    y = 0.5 + (y - 0.5) / FOREGROUND_SCALE;
    if (!inRoundedRect(x, y, CARD)) return null;
  }
  if (inRoundedRect(x, y, CARD)) {
    if (inRoundedRect(x, y, STRIPE)) return ACCENT_DARK;
    if (inRoundedRect(x, y, LINE_LONG) || inRoundedRect(x, y, LINE_SHORT)) return ACCENT_SOFT;
    return WHITE;
  }
  return ACCENT;
}

const SAMPLES = 4;

/** RGBA pixels (row by row, 4 bytes each), antialiased with 4×4 samples per pixel. */
export function renderIcon(size: number, shape: IconShape): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const total = SAMPLES * SAMPLES;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = iconColorAt(
            (px + (sx + 0.5) / SAMPLES) / size,
            (py + (sy + 0.5) / SAMPLES) / size,
            shape,
          );
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          covered++;
        }
      }
      const i = (py * size + px) * 4;
      if (covered > 0) {
        pixels[i] = Math.round(r / covered);
        pixels[i + 1] = Math.round(g / covered);
        pixels[i + 2] = Math.round(b / covered);
        pixels[i + 3] = Math.round((covered / total) * 255);
      }
    }
  }
  return pixels;
}

/** Launch screen: the `any` icon centered on the light background, a third of the shorter side. */
export function renderSplash(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels.set(SPLASH_BACKGROUND, i);
    pixels[i + 3] = 255;
  }
  const size = Math.round(Math.min(width, height) / 3);
  const icon = renderIcon(size, "any");
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((top + y) * width + left + x) * 4;
      const alpha = icon[from + 3] / 255;
      for (let c = 0; c < 3; c++) {
        pixels[to + c] = Math.round(icon[from + c] * alpha + pixels[to + c] * (1 - alpha));
      }
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(typeAndData.length + 8);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
  return out;
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 8-bit RGBA PNG, no filtering (filter byte 0 on every row). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Expected ${width * height * 4} bytes of RGBA, got ${rgba.length}`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  // compression, filter and interlace methods stay 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** ICO file holding one PNG per size (supported by every current browser). */
export function encodeIco(images: readonly { size: number; png: Uint8Array }[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header[entry] = size >= 256 ? 0 : size; // width (0 means 256)
    header[entry + 1] = size >= 256 ? 0 : size; // height
    header[entry + 2] = 0; // palette colors
    header[entry + 3] = 0; // reserved
    header.writeUInt16LE(1, entry + 4); // color planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

/** Every image file (ICON_FILES, SPLASH_FILES and the favicon) with its contents. */
export function buildIconFiles(): { path: string; data: Buffer }[] {
  const files = ICON_FILES.map(({ path, size, shape }) => ({
    path,
    data: encodePng(size, size, renderIcon(size, shape)),
  }));
  const favicon = encodeIco(
    FAVICON_SIZES.map((size) => ({ size, png: encodePng(size, size, renderIcon(size, "any")) })),
  );
  const splashes = SPLASH_FILES.map(({ path, width, height }) => ({
    path,
    data: encodePng(width, height, renderSplash(width, height)),
  }));
  return [...files, ...splashes, { path: FAVICON_PATH, data: favicon }];
}
