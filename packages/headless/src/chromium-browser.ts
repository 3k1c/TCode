/**
 * Chromium-backed implementation of TCode's existing remoteBrowser IPC contract.
 * Unlike Electron's offscreen BrowserWindow it runs on plain Windows Node.
 * The UI and Pi browser tool share this one browser context and page collection.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { IpcChannels, type RemoteBrowserInputEvent, type RemoteBrowserStatus } from "@tcode/shared";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const MAX_WIDTH = 2000;
const MAX_HEIGHT = 1600;
const MAX_TABS = 8;
const SHOT_INTERVAL_MS = 600;

interface BrowserTab {
  id: string;
  page: Page;
  active: boolean;
  title: string;
  url: string;
  scale: number;
  width: number;
  height: number;
  busy: boolean;
  logs: Array<{level:string; text:string}>;
  timer: ReturnType<typeof setInterval> | null;
}

function chromeExecutable(): string {
  const candidates = [
    process.env.TCODE_BROWSER_EXECUTABLE,
    process.platform === "win32" ? join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe") : "",
    process.platform === "win32" ? join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe") : "",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error("No Chromium browser installed. Install Google Chrome or set TCODE_BROWSER_EXECUTABLE.");
  }
  return found;
}

function safeUrl(raw: string): string {
  if (!raw || raw === "about:blank") return "about:blank";
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Browser permits HTTP and HTTPS addresses only.");
  }
  return url.href;
}

function clamp(value: number, lower: number, upper: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(upper, Math.max(lower, Math.round(value))) : fallback;
}

function keyName(name: string): string {
  const keys: Record<string,string> = {
    Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown",
    Esc: "Escape", Return: "Enter", PageUp: "PageUp", PageDown: "PageDown",
    Space: " ",
  };
  return keys[name] || name;
}

export class HeadlessBrowserManager {
  private context: BrowserContext | null = null;
  private contextPromise: Promise<BrowserContext> | null = null;
  private tabs = new Map<string, BrowserTab>();
  private inputQueues = new Map<string, Promise<void>>();
  private profile = join(process.env.TCODE_DATA_DIR || join(homedir(), ".tcode-headless"), "chromium-profile");

  constructor(
    private readonly emit: (channel: string, payload: unknown) => void,
    private readonly hasClients: () => boolean,
  ) {}

  async start(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.contextPromise) return this.contextPromise;
    this.contextPromise = (async () => {
      mkdirSync(this.profile, { recursive: true });
      const context = await chromium.launchPersistentContext(this.profile, {
        executablePath: chromeExecutable(),
        headless: true,
        viewport: { width: 900, height: 650 },
        deviceScaleFactor: 1,
        acceptDownloads: false,
        args: ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
      });
      this.context = context;
      context.on("close", () => {
        this.context = null;
        for (const entry of this.tabs.values()) if (entry.timer) clearInterval(entry.timer);
        this.tabs.clear();
      });
      return context;
    })();
    try {
      return await this.contextPromise;
    } finally {
      this.contextPromise = null;
    }
  }

  entries(): Array<{id:string; url:string; title:string; active:boolean}> {
    return Array.from(this.tabs.values()).map((tab) => ({
      id: tab.id, url: tab.url, title: tab.title, active: tab.active,
    }));
  }

  get(id: string): Page {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error("Browser tab not found: " + id);
    return tab.page;
  }

  readConsole(id: string, clear = false): Array<{level:string; text:string}> {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error("Browser tab not found: " + id);
    const result = [...tab.logs];
    if (clear) tab.logs.length = 0;
    return result;
  }

  private emitStatus(entry: BrowserTab): void {
    if (entry.page.isClosed()) return;
    entry.url = entry.page.url();
    this.emit(IpcChannels.RemoteBrowserStatusChanged, {
      id: entry.id, status: { url: entry.url, title: entry.title },
    });
  }

  private async refreshTitle(entry: BrowserTab): Promise<void> {
    if (entry.page.isClosed()) return;
    entry.title = await entry.page.title().catch(() => entry.title);
    this.emitStatus(entry);
  }

  async capture(id: string, always = false): Promise<Buffer | null> {
    const entry = this.tabs.get(id);
    if (!entry || entry.page.isClosed() || entry.busy) return null;
    if (!always && (!entry.active || !this.hasClients())) return null;
    entry.busy = true;
    try {
      const buffer = await entry.page.screenshot({ type: "jpeg", quality: 65, timeout: 6000, animations: "disabled" });
      if (this.hasClients()) {
        this.emit(IpcChannels.RemoteBrowserFrame, {
          id, dataUrl: "data:image/jpeg;base64," + buffer.toString("base64"),
        });
      }
      return buffer;
    } catch {
      return null;
    } finally {
      entry.busy = false;
    }
  }

  async create(url: string, width: number, height: number, scale = 1): Promise<string> {
    if (this.tabs.size >= MAX_TABS) throw new Error("Maximum " + MAX_TABS + " browser tabs");
    const context = await this.start();
    const page = await context.newPage();
    const id = randomUUID();
    const s = clamp(scale, 1, 2, 1);
    const w = clamp(width * s, MIN_WIDTH, MAX_WIDTH, 900);
    const h = clamp(height * s, MIN_HEIGHT, MAX_HEIGHT, 650);
    const tab: BrowserTab = {
      id, page, active: true, title: "", url: "about:blank", scale: s,
      width: w, height: h, busy: false, logs: [], timer: null,
    };
    this.tabs.set(id, tab);
    await page.setViewportSize({ width: w, height: h });
    const signal = () => {
      void this.refreshTitle(tab);
      void this.capture(id);
    };
    page.on("console", (msg) => {
      tab.logs.push({ level: msg.type(), text: msg.text().slice(0, 2000) });
      if (tab.logs.length > 100) tab.logs.shift();
    });
    page.on("pageerror", (error) => {
      tab.logs.push({ level: "error", text: error.message.slice(0, 2000) });
      if (tab.logs.length > 100) tab.logs.shift();
    });
    page.on("domcontentloaded", signal);
    page.on("load", signal);
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) signal(); });
    page.on("close", () => this.destroy(id));
    tab.timer = setInterval(() => void this.capture(id), SHOT_INTERVAL_MS);
    tab.timer.unref?.();
    // Return the ID before slow sites complete loading, as with Electron loadURL.
    if (url) {
      void page.goto(safeUrl(url), { waitUntil: "commit", timeout: 15000 })
        .then(() => signal())
        .catch((error) => {
          console.warn("[chromium-browser] navigation failed", String(error));
          signal();
        });
    }
    setTimeout(() => void this.capture(id), 250).unref?.();
    return id;
  }

  resize(id: string, width: number, height: number, scale?: number): void {
    const entry = this.tabs.get(id);
    if (!entry) return;
    if (scale && scale > 0) entry.scale = clamp(scale, 1, 2, 1);
    entry.width = clamp(width * entry.scale, MIN_WIDTH, MAX_WIDTH, entry.width);
    entry.height = clamp(height * entry.scale, MIN_HEIGHT, MAX_HEIGHT, entry.height);
    void entry.page.setViewportSize({ width: entry.width, height: entry.height })
      .then(() => this.capture(id)).catch(() => {});
  }

  input(id: string, event: RemoteBrowserInputEvent): Promise<void> {
    const entry = this.tabs.get(id);
    if (!entry) return Promise.resolve();
    const page = entry.page;
    const x = "x" in event ? Number(event.x) : 0;
    const y = "y" in event ? Number(event.y) : 0;
    const go = async () => {
      switch (event.type) {
        case "mouseMove": await page.mouse.move(x, y); break;
        case "mouseDown":
          await page.mouse.move(x, y);
          await page.mouse.down({ button: event.button === "right" ? "right" : "left" });
          break;
        case "mouseUp":
          await page.mouse.move(x, y);
          await page.mouse.up({ button: event.button === "right" ? "right" : "left" });
          break;
        case "mouseWheel": await page.mouse.wheel(event.deltaX ?? 0, event.deltaY ?? 0); break;
        case "keyDown":
          if (event.keyCode.length === 1) {
            // Text is committed by the subsequent char event.
            return;
          }
          await page.keyboard.down(keyName(event.keyCode));
          break;
        case "keyUp":
          if (event.keyCode.length > 1) await page.keyboard.up(keyName(event.keyCode));
          break;
        case "char": await page.keyboard.insertText(event.keyCode); break;
      }
    };
    const previous = this.inputQueues.get(id) ?? Promise.resolve();
    const result = previous.then(go);
    this.inputQueues.set(id, result.catch(() => {}));
    void result.then(() => {
      if (event.type !== "mouseMove") void this.capture(id);
    }).catch((error) => console.warn("[chromium-browser] input", String(error)));
    return result;
  }

  setActive(id: string, active: boolean): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.active = active;
    if (active) void this.capture(id, true);
  }

  status(id: string): RemoteBrowserStatus {
    const entry = this.tabs.get(id);
    return entry ? { url: entry.page.url(), title: entry.title } : { url: "", title: "" };
  }

  async evaluate(id: string, code: string): Promise<unknown> {
    const page = this.get(id);
    // Electron executeJavaScript accepts expressions and statements.
    try { return await page.evaluate(code); }
    catch (error) {
      if (/Illegal return statement|Unexpected token 'return'/.test(String(error))) {
        return await page.evaluate("(async () => { " + code + " })()");
      }
      throw error;
    }
  }

  async navigate(id: string, url: string): Promise<void> {
    const entry = this.tabs.get(id);
    if (!entry) throw new Error("Browser tab not found");
    await entry.page.goto(safeUrl(url), { waitUntil: "domcontentloaded", timeout: 20000 });
    await this.refreshTitle(entry);
    await this.capture(id, true);
  }

  async screenshot(id: string, fullPage = false): Promise<Buffer> {
    return this.get(id).screenshot({ type: "jpeg", quality: 75, fullPage, timeout: 15000 });
  }

  destroy(id: string): void {
    const entry = this.tabs.get(id);
    if (!entry) return;
    this.tabs.delete(id);
    this.inputQueues.delete(id);
    if (entry.timer) clearInterval(entry.timer);
    if (!entry.page.isClosed()) void entry.page.close().catch(() => {});
  }

  destroyAll(): void {
    for (const id of [...this.tabs.keys()]) this.destroy(id);
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => {});
  }
}
