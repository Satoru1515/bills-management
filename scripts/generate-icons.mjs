// Writes the app icons drawn by src/lib/pwa/icon-image.ts. Run with `npm run icons`
// after changing the drawing; the tests fail while the committed files are stale.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIconFiles } from "../src/lib/pwa/icon-image.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const { path, data } of buildIconFiles()) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  console.log(`${path} (${data.length} bytes)`);
}
