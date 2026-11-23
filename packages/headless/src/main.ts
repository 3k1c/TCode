import "./boot-env";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createLogger, initLogging, PiBackend, setCheckIgnoreOverride } from "@tcode/backend";
import { FEATURE_GATED_SKILLS, IpcChannels } from "@tcode/shared";
import { app } from "electron";
import { ensureBuiltinSkills, readSeededSkillBody, TCODE_RULES_SKILL } from "../../desktop/src/main/builtin-skills";
import { makeComponentBashTool } from "../../desktop/src/main/component-bash";
import { runComponentGit, setComponentRunnerProvider } from "../../desktop/src/main/component-bridge";
import { getDailyDir } from "../../desktop/src/main/daily";
import { registerIpc } from "../../desktop/src/main/ipc";
import { invokeRegistry } from "../../desktop/src/main/ipc/invoke";
import { loadUiPluginsConfig } from "../../desktop/src/main/ui-plugins/config";
import { UiPluginManager, uiPluginsResourcesDir } from "../../desktop/src/main/ui-plugins/manager";
import { WebBridgeService, broadcastBridgeEvent, hasBridgeClients, setBridgeExtensionHandler } from "../../desktop/src/main/web-bridge";
import { registerRemoteBrowserIpc } from "../../desktop/src/main/ipc/remote-browser";
import type { RemoteBrowserManager } from "../../desktop/src/main/remote-browser";
import { loadUiState } from "../../desktop/src/main/ui-state";
import { HeadlessBrowserManager } from "./chromium-browser";
import { makeHeadlessBrowserTool } from "./chromium-browser-tool";
import { setExternalTaskNotifier } from "../../desktop/src/main/task-notify";
import { HeadlessWebPush } from "./web-push";
import { APP_ROOT, DATA_DIR, RESOURCES_DIR } from "./boot-env";
import { LocalRunner } from "./local-runner";

const log = createLogger("headless");

function envInt(name: string, fallback: number): number {
	const v = Number(process.env[name]);
	return Number.isInteger(v) && v > 0 ? v : fallback;
}

/**
 * Write web-access.json (read by WebBridgeService.init) so the bridge is always enabled,
 * listens on 127.0.0.1 ("local", default) or all interfaces ("lan", used by the Docker image) and uses a stable token.
 * Token precedence: TCODE_TOKEN env -> existing file -> freshly generated (file mode 0600).
 */
function prepareWebAccessConfig(configPath: string, port: number, scope: "local" | "lan"): { token: string; generated: boolean } {
	let existing: { token?: unknown } = {};
	try {
		existing = JSON.parse(readFileSync(configPath, "utf8")) as typeof existing;
	} catch {}
	const fromEnv = process.env.TCODE_TOKEN?.trim();
	if (fromEnv && fromEnv.length < 16) throw new Error("TCODE_TOKEN must be at least 16 characters");
	const fromFile = typeof existing.token === "string" && existing.token.length >= 16 ? existing.token : null;
	const token = fromEnv || fromFile || randomBytes(24).toString("base64url");
	writeFileSync(configPath, JSON.stringify({ enabled: true, port, scope, token }, null, 2), {
		encoding: "utf8",
		mode: 0o600,
	});
	try {
		chmodSync(configPath, 0o600);
	} catch {}
	return { token, generated: !fromEnv && !fromFile };
}

