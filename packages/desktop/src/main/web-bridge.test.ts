import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn() },
	app: { getPath: () => tmpdir(), getAppPath: () => tmpdir() },
}));

import { WebSocket } from "ws";
import { invokeRegistry } from "./ipc/invoke";
import { WebBridgeService } from "./web-bridge";

let root = "";
let service: WebBridgeService | null = null;
let base = "";
const sockets: WebSocket[] = [];

const configFile = () => join(root, "web-access.json");
const rendererDir = () => join(root, "renderer");

function writeRenderer(): void {
	mkdirSync(rendererDir(), { recursive: true });
	writeFileSync(
		join(rendererDir(), "index.html"),
		'<!doctype html><title>tcode-app</title><div id="app">TCODE_APP_MARKER</div>',
	);
	writeFileSync(join(rendererDir(), "app.js"), "console.log('tcode-app-js');");
}

async function startService(configText?: string): Promise<WebBridgeService> {
	if (configText !== undefined) writeFileSync(configFile(), configText);
	service = new WebBridgeService({
		configPath: configFile(),
		rendererDir: rendererDir(),
		devUrl: "http://localhost:5173",
		defaultPort: 0,
	});
	await service.init();
	return service;
}

async function startListening(): Promise<void> {
	const bridge = await startService();
	const status = await bridge.setEnabled(true);
	expect(status.listening).toBe(true);
	base = `http://127.0.0.1:${status.port}`;
}

function openWs(url: string, headers?: Record<string, string>): Promise<WebSocket> {
	return new Promise((resolvePromise, reject) => {
		const ws = new WebSocket(url, { headers });
		sockets.push(ws);
		ws.once("open", () => resolvePromise(ws));
		ws.once("error", (error) => reject(error));
	});
}

function invokeOverWs(ws: WebSocket, channel: string, args: unknown): Promise<unknown> {
	return new Promise((resolvePromise, reject) => {
		ws.once("message", (data) => {
			const message = JSON.parse(data.toString()) as {
				kind?: string;
				id?: number;
				ok?: boolean;
				result?: unknown;
			};
			if (message.kind !== "result" || message.id !== 1) {
				reject(new Error("unexpected message"));
				return;
			}
			if (message.ok) resolvePromise(message.result);
			else reject(new Error("invoke failed"));
		});
		ws.send(JSON.stringify({ kind: "invoke", id: 1, channel, args }));
	});
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "tcode-bridge-"));
	writeRenderer();
	invokeRegistry.set("test:echo", (args) => ({ echo: args }));
});

afterEach(async () => {
	for (const ws of sockets.splice(0)) {
		try {
			ws.terminate();
		} catch {}
	}
	await service?.stop();
	service = null;
	base = "";
	rmSync(root, { recursive: true, force: true });
});

