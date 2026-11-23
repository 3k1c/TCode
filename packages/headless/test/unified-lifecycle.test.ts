import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalRunner } from "../src/local-runner";
import { descendantsOf, matchingRecordedProcesses, type WinProcessInfo } from "../src/windows-process-tree";

let dir: string;
let runner: LocalRunner;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "tcode-unified-runner-"));
	runner = new LocalRunner({ killGraceMs: 400, stdioDrainMs: 800, maxShellRunMs: 8000 });
});
afterEach(() => {
	runner.stop();
	rmSync(dir, { recursive: true, force: true });
});

async function run(script: string, timeoutMs?: number) {
	const output: string[] = [];
	const call = runner.call({ cmd: "shell.run", cwd: dir, script, timeoutMs }, (text) => output.push(text));
	if (!call) throw new Error("shell not available");
	return { result: await call.promise, output: output.join("") };
}

describe("unified local runner lifecycle", () => {
	it("returns successful exit code and complete output", async () => {
		const { result, output } = await run("echo unified-success");
		expect(result.ok).toBe(true);
		expect(result.code).toBe(0);
		expect(output).toContain("unified-success");
		expect(result.outputIncomplete).toBe(false);
	});
	it("returns failure rather than false success", async () => {
		const { result } = await run("echo failure >&2; exit 17");
		expect(result.ok).toBe(false);
		expect(result.code).toBe(17);
	});
	it("allows a finite command without output", async () => {
		const { result } = await run("sleep 1; echo done");
		expect(result.ok).toBe(true);
	});
	it("finishes after shell exit despite an inherited stdout handle", async () => {
		const start = Date.now();
		const { result, output } = await run("sleep 7 & echo parent-finished");
		expect(result.code).toBe(0);
		expect(output).toContain("parent-finished");
		expect(Date.now() - start).toBeLessThan(5000);
		expect(result.outputIncomplete).toBe(true);
	});
	it("cancels active shell without waiting for inherited pipes", async () => {
		const call = runner.call({ cmd: "shell.run", cwd: dir, script: "echo started; sleep 30 & wait" })!;
		await new Promise((r) => setTimeout(r, 500));
		expect(runner.sendBridge({ cmd: "shell.kill", session: call.id })).toBe(true);
		const result = await call.promise;
		expect(result.canceled).toBe(true);
		expect(result.ok).toBe(false);
	});
	it("enforces an explicit timeout rather than an infinite wait", async () => {
		const { result } = await run("sleep 30 & wait", 350);
		expect(result.timedOut).toBe(true);
		expect(result.ok).toBe(false);
	});
});

describe("Windows process identity safety", () => {
	const snapshot: WinProcessInfo[] = [
		{ pid: 10, parentPid: 0, createdAt: "base" },
		{ pid: 11, parentPid: 10, createdAt: "child" },
		{ pid: 12, parentPid: 11, createdAt: "grandchild" },
		{ pid: 22, parentPid: 0, createdAt: "unrelated" },
	];
	it("discovers only owned children and grandchildren", () => {
		expect(descendantsOf(10, snapshot).map((x) => x.pid)).toEqual([11, 12]);
	});
	it("refuses PID reuse when creation time differs", () => {
		const recorded = new Map<number, WinProcessInfo>([[11, snapshot[1]!], [12, snapshot[2]!]]);
		const current = snapshot.map((x) => x.pid === 11 ? { ...x, createdAt: "new process" } : x);
		expect(matchingRecordedProcesses(recorded, current).map((x) => x.pid)).toEqual([12]);
	});
});
