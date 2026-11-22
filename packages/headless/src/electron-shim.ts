/**
 * Minimal `electron` replacement for running TCode's main-process modules in plain Node.
 * Only what the headless server actually touches is implemented; everything else is an
 * "unsupported" stub that throws a clear error if used (desktop-only features such as
 * the embedded browser, tray, menus, auto-update).
 *
 * This file is aliased in place of the "electron" package by build.mjs.
 */
import { EventEmitter } from "node:events";
import { mkdirSync, renameSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const here = (import.meta as { dirname?: string }).dirname ?? process.cwd();

export const DATA_DIR = process.env.TCODE_DATA_DIR || join(homedir(), ".tcode-headless");
export const APP_ROOT = process.env.TCODE_APP_ROOT || dirname(here);

const paths = new Map<string, string>();
const appEvents = new EventEmitter();
appEvents.setMaxListeners(50);

export const app = {
	name: "TCode",
	isPackaged: true,
	getPath(name: string): string {
		const override = paths.get(name);
		if (override) return override;
		switch (name) {
			case "userData":
			case "appData":
				return DATA_DIR;
			case "home":
				return homedir();
			case "temp":
				return tmpdir();
			case "logs":
				return join(DATA_DIR, "logs");
			default:
				return join(DATA_DIR, name);
		}
	},
	setPath(name: string, value: string): void {
		paths.set(name, value);
	},
	getName: () => "TCode",
	getVersion: () => process.env.TCODE_APP_VERSION || "0.1.0-headless",
	getAppPath: () => APP_ROOT,
	getLocale: () => process.env.TCODE_LOCALE || "zh-CN",
	whenReady: () => Promise.resolve(),
	setAppUserModelId: (_id: string) => {},
	requestSingleInstanceLock: () => true,
	on: (ev: string, fn: (...a: unknown[]) => void) => appEvents.on(ev, fn),
	once: (ev: string, fn: (...a: unknown[]) => void) => appEvents.once(ev, fn),
	off: (ev: string, fn: (...a: unknown[]) => void) => appEvents.off(ev, fn),
	emit: (ev: string, ...a: unknown[]) => appEvents.emit(ev, ...a),
	quit: () => {
		appEvents.emit("before-quit");
		appEvents.emit("will-quit");
		process.exit(0);
	},
	exit: (code = 0) => process.exit(code),
};

export const ipcMain = {
	handle: (_ch: string, _fn: unknown) => {},
	on: (_ch: string, _fn: unknown) => {},
	removeHandler: (_ch: string) => {},
};

export class BrowserWindow {
	static getAllWindows(): BrowserWindow[] {
		return [];
	}
	static getFocusedWindow(): BrowserWindow | null {
		return null;
	}
	isDestroyed(): boolean {
		return true;
	}
	// biome-ignore lint/suspicious/noExplicitAny: shim
	webContents: any = { send: () => {} };
}

export const dialog = {
	showErrorBox: (title: string, content: string) => console.error(`[dialog] ${title}: ${content}`),
	showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
	showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
	showSaveDialog: async () => ({ canceled: true, filePath: undefined as string | undefined }),
};

export const shell = {
	openExternal: async (_url: string) => {},
	openPath: async (_p: string) => "",
	showItemInFolder: (_p: string) => {},
	/** No OS trash on a server: move into <data>/trash instead of deleting. */
	trashItem: async (p: string) => {
		const dir = join(DATA_DIR, "trash");
		mkdirSync(dir, { recursive: true });
		renameSync(p, join(dir, `${Date.now()}-${basename(p)}`));
	},
};

export class Notification {
	static isSupported(): boolean {
		return false;
	}
	constructor(_opts?: unknown) {}
	show(): void {}
	close(): void {}
	on(): this {
		return this;
	}
}

export const nativeTheme = {
	themeSource: "system" as "system" | "light" | "dark",
	shouldUseDarkColors: false,
	on: (_ev: string, _fn: unknown) => {},
};

function unsupported(name: string): unknown {
	const fail = () => {
		throw new Error(`electron.${name} is not available in the headless TCode server`);
	};
	return new Proxy(function () {}, { get: () => fail, apply: fail, construct: fail });
}

export const Menu = unsupported("Menu");
export const Tray = unsupported("Tray");
export const nativeImage = unsupported("nativeImage");
export const net = unsupported("net");
export const protocol = unsupported("protocol");
export const session = unsupported("session");
export const webContents = unsupported("webContents");

export default { app, ipcMain, BrowserWindow, dialog, shell, Notification, nativeTheme };
