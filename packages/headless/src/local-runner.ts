/**
 * Clean-room, in-process replacement for the closed-source `component.exe`.
 *
 * It implements only the public interface the app already defines
 * (`ComponentRunnerLike` in desktop/src/main/component-bridge.ts):
 *   - call({cmd:"git.exec"})   run git, return {ok, code, stdout, stderr}
 *   - call({cmd:"shell.run"})  run a shell script, stream stdout/stderr
 *   - sendBridge({cmd:"shell.kill"}) kill a running shell call
 *   - createPty / writePty / resizePty / killPty
 *
 * It does NOT talk to any network service, does not write to the Pi settings,
 * and does not load any third-party binary. Everything runs as the current user.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { WindowsProcessTree } from "./windows-process-tree";

type Payload = Record<string, unknown>;
type StreamCb = (data: string, stream: "out" | "err") => void;

export interface RunnerRequest {
	cmd: string;
	args?: string[];
	cwd?: string;
	gitDir?: string;
	workTree?: string;
	script?: string;
	timeoutMs?: number;
	session?: number;
	env?: Record<string, string>;
	ptyId?: string;
	cols?: number;
	rows?: number;
	data?: string;
	shell?: string;
}

export interface PtyHandlers {
	onData: (data: string) => void;
	onExit: (payload: { code: number; error?: string }) => void;
}

interface PtyLike {
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	onData(cb: (d: string) => void): unknown;
	onExit(cb: (e: { exitCode: number }) => void): unknown;
}

export interface LocalRunnerOptions {
	/** Shell used for `shell.run` and PTYs. Default: $TCODE_SHELL, /bin/bash, /bin/sh. */
	shell?: string;
	/** git executable. Default: "git". */
	gitPath?: string;
	/** Max bytes of git stdout kept in memory. Default 64 MiB. */
	maxGitOutputBytes?: number;
	/** Max concurrent PTYs. Default 16. */
	maxPtys?: number;
	/** Grace period between SIGTERM and SIGKILL. Default 3000 ms. */
	killGraceMs?: number;
	/** Injected for tests; defaults to dynamic import("node-pty"). */
	ptyFactory?: (opts: {
		shell: string;
		cwd: string;
		cols: number;
		rows: number;
		env: Record<string, string>;
	}) => Promise<PtyLike | null>;
}

const DEFAULT_GIT_ENV: Record<string, string> = {
	GIT_TERMINAL_PROMPT: "0",
	GIT_ASKPASS: "",
	GCM_INTERACTIVE: "never",
	...(process.platform === "win32" ? {} : { LC_ALL: "C.UTF-8" }),
};

/** Candidate bash locations of a Git for Windows install. */
export function windowsBashCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
	const roots = [
		env.GIT_INSTALL_ROOT,
		env.ProgramW6432 && join(env.ProgramW6432, "Git"),
		env.ProgramFiles && join(env.ProgramFiles, "Git"),
		env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Git"),
		env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Git"),
	].filter((r): r is string => Boolean(r));
	// Git\bin\bash.exe sets up the MSYS PATH itself; Git\usr\bin\bash.exe does not, so it comes last.
	return roots.flatMap((r) => [join(r, "bin", "bash.exe")]).concat(roots.map((r) => join(r, "usr", "bin", "bash.exe")));
}

/**
 * Pick the shell used for `shell.run` and PTYs.
 * POSIX: preferred, $TCODE_SHELL, /bin/bash, /usr/bin/bash, /bin/sh.
 * Windows: preferred, $TCODE_SHELL, Git for Windows bash. Never the bare `bash.exe` on PATH:
 * C:\Windows\System32\bash.exe is the WSL launcher and would run scripts inside WSL.
 * Returns null if nothing suitable exists (Windows without Git for Windows).
 */