describe("web 桥口令闸门", () => {
	it("未授权一律 403 纯文本拒绝（no-store、无输入页、不含应用内容）；非 GET 405", async () => {
		await startListening();
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(403);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("content-type")).toContain("text/plain");
		const body = await res.text();
		expect(body).toContain("需要访问口令");
		expect(body).not.toContain("<form");
		expect(body).not.toContain("TCODE_APP_MARKER");

		expect((await fetch(`${base}/app.js`)).status).toBe(403);

		expect((await fetch(`${base}/api/auth`, { method: "POST" })).status).toBe(405);
	});

	it("配对与放行：?token= 换 Cookie（302 去参数保其余 query）；Cookie 可访问应用/资产/探测端点", async () => {
		await startListening();
		const token = service?.status().token ?? "";
		const pair = await fetch(`${base}/?token=${token}&keep=1`, { redirect: "manual" });
		expect(pair.status).toBe(302);
		expect(pair.headers.get("location")).toBe("/?keep=1");
		const jar = (pair.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

		const home = await fetch(`${base}/`, { headers: { cookie: jar } });
		expect(home.status).toBe(200);
		expect(await home.text()).toContain("TCODE_APP_MARKER");

		const asset = await fetch(`${base}/app.js`, { headers: { cookie: jar } });
		expect(asset.status).toBe(200);
		expect(await asset.text()).toContain("tcode-app-js");

		expect((await fetch(`${base}/api/auth-check`)).status).toBe(401);
		expect((await fetch(`${base}/api/auth-check`, { headers: { cookie: jar } })).status).toBe(204);

		expect((await fetch(`${base}/?token=old-rotated-token`)).status).toBe(403);
	});

	it("WS：无凭证 401 拒绝；?token= 与 Cookie 均可连接并完成 invoke 往返", async () => {
		await startListening();
		const token = service?.status().token ?? "";
		const wsUrl = `${base.replace("http", "ws")}/api/ws`;

		await expect(openWs(wsUrl)).rejects.toThrow(/401/);

		const byToken = await openWs(`${wsUrl}?token=${token}`);
		await expect(invokeOverWs(byToken, "test:echo", { hello: 1 })).resolves.toEqual({ echo: { hello: 1 } });
		byToken.close();

		const pair = await fetch(`${base}/?token=${token}`, { redirect: "manual" });
		const jar = (pair.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const byCookie = await openWs(wsUrl, { cookie: jar });
		await expect(invokeOverWs(byCookie, "test:echo", "x")).resolves.toEqual({ echo: "x" });
		byCookie.close();
	});

	it("重新生成口令：旧连接被 4401 断开、旧 Cookie 被拒（403）、新口令可配对", async () => {
		await startListening();
		const first = service?.status().token ?? "";
		const ws = await openWs(`${base.replace("http", "ws")}/api/ws?token=${first}`);
		const closed = new Promise<number>((resolvePromise) => {
			ws.once("close", (code) => resolvePromise(code));
		});

		const next = service?.regenerateToken();
		expect(next?.token).not.toBe(first);
		await expect(closed).resolves.toBe(4401);

		const withOldCookie = await fetch(`${base}/`, { headers: { cookie: `tcode_access_token=${first}` } });
		expect(withOldCookie.status).toBe(403);

		const pair = await fetch(`${base}/?token=${next?.token}`, { redirect: "manual" });
		expect(pair.status).toBe(302);
	});

	it("remote folder browser is authenticated and only returns folders", async () => {
		await startListening();
		const projects = join(root, "projects");
		mkdirSync(projects);
		mkdirSync(join(projects, "test-project"));
		writeFileSync(join(projects, "private.txt"), "do not list");
		const route = `${base}/api/project-folders?path=${encodeURIComponent(projects)}`;
		expect((await fetch(route)).status).toBe(403);
		const token = service?.status().token ?? "";
		const pair = await fetch(`${base}/?token=${token}`, { redirect: "manual" });
		const jar = (pair.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const res = await fetch(route, { headers: { cookie: jar } });
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const data = await res.json() as { current: string; folders: Array<{ name: string }> };
		expect(data.current).toBeTruthy();
		expect(data.folders.map((f) => f.name)).toContain("test-project");
		expect(data.folders.map((f) => f.name)).not.toContain("private.txt");
		const missing = await fetch(`${base}/api/project-folders?path=${encodeURIComponent(join(projects, "missing"))}`, { headers: { cookie: jar } });
		expect(missing.status).toBe(400);
	});

	it("creates a project directory only with cookie, same origin, and explicit JSON action", async () => {
		await startListening();
		const parent = join(root, "new-projects");
		mkdirSync(parent);
		const endpoint = `${base}/api/project-folders`;
		const payload = JSON.stringify({ parent, name: "New Project" });
		const token = service?.status().token ?? "";
		const pair = await fetch(`${base}/?token=${token}`, { redirect: "manual" });
		const cookie = (pair.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const validHeaders = { cookie, origin: base, "content-type": "application/json", "x-tcode-folder-action": "create" };
		const post = (headers: Record<string, string>, body = payload) =>
			fetch(endpoint, { method: "POST", headers, body });
		expect((await post({ origin: base, "content-type": "application/json", "x-tcode-folder-action": "create" })).status).toBe(403);
		expect((await post({ ...validHeaders, origin: "https://attacker.invalid" })).status).toBe(403);
		expect((await post({ ...validHeaders, "x-tcode-folder-action": "other" })).status).toBe(403);
		expect((await post({ ...validHeaders, "content-type": "text/plain" })).status).toBe(403);
		const created = await post(validHeaders);
		expect(created.status).toBe(201);
		const json = await created.json() as { path: string };
		expect(json.path).toContain("New Project");
		expect((await post(validHeaders)).status).toBe(409);
		expect((await post(validHeaders, JSON.stringify({ parent, name: "../escape" }))).status).toBe(400);
		expect((await post(validHeaders, JSON.stringify({ parent, name: "x".repeat(2500) }))).status).toBe(400);
		expect((await fetch(`${endpoint}?path=${encodeURIComponent(parent)}`, { headers: { cookie } })).status).toBe(200);
	});

	it("配置迁移：旧文件无 token → 补齐写回且跨重启稳定；损坏文件不覆写", async () => {
		const first = (
			await startService(JSON.stringify({ enabled: false, port: 1300, scope: "local" }))
		).status().token;
		expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
		const saved = JSON.parse(readFileSync(configFile(), "utf8")) as { token?: string; port?: number };
		expect(saved.token).toBe(first);
		expect(saved.port).toBe(1300);

		expect((await startService()).status().token).toBe(first);

		writeFileSync(configFile(), "{ not json");
		const third = (await startService()).status().token;
		expect(third).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(readFileSync(configFile(), "utf8")).toBe("{ not json");
	});
});
