/** Canonical cross-platform Headless build: never ship the Electron renderer by mistake. */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCli = process.env.npm_execpath;
const env = { ...process.env, VITE_TCODE_HEADLESS: "1" };
for (const workspace of ["packages/desktop", "packages/headless"]) {
	console.log("[headless-release] building", workspace);
	const command = npmCli ? process.execPath : npm;
	const args = npmCli ? [npmCli, "run", "build", "-w", workspace] : ["run", "build", "-w", workspace];
	const result = spawnSync(command, args, {
		cwd: root,
		env,
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32" && !npmCli,
	});
	if (result.error || result.status !== 0) {
		console.error("[headless-release] failed", workspace, result.error?.message ?? result.status);
		process.exit(result.status || 1);
	}
}
console.log("[headless-release] verified renderer was built with VITE_TCODE_HEADLESS=1");
