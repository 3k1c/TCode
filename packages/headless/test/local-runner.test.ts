import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalRunner } from "../src/local-runner";

let dir: string;
let runner: LocalRunner;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "lr-"));
	runner = new LocalRunner({ killGraceMs: 300 });
});
afterEach(() => {
	runner.stop();
	rmSync(dir, { recursive: true, force: true });
});

const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();

async function sh(script: string, extra: Record<string, unknown> = {}) {
	const chunks: { s: string; k: string }[] = [];
	const call = runner.call({ cmd: "shell.run", cwd: dir, script, ...extra }, (s, k) => chunks.push({ s, k }));
	if (!call) throw new Error("no call");
	const payload = await call.promise;
	return { payload, chunks, id: call.id };
}

describe("git.exec", () => {
	it("runs git and returns stdout/code", async () => {
		git("init", "-q");
		const r = await runner.call({ cmd: "git.exec", cwd: dir, args: ["rev-parse", "--is-inside-work-tree"] })!.promise;
		expect(r.ok).toBe(true);
		expect(r.code).toBe(0);
		expect(String(r.stdout).trim()).toBe("true");
	});
	it("returns non-zero code and stderr outside a repo", async () => {
		const r = await runner.call({ cmd: "git.exec", cwd: dir, args: ["status"] })!.promise;
		expect(r.ok).toBe(false);
		expect(r.code).not.toBe(0);
		expect(String(r.stderr).length).toBeGreaterThan(0);
	});
	it("supports separate gitDir / workTree (shadow repo)", async () => {
		const work = join(dir, "work");
		const gd = join(dir, "shadow.git");
		execFileSync("mkdir", ["-p", work]);
		writeFileSync(join(work, "a.txt"), "hi");
		await runner.call({ cmd: "git.exec", cwd: work, gitDir: gd, workTree: work, args: ["init", "-q"] })!.promise;
		const add = await runner.call({ cmd: "git.exec", cwd: work, gitDir: gd, workTree: work, args: ["add", "-A"] })!.promise;
		expect(add.code).toBe(0);
		const ls = await runner.call({ cmd: "git.exec", cwd: work, gitDir: gd, workTree: work, args: ["ls-files"] })!.promise;
		expect(String(ls.stdout).trim()).toBe("a.txt");
	});
	it("times out", async () => {
		const slow = new LocalRunner({ gitPath: "sleep" });
		const r = await slow.call({ cmd: "git.exec", cwd: dir, args: ["5"], timeoutMs: 150 })!.promise;
		expect(r.timedOut).toBe(true);
		expect(r.ok).toBe(false);
		slow.stop();
	});
	it("reports missing git binary", async () => {
		const bad = new LocalRunner({ gitPath: "/nonexistent/git" });
		const r = await bad.call({ cmd: "git.exec", cwd: dir, args: ["status"] })!.promise;
		expect(r.code).toBe(127);
	});
	it("does not prompt for credentials (no hang)", async () => {
		git("init", "-q");
		const r = await runner.call({
			cmd: "git.exec",
			cwd: dir,
			args: ["ls-remote", "https://127.0.0.1:9/x.git"],
			timeoutMs: 8000,
		})!.promise;
		expect(r.ok).toBe(false);
	});
});

describe("shell.run", () => {
	it("streams stdout and stderr separately and returns exit code", async () => {
		const { payload, chunks } = await sh("echo out; echo err 1>&2; exit 3");
		expect(payload.code).toBe(3);
		expect(payload.ok).toBe(false);
		expect(chunks.filter((c) => c.k === "out").map((c) => c.s).join("")).toBe("out\n");
		expect(chunks.filter((c) => c.k === "err").map((c) => c.s).join("")).toBe("err\n");
	});
	it("uses cwd and passes env through", async () => {
		const { chunks } = await sh('pwd; echo "$FOO"', { env: { ...process.env, FOO: "bar" } as Record<string, string> });
		const text = chunks.map((c) => c.s).join("");
		expect(text).toContain(dir.replace(/\/$/, ""));
		expect(text).toContain("bar");
	});
	it("handles multibyte output split across chunks", async () => {
		const { chunks } = await sh("printf '你好世界%.0s' $(seq 1 2000)");
		const text = chunks.map((c) => c.s).join("");
		expect(text).toBe("你好世界".repeat(2000));
		expect(text.includes("�")).toBe(false);
	});
	it("kills a running call (and its children) on shell.kill → canceled", async () => {
		const chunks: string[] = [];
		const call = runner.call({ cmd: "shell.run", cwd: dir, script: "echo started; sleep 30 & wait" }, (s) => chunks.push(s))!;
		await new Promise((r) => setTimeout(r, 300));
		expect(runner.sendBridge({ cmd: "shell.kill", session: call.id })).toBe(true);
		const p = await call.promise;
		expect(p.canceled).toBe(true);
		expect(p.ok).toBe(false);
		expect(chunks.join("")).toContain("started");
		expect(runner.sendBridge({ cmd: "shell.kill", session: call.id })).toBe(false);
	});
	it("times out and kills the whole process group", async () => {
		const marker = join(dir, "alive");
		const t0 = Date.now();
		const { payload } = await sh(`(sleep 2; touch ${marker}) & sleep 30`, { timeoutMs: 300 });
		expect(payload.timedOut).toBe(true);
		expect(Date.now() - t0).toBeLessThan(5000);
		await new Promise((r) => setTimeout(r, 2500));
		expect(() => execFileSync("test", ["-e", marker])).toThrow(); // background child was killed too
	});
	it("returns after stop() with no calls accepted", () => {
		runner.stop();
		expect(runner.call({ cmd: "shell.run", cwd: dir, script: "true" })).toBeNull();
		expect(runner.sendBridge({ cmd: "shell.kill", session: 1 })).toBe(false);
	});
});

