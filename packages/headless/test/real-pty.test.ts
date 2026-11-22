import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalRunner } from "../src/local-runner";

const hasPty = await import("node-pty").then(() => true).catch(() => false);

describe.skipIf(!hasPty)("real PTY (node-pty)", () => {
	it("runs an interactive shell, echoes input, resizes and exits", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pty-"));
		const r = new LocalRunner();
		let buf = "";
		let exit: { code: number } | undefined;
		const ok = await r.createPty({ ptyId: "t", cwd: dir, cols: 90, rows: 20 }, {
			onData: (d) => { buf += d; },
			onExit: (e) => { exit = e; },
		});
		expect(ok).toBe(true);
		r.writePty("t", "echo PTY_$((6*7))_OK; tput cols; pwd\n");
		await new Promise((res) => { const t = setInterval(() => { if (buf.includes("PTY_42_OK")) { clearInterval(t); res(null); } }, 50); setTimeout(() => { clearInterval(t); res(null); }, 5000); });
		expect(buf).toContain("PTY_42_OK");
		expect(buf).toContain("90");
		r.resizePty("t", 120, 30);
		r.writePty("t", "tput cols\nexit 5\n");
		await new Promise((res) => { const t = setInterval(() => { if (exit) { clearInterval(t); res(null); } }, 50); setTimeout(() => { clearInterval(t); res(null); }, 5000); });
		expect(buf).toContain("120");
		expect(exit?.code).toBe(5);
		r.stop();
		rmSync(dir, { recursive: true, force: true });
	});
});
