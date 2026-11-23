/**
 * Best-effort Windows descendant tracking for shells that spawn long-lived children.
 * A Windows taskkill /T cannot reach descendants after the original parent exits.
 * We snapshot PID + creation time while the parent is alive and re-check identity
 * before terminating a process. Normal completion NEVER kills background services.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export interface WinProcessInfo {
	pid: number;
	parentPid: number;
	createdAt: string;
}

let inflight: Promise<WinProcessInfo[]> | undefined;
let lastSnapshot: WinProcessInfo[] = [];
let lastSampleMs = 0;
const SHELL = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const TASKKILL = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");

export async function windowsProcesses(fresh = false): Promise<WinProcessInfo[]> {
	if (process.platform !== "win32") return [];
	if (inflight) return inflight;
	if (!fresh && Date.now() - lastSampleMs < 650) return lastSnapshot;
	inflight = (async () => {
		try {
			const { stdout } = await execFileAsync(
				SHELL,
				["-NoProfile", "-NonInteractive", "-Command",
					"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress"],
				{ timeout: 4000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
			);
			const parsed: unknown = JSON.parse(stdout);
			const entries = Array.isArray(parsed) ? parsed : [parsed];
			const snapshot = entries
				.filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
				.map((value) => ({
					pid: Number(value.ProcessId),
					parentPid: Number(value.ParentProcessId),
					createdAt: String(value.CreationDate ?? ""),
				}))
				.filter((value) => Number.isInteger(value.pid) && value.pid > 0 && value.createdAt);
			lastSnapshot = snapshot;
			lastSampleMs = Date.now();
			return snapshot;
		} catch {
			return lastSnapshot;
		}
	})().finally(() => { inflight = undefined; });
	return inflight;
}

export function descendantsOf(
	rootPid: number,
	snapshot: readonly WinProcessInfo[],
	previous: ReadonlyMap<number, WinProcessInfo> = new Map(),
): WinProcessInfo[] {
	const parents = new Set([rootPid, ...previous.keys()]);
	const seen = new Set<number>([rootPid]);
	const descendants: WinProcessInfo[] = [];
	let added = true;
	while (added) {
		added = false;
		for (const item of snapshot) {
			if (seen.has(item.pid) || !parents.has(item.parentPid)) continue;
			seen.add(item.pid);
			parents.add(item.pid);
			descendants.push(item);
			added = true;
		}
	}
	return descendants;
}

export function matchingRecordedProcesses(
	recorded: ReadonlyMap<number, WinProcessInfo>,
	snapshot: readonly WinProcessInfo[],
): WinProcessInfo[] {
	const now = new Map(snapshot.map((item) => [item.pid, item]));
	return [...recorded.values()].filter((item) => now.get(item.pid)?.createdAt === item.createdAt);
}

export class WindowsProcessTree {
	private readonly known = new Map<number, WinProcessInfo>();
	private rootIdentity: WinProcessInfo | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private inProgress = false;

	constructor(readonly rootPid: number) {
		if (process.platform === "win32") {
			void this.sample();
			this.timer = setInterval(() => { void this.sample(); }, 1000);
			this.timer.unref?.();
		}
	}

	async sample(): Promise<void> {
		if (this.inProgress) return;
		this.inProgress = true;
		try {
			const snapshot = await windowsProcesses();
			if (!this.rootIdentity) this.rootIdentity = snapshot.find((item) => item.pid === this.rootPid);
			const root = snapshot.find((item) => item.pid === this.rootPid);
			if (!this.rootIdentity || root?.createdAt !== this.rootIdentity.createdAt) return;
			for (const child of descendantsOf(this.rootPid, snapshot, this.known)) {
				this.known.set(child.pid, child);
			}
		} finally {
			this.inProgress = false;
		}
	}

	stopMonitoring(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	async survivingChildren(): Promise<WinProcessInfo[]> {
		this.stopMonitoring();
		const snapshot = await windowsProcesses(true);
		return matchingRecordedProcesses(this.known, snapshot);
	}

	async terminate(): Promise<void> {
		this.stopMonitoring();
		await this.sample();
		const snapshot = await windowsProcesses(true);
		const targets = matchingRecordedProcesses(this.known, snapshot);
		const root = snapshot.find((item) => item.pid === this.rootPid);
		if (root && this.rootIdentity?.createdAt === root.createdAt) {
			await this.kill(root.pid, true);
		}
		// Children may have been orphaned after their root exited. Kill only known,
		// identity-matched descendants; verify again immediately before each attempt.
		for (const child of targets.reverse()) {
			const latest = await windowsProcesses(true);
			if (!latest.some((item) => item.pid === child.pid && item.createdAt === child.createdAt)) continue;
			await this.kill(child.pid, false);
		}
	}

	private async kill(pid: number, tree: boolean): Promise<void> {
		const args = ["/F", "/PID", String(pid), ...(tree ? ["/T"] : [])];
		try {
			await execFileAsync(TASKKILL, args, { timeout: 4000, windowsHide: true });
		} catch {
			// Already exited or access denied: runner will report the cancellation.
		}
	}
}