async function main(): Promise<void> {
	mkdirSync(DATA_DIR, { recursive: true });
	initLogging(join(app.getPath("userData"), "logs"));
	log.info("headless boot", { version: app.getVersion(), dataDir: DATA_DIR, appRoot: APP_ROOT });

	// --- local component replacement (git / shell / pty) -------------------------------------
	const runner = new LocalRunner({ shell: process.env.TCODE_SHELL, gitPath: process.env.TCODE_GIT });
	setComponentRunnerProvider(() => runner as never);
	setCheckIgnoreOverride(async (cwd, rel) => {
		try {
			const { code } = await runComponentGit(["check-ignore", "-q", rel], cwd, { timeoutMs: 5000 });
			if (code === 0) return "ignored";
			if (code === 1) return "not-ignored";
			return "not-git";
		} catch {
			return "not-git";
		}
	});

	const seeded = ensureBuiltinSkills();
	if (seeded) log.info("builtin skills seeded", { path: seeded });

	// --- backend (Pi SDK) --------------------------------------------------------------------
	// No embedded browser in headless mode: browser-control tool/skills are gated off.
	const gates = { skills: new Set<string>(), tools: new Set<string>() };
	const browserManager = new HeadlessBrowserManager(broadcastBridgeEvent, hasBridgeClients);
	const warmFeatureGates = async () => {
		gates.skills.clear();
		for (const [skillName, feature] of Object.entries(FEATURE_GATED_SKILLS)) {
			if (feature === "browserControl") {
                if ((await loadUiState().catch(() => null))?.browserControl === false) gates.skills.add(skillName);
            }
			else if (feature === "crossSessionCollab") {
				if (backend.getChannelWatchConfig().enabled !== true) gates.skills.add(skillName);
			} else {
				const config = await loadUiPluginsConfig().catch(() => null);
				if (!config?.enabled) gates.skills.add(skillName);
			}
		}
		return gates;
	};

	const backend: PiBackend = new PiBackend({
		desktopIntegration: {
			appendSystemPrompt: () => {
				const body = readSeededSkillBody(TCODE_RULES_SKILL);
				return body ? [body] : [];
			},
			additionalSkillPaths: [join(uiPluginsResourcesDir(), "skills"), join(RESOURCES_DIR, "skills")],
		},
		customTools: [makeHeadlessBrowserTool(browserManager), makeComponentBashTool(process.cwd())],
		dailyDir: getDailyDir(),
		featureGates: { warm: warmFeatureGates, get: () => gates },
	});
	await backend.init();
	await warmFeatureGates();

	const uiPluginsManager = new UiPluginManager();
	await uiPluginsManager.init();

    // Push notifications are an optional headless-only service.
    const webPush = new HeadlessWebPush(DATA_DIR);
    setBridgeExtensionHandler((req, res, url) => webPush.handle(req, res, url));
    setExternalTaskNotifier((event) => webPush.notify(event));

	// --- web bridge (HTTP + WS) --------------------------------------------------------------
	const port = envInt("TCODE_PORT", 1200);
	const scope = process.env.TCODE_SCOPE === "lan" ? "lan" : "local";
	const configPath = join(app.getPath("userData"), "web-access.json");
	const { token, generated } = prepareWebAccessConfig(configPath, port, scope);
	const rendererDir = process.env.TCODE_RENDERER_DIR || join(APP_ROOT, "renderer");
	if (!existsSync(join(rendererDir, "index.html"))) {
		log.warn("renderer build not found", { rendererDir });
	}
	const webBridge = new WebBridgeService({ configPath, rendererDir, devUrl: "", defaultPort: port });
	await webBridge.init();
	const status = webBridge.status();
	log.info("web bridge", { listening: status.listening, port: status.port, scope: status.scope });
	if (!status.listening) throw new Error(`web bridge failed to listen on port ${port}`);

	// Session roots must exist on a fresh volume or the recursive session watcher stays off.
	const agentDir = process.env.PI_CODING_AGENT_DIR as string;
	for (const d of ["sessions", "sessions-subagents"]) mkdirSync(join(agentDir, d), { recursive: true });

	registerIpc(backend, uiPluginsManager, webBridge);
    // Override Electron offscreen IPC with the real Chromium adapter in Headless only.
    registerRemoteBrowserIpc(browserManager as unknown as RemoteBrowserManager);
    app.on("before-quit", () => browserManager.destroyAll());

	// Desktop-only / phone-home channels become inert stubs. The bridge settings are read-only here:
	// toggling them from the web page could lock the operator out.
	const stub = (channel: string, handler: (args: unknown) => unknown) => invokeRegistry.set(channel, handler);
	const locked = () => {
		throw new Error("web access settings are managed by the server operator (env / compose) in headless mode");
	};
	stub(IpcChannels.awaitAppBoot, () => Promise.resolve());
	stub(IpcChannels.pluginNotifyGet, () => []);
	stub(IpcChannels.pluginProfileGet, () => null);
	stub(IpcChannels.componentLicensesGet, () => []);
	stub(IpcChannels.updateDownload, () => ({ ok: false, error: "updates are not available in headless mode" }));
	stub(IpcChannels.updateInstall, () => undefined);
	stub(IpcChannels.pluginCommand, () => undefined);
	stub(IpcChannels.webAccessSetEnabled, locked);
	stub(IpcChannels.webAccessSetScope, locked);
	stub(IpcChannels.webAccessRegenerateToken, locked);

	// --- shutdown ----------------------------------------------------------------------------
	let stopping = false;
	const shutdown = async (signal: string) => {
		if (stopping) return;
		stopping = true;
		log.info("shutting down", { signal });
		const force = setTimeout(() => process.exit(1), 10_000);
		force.unref();
		try {
			app.emit("before-quit");
			await webBridge.stop();
			backend.dispose();
			uiPluginsManager.disposeWatcher();
			runner.stop();
		} catch (error) {
			log.error("shutdown error", (error as Error).message);
		}
		process.exit(0);
	};
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	console.log(`[tcode-headless] ready: http://${scope === "lan" ? "0.0.0.0" : "127.0.0.1"}:${status.port} (data: ${DATA_DIR})`);
	if (process.env.TCODE_PRINT_TOKEN === "1") {
		console.log(`[tcode-headless] access token: ${token}`);
	} else if (generated) {
		console.log(`[tcode-headless] a token was generated and stored in ${configPath} (mode 0600); set TCODE_PRINT_TOKEN=1 to print it`);
	}
}

process.on("unhandledRejection", (reason) => console.error("[tcode-headless] unhandledRejection", reason));

main().catch((error) => {
	console.error("[tcode-headless] fatal:", error);
	process.exit(1);
});