describe("pty", () => {
	function fakePty() {
		const state = { written: [] as string[], size: [0, 0], killed: false, dataCb: (_: string) => {}, exitCb: (_: { exitCode: number }) => {} };
		const pty = {
			write: (d: string) => state.written.push(d),
			resize: (c: number, r: number) => {
				state.size = [c, r];
			},
			kill: () => {
				state.killed = true;
			},
			onData: (cb: (d: string) => void) => {
				state.dataCb = cb;
			},
			onExit: (cb: (e: { exitCode: number }) => void) => {
				state.exitCb = cb;
			},
		};
		return { state, pty };
	}
	it("wires data/exit/write/resize/kill", async () => {
		const f = fakePty();
		const r = new LocalRunner({ ptyFactory: async () => f.pty });
		const got: string[] = [];
		let exit: unknown;
		const ok = await r.createPty({ ptyId: "p1", cwd: dir, cols: 80, rows: 24 }, { onData: (d) => got.push(d), onExit: (e) => (exit = e) });
		expect(ok).toBe(true);
		f.state.dataCb("hello");
		expect(got).toEqual(["hello"]);
		r.writePty("p1", "ls\n");
		r.resizePty("p1", 100, 30);
		expect(f.state.written).toEqual(["ls\n"]);
		expect(f.state.size).toEqual([100, 30]);
		f.state.exitCb({ exitCode: 7 });
		expect(exit).toEqual({ code: 7 });
		expect(r.createPty({ ptyId: "p1", cwd: dir, cols: 80, rows: 24 }, { onData() {}, onExit() {} })).not.toBeNull();
	});
	it("returns false when node-pty is unavailable", async () => {
		const r = new LocalRunner({ ptyFactory: async () => null });
		expect(await r.createPty({ ptyId: "p", cwd: dir, cols: 80, rows: 24 }, { onData() {}, onExit() {} })).toBe(false);
	});
	it("enforces max PTYs and kills all on stop()", async () => {
		const made: ReturnType<typeof fakePty>[] = [];
		const r = new LocalRunner({ maxPtys: 2, ptyFactory: async () => { const f = fakePty(); made.push(f); return f.pty; } });
		const exits: unknown[] = [];
		const h = { onData() {}, onExit: (e: unknown) => exits.push(e) };
		expect(await r.createPty({ ptyId: "a", cwd: dir, cols: 80, rows: 24 }, h)).toBe(true);
		expect(await r.createPty({ ptyId: "b", cwd: dir, cols: 80, rows: 24 }, h)).toBe(true);
		expect(await r.createPty({ ptyId: "c", cwd: dir, cols: 80, rows: 24 }, h)).toBe(false);
		r.stop();
		expect(made.every((m) => m.state.killed)).toBe(true);
		expect(exits.length).toBe(2);
	});
});

// Regression: a detached grandchild can keep stdout/stderr pipes open after bash exits.
describe("shell.run pipe lifecycle", () => {
	it("returns after the direct shell exits even when a grandchild inherits stdout", async () => {
		const start = Date.now();
		const { payload, chunks } = await sh("sleep 8 & echo parent-finished");
		expect(payload.ok).toBe(true);
		expect(payload.code).toBe(0);
		expect(chunks.map((x) => x.s).join("")).toContain("parent-finished");
		expect(Date.now() - start).toBeLessThan(4500);
	});
	it("reports a failure code without converting it to success", async () => {
		const { payload } = await sh("echo failed >&2; exit 17");
		expect(payload.ok).toBe(false);
		expect(payload.code).toBe(17);
	});
	it("does not turn a slow but finite foreground command into a failure", async () => {
		const { payload } = await sh("sleep 1; echo completed");
		expect(payload.ok).toBe(true);
	});
});

// Windows smoke: only cancel the process tree created by this test.
describe.skipIf(process.platform !== "win32")("Windows shell cancellation", () => {
	it("terminates a running shell and its known sleep child", async () => {
		const pidFile = join(dir, "child.pid");
		const call = runner.call({ cmd: "shell.run", cwd: dir,
			script: `sleep 30 & echo $! > '${pidFile.replace(/\\/g, "/")}'; wait` })!;
		const { existsSync, readFileSync } = await import("node:fs");
		for (let i = 0; i < 40 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
		expect(existsSync(pidFile)).toBe(true);
		const childPid = Number(readFileSync(pidFile, "utf8").trim());
		await new Promise((r) => setTimeout(r, 2300)); // Allow Windows process sampler to capture the child.
		expect(runner.sendBridge({ cmd: "shell.kill", session: call.id })).toBe(true);
		const result = await call.promise;
		expect(result.ok).toBe(false);
		expect(result.canceled).toBe(true);
		await new Promise((r) => setTimeout(r, 2500));
		const { execFileSync } = await import("node:child_process");
		const alive = execFileSync("powershell", ["-NoProfile", "-Command",
			`[bool](Get-Process -Id ${childPid} -ErrorAction SilentlyContinue)`], { encoding: "utf8" }).trim();
		expect(alive).toBe("False");
	}, 15_000);
});
