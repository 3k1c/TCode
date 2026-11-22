import { describe, expect, it, vi } from "vitest";
import { killTree, pickShell, shellArgs, windowsBashCandidates } from "../src/local-runner";

describe("windows shell selection", () => {
	const env = { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" } as NodeJS.ProcessEnv;

	it("lists Git for Windows bash, bin before usr/bin", () => {
		const c = windowsBashCandidates(env);
		expect(c[0]).toMatch(/Program Files.*Git.*bin.*bash\.exe$/);
		expect(c.findIndex((x) => /usr.bin.bash/.test(x))).toBeGreaterThan(c.findIndex((x) => /Program Files.*Git.bin.bash\.exe$/.test(x)));
	});

	it("picks an existing Git bash", () => {
		const found = windowsBashCandidates(env)[0];
		expect(pickShell(undefined, "win32", (p) => p === found, env)).toBe(found);
	});

	it("honours TCODE_SHELL on windows", () => {
		expect(pickShell(undefined, "win32", (p) => p === "D:\\tools\\bash.exe", { ...env, TCODE_SHELL: "D:\\tools\\bash.exe" })).toBe(
			"D:\\tools\\bash.exe",
		);
	});

	it("returns null (never the WSL launcher) when Git for Windows is missing", () => {
		expect(pickShell(undefined, "win32", () => false, env)).toBeNull();
	});

	it("falls back to /bin/sh on POSIX", () => {
		expect(pickShell(undefined, "linux", () => false, {})).toBe("/bin/sh");
	});
});

describe("shellArgs", () => {
	it("bash style", () => expect(shellArgs("C:\\Git\\bin\\bash.exe", "echo hi")).toEqual({ args: ["-c", "echo hi"], verbatim: false }));
	it("powershell", () => expect(shellArgs("C:\\x\\pwsh.exe", "ls").args.slice(-2)).toEqual(["-Command", "ls"]));
	it("cmd uses verbatim args", () => expect(shellArgs("C:\\Windows\\System32\\cmd.exe", "dir")).toEqual({ args: ["/d", "/s", "/c", '"dir"'], verbatim: true }));
});

describe("killTree on windows", () => {
	it("uses taskkill /T /F", () => {
		const on = vi.fn();
		const run = vi.fn(() => ({ on })) as never;
		killTree({ pid: 4242, kill: vi.fn() } as never, "SIGTERM", "win32", run);
		expect(run).toHaveBeenCalledWith("taskkill", ["/pid", "4242", "/T", "/F"], expect.objectContaining({ windowsHide: true }));
	});
	it("falls back to child.kill if taskkill cannot start", () => {
		const kill = vi.fn();
		let handler: (() => void) | undefined;
		const run = vi.fn(() => ({ on: (_e: string, h: () => void) => (handler = h) })) as never;
		killTree({ pid: 1, kill } as never, "SIGKILL", "win32", run);
		handler?.();
		expect(kill).toHaveBeenCalledWith("SIGKILL");
	});
});
