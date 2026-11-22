import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const out = resolve(here, "../dist/renderer");
const head = readFileSync(join(out, "index.html"), "utf8");
for (const path of ["/icons/favicon-32.png", "/icons/apple-touch-icon.png", "/icons/manifest.json"]) {
  if (!head.includes(path)) throw new Error("Missing icon link: " + path);
}
const manifest = JSON.parse(readFileSync(join(out, "icons/manifest.json"), "utf8"));
if (manifest.short_name !== "TCode" || manifest.display !== "standalone" ||
    manifest.theme_color !== "#ffffff" || manifest.icons.length !== 2) {
  throw new Error("Invalid TCode web app manifest");
}
for (const [filename, size] of [
  ["tcode-512.png", 512],
  ["tcode-192.png", 192],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
  ["favicon-48.png", 48],
]) {
  const path = join(out, "icons", filename);
  if (!existsSync(path)) throw new Error("Icon missing: " + filename);
  const file = readFileSync(path);
  if (file.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      file.readUInt32BE(16) !== size || file.readUInt32BE(20) !== size) {
    throw new Error("Wrong PNG size: " + filename);
  }
  if (size === 512 && createHash("sha256").update(file).digest("hex") !==
      "2e91ae98213b5d86ef37ca2ec983205c962ed8ace5b24f65eaea328648aeaa64") {
    throw new Error("Approved icon content changed");
  }
  console.log("PASS", filename, size);
}
console.log("PASS headless HTML and manifest");