export function pickShell(
	preferred?: string,
	platform: NodeJS.Platform = process.platform,
	exists: (p: string) => boolean = existsSync,
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	if (platform === "win32") {
		const cands = [preferred, env.TCODE_SHELL, ...windowsBashCandidates(env)];
		for (const c of cands) if (c && exists(c)) return c;
		return null;
	}
	const cands = [preferred, env.TCODE_SHELL, "/bin/bash", "/usr/bin/bash", "/bin/sh"];
	for (const c of cands) if (c && exists(c)) return c;
	return "/bin/sh";
}

/** Arguments that make `shell` execute `script` (bash-like by default; PowerShell/cmd supported on Windows). */
export function shellArgs(shell: string, script: string): { args: string[]; verbatim: boolean } {
	const name = (shell.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "");
	if (name === "powershell" || name === "pwsh") return { args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], verbatim: false };
	if (name === "cmd") return { args: ["/d", "/s", "/c", `"${script}"`], verbatim: true };
	return { args: ["-c", script], verbatim: false };
}

/** Process-group on POSIX (we spawn detached); on Windows there are no groups, so use taskkill /T. */
function spawnFlags(platform: NodeJS.Platform = process.platform): { detached: boolean; windowsHide: boolean } {
	return { detached: platform !== "win32", windowsHide: true };
}

export function killTree(
	child: Pick<ChildProcess, "pid" | "kill">,
	signal: NodeJS.Signals,
	platform: NodeJS.Platform = process.platform,
	run: typeof spawn = spawn,
): void {
	const pid = child.pid;
	if (!pid) return;
	if (platform === "win32") {
		try {
			run("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {
				try {
					child.kill(signal);
				} catch {}
			});
		} catch {
			try {
				child.kill(signal);
			} catch {}
		}
		return;
	}
	try {
		// negative pid => the whole process group (we spawn with detached: true)
		process.kill(-pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {}
	}
}

interface ShellCall {
	child: ChildProcess;
	canceled: boolean;
	timedOut: boolean;
	killTimer?: NodeJS.Timeout;
	forceFinish?: () => void;
	tracker?: WindowsProcessTree;
}

export class LocalRunner {
	private nextId = 1;
	private readonly shells = new Map<number, ShellCall>();
	private readonly ptys = new Map<string, { pty: PtyLike; handlers: PtyHandlers }>();
	private stopped = false;
	private readonly opts: Required<Omit<LocalRunnerOptions, "ptyFactory" | "shell">> & {
		shell?: string;
		ptyFactory: NonNullable<LocalRunnerOptions["ptyFactory"]>;
	};

	constructor(options: LocalRunnerOptions = {}) {
		this.opts = {
			shell: options.shell,
			gitPath: options.gitPath ?? "git",
			maxGitOutputBytes: options.maxGitOutputBytes ?? 64 * 1024 * 1024,
			maxPtys: options.maxPtys ?? 16,
			killGraceMs: options.killGraceMs ?? 3000,
			ptyFactory: options.ptyFactory ?? defaultPtyFactory,
		};
	}

	// ---------------------------------------------------------------- calls

	call(req: RunnerRequest, onStream?: StreamCb): { id: number; promise: Promise<Payload> } | null {
		if (this.stopped) return null;
		const id = this.nextId++;
		switch (req.cmd) {
			case "git.exec":
				return { id, promise: this.runGit(req) };
			case "shell.run":
				return { id, promise: this.runShell(id, req, onStream) };
			case "shell.kill":
				return { id, promise: Promise.resolve({ ok: this.killShell(req.session) }) };
			case "meta":
				return { id, promise: Promise.resolve({ ok: true, runtime: "tcode-headless-local" }) };
			default:
				return { id, promise: Promise.resolve({ ok: false, error: `unsupported command: ${req.cmd}` }) };
		}
	}

	sendBridge(req: { cmd: string; session?: number; args?: string[] }): boolean {
		if (this.stopped) return false;
		if (req.cmd === "shell.kill") return this.killShell(req.session);
		return false;
	}

	// ------------------------------------------------------------------ git

