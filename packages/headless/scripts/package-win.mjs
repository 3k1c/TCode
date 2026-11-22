// Assemble a no-compile Windows bundle from dist/: node server.mjs + renderer + resources + start.cmd.
// On the Windows PC only Node 22 and Git for Windows are needed; `npm install` pulls prebuilt node-pty/esbuild binaries.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const out = join(root, "dist-win", "tcode-headless-win");
if (!existsSync(join(dist, "server.mjs")) || !existsSync(join(dist, "renderer", "index.html")))
	throw new Error("run `npm run build -w packages/desktop` and `npm run build -w packages/headless` first");

rmSync(join(root, "dist-win"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["server.mjs", "smoke.mjs"]) cpSync(join(dist, f), join(out, f));
cpSync(join(dist, "renderer"), join(out, "renderer"), { recursive: true });
cpSync(join(dist, "resources"), join(out, "resources"), { recursive: true });
cpSync(join(root, "docker/runtime-package.json"), join(out, "package.json"));
cpSync(join(root, "windows/start.cmd"), join(out, "start.cmd"));
cpSync(join(root, "windows/README-WINDOWS.md"), join(out, "README-WINDOWS.md"));
for (const f of ["update.ps1", "update.cmd"]) cpSync(join(root, "windows", f), join(out, f));
// Bake the fork's repo (set by CI) into the updater config so the shipped zip updates itself from the same place.
writeFileSync(join(out, "update.config.json"), `${JSON.stringify({ repo: process.env.GITHUB_REPOSITORY || "", token: "" }, null, 2)}\n`);
writeFileSync(join(out, "VERSION"), `${process.env.TCODE_RELEASE_VERSION || "dev"}\n`);
writeFileSync(join(out, ".npmrc"), "registry=https://registry.npmjs.org/\n");
console.log("windows bundle:", out);
