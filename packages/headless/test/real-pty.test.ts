import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalRunner } from "../src/local-runner";

const hasPty = await import("node-pty").then(() => true).catch(() => false);

describe.skipIf(!hasPty)("real PTY (node-pty)", () => {
	it("runs an interactive shell, echoes input, resizes and exits", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pty-"));
		const r = new LocalRunner();
		let buf = "";
		let exit: { code: number } | undefined;
		try {
			const ok = await r.createPty({ ptyId: "t", cwd: dir, cols: 90, rows: 20 }, {
				onData: (d) => { buf += d; },
				onExit: (e) => { exit = e; },
			});
			expect(ok).toBe(true);

			// Wait for a marker printed AFTER the commands finish.
			// PTY chunks can split output, and typed commands appear in the echo.
			r.writePty("t", "printf 'PTY_%s_OK\\n' 42; printf 'COLS_BEFORE=%s\\n' \"$(tput cols)\"; pwd; printf 'BEFORE_%s_DONE\\n' PHASE\n");
			await vi.waitFor(() => expect(buf).toContain("BEFORE_PHASE_DONE"), { timeout: 10000, interval: 50 });
			expect(buf).toContain("PTY_42_OK");
			expect(buf).toMatch(/(?:^|[\r\n])COLS_BEFORE=90(?:[\r\n])/);

			r.resizePty("t", 120, 30);
			r.writePty("t", "printf 'COLS_AFTER=%s\\n' \"$(tput cols)\"; printf 'AFTER_%s_DONE\\n' PHASE; exit 5\n");
			await vi.waitFor(() => expect(buf).toContain("AFTER_PHASE_DONE"), { timeout: 10000, interval: 50 });
			await vi.waitFor(() => expect(exit?.code).toBe(5), { timeout: 10000, interval: 50 });
			expect(buf).toMatch(/(?:^|[\r\n])COLS_AFTER=120(?:[\r\n])/);
		} finally {
			r.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