	private runGit(req: RunnerRequest): Promise<Payload> {
		const args = [...(req.args ?? [])];
		const pre: string[] = [];
		if (req.gitDir) pre.push(`--git-dir=${req.gitDir}`);
		if (req.workTree) pre.push(`--work-tree=${req.workTree}`);
		const env = { ...process.env, ...DEFAULT_GIT_ENV, ...(req.env ?? {}) } as NodeJS.ProcessEnv;

		return new Promise<Payload>((resolve) => {
			let child: ChildProcess;
			try {
				child = spawn(this.opts.gitPath, [...pre, ...args], {
					cwd: req.cwd || undefined,
					env,
					stdio: ["ignore", "pipe", "pipe"],
					...spawnFlags(),
				});
			} catch (e) {
				resolve({ ok: false, code: 127, stdout: "", stderr: (e as Error).message });
				return;
			}
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			let outBytes = 0;
			let truncated = false;
			let timedOut = false;
			let settled = false;
			let exitSeen = false;
			let exitCode: number | null = null;
			let drainTimer: NodeJS.Timeout | undefined;
			let forceTimer: NodeJS.Timeout | undefined;
			let outputIncomplete = false;
			const tracker = child.pid && process.platform === "win32" ? new WindowsProcessTree(child.pid) : undefined;
			const done = (p: Payload) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				if (drainTimer) clearTimeout(drainTimer);
				if (forceTimer) clearTimeout(forceTimer);
				tracker?.stopMonitoring();
				resolve(p);
			};
			const finish = (code: number | null) => {
				const exit = timedOut ? 124 : (code ?? 1);
				done({
					ok: exit === 0,
					code: exit,
					timedOut,
					truncated: truncated || outputIncomplete,
					outputIncomplete,
					stdout: Buffer.concat(out).toString("utf8"),
					stderr: Buffer.concat(err).toString("utf8"),
				});
			};
			const timer =
				req.timeoutMs && req.timeoutMs > 0
					? setTimeout(() => {
							timedOut = true;
							killTree(child, "SIGKILL");
							void tracker?.terminate();
							forceTimer = setTimeout(() => {
								outputIncomplete = true;
								child.stdout?.destroy();
								child.stderr?.destroy();
								finish(exitCode);
							}, this.opts.killGraceMs + 2000);
						}, req.timeoutMs)
					: undefined;
			child.stdout?.on("data", (b: Buffer) => {
				if (outBytes + b.length > this.opts.maxGitOutputBytes) {
					truncated = true;
					const room = this.opts.maxGitOutputBytes - outBytes;
					if (room > 0) out.push(b.subarray(0, room));
					outBytes = this.opts.maxGitOutputBytes;
					return;
				}
				outBytes += b.length;
				out.push(b);
			});
			child.stderr?.on("data", (b: Buffer) => {
				if (err.reduce((n, x) => n + x.length, 0) < 1024 * 1024) err.push(b);
			});
			child.on("error", (e: NodeJS.ErrnoException) => {
				done({
					ok: false,
					code: e.code === "ENOENT" ? 127 : 1,
					stdout: "",
					stderr: e.code === "ENOENT" ? "git: command not found" : e.message,
				});
			});
			child.on("exit", (code) => {
				if (settled || exitSeen) return;
				exitSeen = true;
				exitCode = code;
				drainTimer = setTimeout(() => {
					outputIncomplete = true;
					child.stdout?.destroy();
					child.stderr?.destroy();
					finish(exitCode);
				}, 1500);
			});
			child.on("close", (code) => {
				if (!exitSeen) exitCode = code;
				finish(exitCode);
			});
		});
	}

	// ---------------------------------------------------------------- shell

	private runShell(id: number, req: RunnerRequest, onStream?: StreamCb): Promise<Payload> {
		const shell = pickShell(this.opts.shell);
		if (!shell) {
			const msg = "no bash found: install Git for Windows or set TCODE_SHELL to a bash.exe path\n";
			onStream?.(msg, "err");
			return Promise.resolve({ ok: false, code: 127, canceled: false, timedOut: false, truncated: false });
		}
		const env = { ...process.env, ...(req.env ?? {}) } as NodeJS.ProcessEnv;
		const sh = shellArgs(shell, req.script ?? "");
		return new Promise<Payload>((resolve) => {
			let child: ChildProcess;
			try {
				child = spawn(shell, sh.args, {
					cwd: req.cwd || undefined,
					env,
					stdio: ["ignore", "pipe", "pipe"],
					windowsVerbatimArguments: sh.verbatim,
					...spawnFlags(),
				});
			} catch (e) {
				resolve({ ok: false, code: 127, canceled: false, timedOut: false, truncated: false, stderr: (e as Error).message });
				return;
			}
			const call: ShellCall = { child, canceled: false, timedOut: false };
			if (child.pid && process.platform === "win32") {
				call.tracker = new WindowsProcessTree(child.pid);
			}
			this.shells.set(id, call);

			const outDec = new StringDecoder("utf8");
			const errDec = new StringDecoder("utf8");
			const startedAt = Date.now();
			let lastOutputAt = startedAt;
			let lastNoticeAt = 0;
			// A lack of output is a warning, not proof that compilation is stalled.
			const progressTimer = setInterval(() => {
				const now = Date.now();
				if (now - lastOutputAt < 120_000 || now - lastNoticeAt < 60_000) return;
				lastNoticeAt = now;
				onStream?.(`[TCode] Still running: ${Math.floor((now - startedAt) / 60_000)} min elapsed; ${Math.floor((now - lastOutputAt) / 60_000)} min without output.\n`, "err");
			}, 30_000);
			progressTimer.unref?.();
			child.stdout?.on("data", (b: Buffer) => {
				lastOutputAt = Date.now();
				const s = outDec.write(b);
				if (s) onStream?.(s, "out");
			});
			child.stderr?.on("data", (b: Buffer) => {
				lastOutputAt = Date.now();
				const s = errDec.write(b);
				if (s) onStream?.(s, "err");
			});

			let settled = false;
			let exitSeen = false;
			let exitCode: number | null = null;
			let drainTimer: NodeJS.Timeout | undefined;
			let pipesClosed = false;
			let outputIncomplete = false;
			let finishReason: "exit" | "close" | "error" | "timeout" | "cancel" = "exit";
			const finish = (code: number | null) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				clearInterval(progressTimer);
				if (drainTimer) clearTimeout(drainTimer);
				if (call.killTimer) clearTimeout(call.killTimer);
				this.shells.delete(id);
				call.tracker?.stopMonitoring();
				// Do not wait for inherited pipes after the direct child has exited.
				const restOut = outDec.end();
				const restErr = errDec.end();
				if (restOut) onStream?.(restOut, "out");
				if (restErr) onStream?.(restErr, "err");
				resolve({
					ok: code === 0 && !call.canceled && !call.timedOut,
					code: call.timedOut ? 124 : call.canceled ? 130 : (code ?? 1),
					canceled: call.canceled,
					timedOut: call.timedOut,
					truncated: outputIncomplete,
					outputIncomplete,
					finishReason,
				});
			};
			call.forceFinish = () => {
				outputIncomplete = true;
				finishReason = call.timedOut ? "timeout" : "cancel";
				child.stdout?.destroy();
				child.stderr?.destroy();
				finish(call.timedOut ? 124 : 130);
			};
			const closePipes = () => {
				if (settled) return;
				outputIncomplete = !pipesClosed;
				if (outputIncomplete) {
					child.stdout?.destroy();
					child.stderr?.destroy();
				}
				finish(exitCode);
			};
			const onExit = (code: number | null) => {
				if (settled || exitSeen) return;
				exitSeen = true;
				exitCode = code;
				// stdout/stderr may be inherited by a detached grandchild. Never
				// make the parent's tool result depend on the grandchild closing them.
				drainTimer = setTimeout(closePipes, 1500);
			};
			const timer =
				req.timeoutMs && req.timeoutMs > 0
					? setTimeout(() => {
							call.timedOut = true;
							finishReason = "timeout";
							this.terminate(call);
						}, req.timeoutMs)
					: undefined;
			child.on("error", (e) => {
				onStream?.(e.message + "\n", "err");
				finishReason = "error";
				finish(127);
			});
			child.on("exit", onExit);
			child.on("close", (code) => {
				pipesClosed = true;
				if (!exitSeen) {
					exitSeen = true;
					exitCode = code;
				}
				if (!settled) {
					if (call.timedOut) finishReason = "timeout";
					else if (call.canceled) finishReason = "cancel";
					else finishReason = "close";
					finish(exitCode);
				}
			});
		});
	}

	private terminate(call: ShellCall): void {
		killTree(call.child, "SIGTERM");
		void call.tracker?.terminate();
		call.killTimer = setTimeout(() => {
			killTree(call.child, "SIGKILL");
			void call.tracker?.terminate();
			setTimeout(() => call.forceFinish?.(), 2000).unref?.();
		}, this.opts.killGraceMs);
		call.killTimer.unref?.();
	}

	private killShell(id: number | undefined): boolean {
		if (id == null) return false;
		const call = this.shells.get(id);
		if (!call) return false;
		call.canceled = true;
		this.terminate(call);
		return true;
	}

	// ------------------------------------------------------------------ pty

	createPty(
		req: {
			ptyId: string;
			cwd: string;
			cols: number;
			rows: number;
			env?: Record<string, string>;
			shell?: string;
		},
		handlers: PtyHandlers,
	): Promise<boolean> | null {
		if (this.stopped || this.ptys.has(req.ptyId)) return null;
		if (this.ptys.size >= this.opts.maxPtys) return Promise.resolve(false);
		const env = {
			...(process.env as Record<string, string>),
			...(req.env ?? {}),
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
		};
		const ptyShell = pickShell(req.shell ?? this.opts.shell);
		if (!ptyShell) return Promise.resolve(false);
		return this.opts
			.ptyFactory({
				shell: ptyShell,
				cwd: req.cwd,
				cols: req.cols,
				rows: req.rows,
				env,
			})
			.then((pty) => {
				if (!pty) return false;
				if (this.stopped) {
					pty.kill();
					return false;
				}
				this.ptys.set(req.ptyId, { pty, handlers });
				pty.onData((d) => handlers.onData(d));
				pty.onExit((e) => {
					this.ptys.delete(req.ptyId);
					handlers.onExit({ code: e.exitCode });
				});
				return true;
			})
			.catch(() => false);
	}

	writePty(ptyId: string, data: string): void {
		try {
			this.ptys.get(ptyId)?.pty.write(data);
		} catch {}
	}

	resizePty(ptyId: string, cols: number, rows: number): void {
		try {
			this.ptys.get(ptyId)?.pty.resize(cols, rows);
		} catch {}
	}

	killPty(ptyId: string): void {
		const s = this.ptys.get(ptyId);
		if (!s) return;
		this.ptys.delete(ptyId);
		try {
			s.pty.kill();
		} catch {}
	}

	// ------------------------------------------------------------ lifecycle

	stop(): void {
		this.stopped = true;
		for (const call of this.shells.values()) {
			call.canceled = true;
			killTree(call.child, "SIGKILL");
			void call.tracker?.terminate();
		}
		this.shells.clear();
		for (const { pty, handlers } of this.ptys.values()) {
			try {
				pty.kill();
			} catch {}
			handlers.onExit({ code: -1, error: "runtime stopped" });
		}
		this.ptys.clear();
	}
}

async function defaultPtyFactory(o: {
	shell: string;
	cwd: string;
	cols: number;
	rows: number;
	env: Record<string, string>;
}): Promise<PtyLike | null> {
	try {
		const mod = (await import("node-pty")) as unknown as {
			spawn: (file: string, args: string[], opts: Record<string, unknown>) => PtyLike;
		};
		return mod.spawn(o.shell, [], {
			name: "xterm-256color",
			cols: o.cols,
			rows: o.rows,
			cwd: o.cwd,
			env: o.env,
		});
	} catch {
		return null;
	}
}
