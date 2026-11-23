/**
 * Must be the FIRST import of main.ts: desktop modules read `process.resourcesPath`
 * and `app.getPath()` at import time (pi-package-dir, web-bridge, ui-plugins).
 *
 * Layout created at runtime under $TCODE_DATA_DIR:
 *   resources/            -> process.resourcesPath
 *     ui-plugins, skills  -> symlinks to the read-only bundle shipped next to server.mjs
 *     bridge-hosts.json   -> extra Host/Origin names allowed by the web bridge
 *                            (from TCODE_BRIDGE_HOSTS, e.g. "pi2.kovami.app")
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bundleDir = dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = process.env.TCODE_APP_ROOT ? resolve(process.env.TCODE_APP_ROOT) : bundleDir;
export const DATA_DIR = resolve(process.env.TCODE_DATA_DIR || join(homedir(), ".tcode-headless"));
export const RESOURCES_DIR = join(DATA_DIR, "resources");

process.env.TCODE_HEADLESS = "1";
process.env.TCODE_APP_ROOT = APP_ROOT;
process.env.TCODE_DATA_DIR = DATA_DIR;

mkdirSync(RESOURCES_DIR, { recursive: true });

function link(name: string): void {
	const target = join(APP_ROOT, "resources", name);
	if (!existsSync(target)) return;
	const dest = join(RESOURCES_DIR, name);
	try {
		// Windows junction targets come back normalized (\\?\ prefix, trailing slash), so only trust the POSIX comparison.
		const st = lstatSync(dest);
		if (st.isSymbolicLink()) {
			if (process.platform !== "win32" && readlinkSync(dest) === target) return;
			unlinkSync(dest); // remove only the link, never recurse into the bundle it points to
		} else {
			rmSync(dest, { recursive: true, force: true });
		}
	} catch {}
	try {
		// "junction" needs no admin rights / developer mode on Windows; it is ignored on POSIX.
		symlinkSync(target, dest, process.platform === "win32" ? "junction" : "dir");
	} catch {
		cpSync(target, dest, { recursive: true });
	}
}
link("ui-plugins");
link("skills");

const hosts = (process.env.TCODE_BRIDGE_HOSTS ?? "")
	.split(",")
	.map((h) => h.trim().toLowerCase())
	.filter(Boolean);
writeFileSync(join(RESOURCES_DIR, "bridge-hosts.json"), JSON.stringify(hosts), "utf8");

// `process.resourcesPath` only exists under Electron; point it at our runtime dir.
Object.defineProperty(process, "resourcesPath", { value: RESOURCES_DIR, configurable: true });

// Always keep Pi's own state inside the persisted volume unless the operator chose otherwise.
if (!process.env.PI_CODING_AGENT_DIR) process.env.PI_CODING_AGENT_DIR = join(homedir(), ".pi", "agent");
