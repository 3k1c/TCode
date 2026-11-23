import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadUiState } from "../../desktop/src/main/ui-state";
import { HeadlessBrowserManager } from "./chromium-browser";

const params = Type.Object({
  action: Type.Union([
    Type.Literal("list"), Type.Literal("open"), Type.Literal("read"),
    Type.Literal("reload"), Type.Literal("click"), Type.Literal("type"),
    Type.Literal("keys"), Type.Literal("scroll"), Type.Literal("hover"),
    Type.Literal("wait"), Type.Literal("screenshot"), Type.Literal("close"),
    Type.Literal("resize"), Type.Literal("script"), Type.Literal("cdp"), Type.Literal("console"),
  ]),
  tab_id: Type.Optional(Type.String({ description: "ID returned from list/open, or omit for latest tab" })),
  url: Type.Optional(Type.String()),
  new_tab: Type.Optional(Type.Boolean()),
  selector: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  index: Type.Optional(Type.Number()),
  submit: Type.Optional(Type.Boolean()),
  key: Type.Optional(Type.String()),
  modifiers: Type.Optional(Type.Array(Type.String())),
  dx: Type.Optional(Type.Number()),
  dy: Type.Optional(Type.Number()),
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  timeout: Type.Optional(Type.Number()),
  full_page: Type.Optional(Type.Boolean()),
  format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("html")])),
  code: Type.Optional(Type.String()),
  method: Type.Optional(Type.String()),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  clear: Type.Optional(Type.Boolean()),
  idle: Type.Optional(Type.Union([Type.Literal("load"), Type.Literal("network")])),
  all: Type.Optional(Type.Boolean()),
});

function limitText(text: string, max = 12000): string {
  return text.length > max ? text.slice(0, max) + "\n...[truncated]" : text;
}

export function makeHeadlessBrowserTool(browser: HeadlessBrowserManager) {
  return defineTool({
    name: "browser",
    label: "Browser",
    description: "Control the real Chromium browser in TCode Headless. Browser tabs share the side-pane browser engine. Use list to find tab IDs. Actions: list/open/read/reload/click/type/keys/scroll/hover/wait/screenshot/close/resize/script/cdp/console. The browser has its own persistent profile.",
    parameters: params,
    promptSnippet: 'browser({action:"list"|"open"|"read"|"click"|"type"|"screenshot"|..., tab_id?, url?, selector?, text?})',
    async execute(_id, p, _signal, _update, ctx) {
      const state = await loadUiState().catch(() => null);
      if (state?.browserControl === false) {
        return { content: [{ type: "text" as const, text: "Browser control is disabled in TCode settings." }], details: {} };
      }
      const output = async (): Promise<string> => {
        if (p.action === "list") {
          const tabs = browser.entries();
          return tabs.length ? tabs.map((t) => [t.id,t.active ? "active" : "paused",t.title,t.url].join(" | ")).join("\n") : "No browser tabs yet. Use open with a URL.";
        }
        if (p.action === "open" && p.url && (p.new_tab || !p.tab_id)) {
          const existing = p.new_tab ? undefined : browser.entries().filter((e) => e.active).at(-1);
          if (existing) {
            await browser.navigate(existing.id, p.url);
            return "Navigated active side-pane browser " + existing.id + " | " + p.url;
          }
          const id = await browser.create(p.url, 900, 650, 1);
          return "Opened browser tab " + id + " | " + p.url;
        }
        const tab = p.tab_id || browser.entries().at(-1)?.id;
        if (!tab) throw new Error("No browser tab. Use action=open and url first.");
        const page = browser.get(tab);
        switch (p.action) {
          case "open":
            if (!p.url) throw new Error("url required");
            await browser.navigate(tab, p.url);
            return "Navigated " + tab + " to " + page.url();
          case "reload":
            await page.reload({ waitUntil: "domcontentloaded", timeout: 18000 });
            await browser.capture(tab, true);
            return "Reloaded " + page.url();
          case "read": {
            const selected = p.selector ? page.locator(p.selector).first() : page.locator("body");
            const text = p.format === "html"
              ? await selected.evaluate((el) => el.outerHTML)
              : await selected.innerText({ timeout: 10000 });
            return limitText("Title: " + await page.title() + "\nURL: " + page.url() + "\n" + text);
          }
          case "click": {
            if (!p.selector) throw new Error("selector required for click");
            await page.locator(p.selector).nth(p.index ?? 0).click({ timeout: 8000 });
            await browser.capture(tab, true);
            return "Clicked " + p.selector;
          }
          case "type": {
            if (!p.selector || p.text === undefined) throw new Error("selector and text required");
            const locator = page.locator(p.selector).nth(p.index ?? 0);
            await locator.fill(p.text, { timeout: 8000 });
            if (p.submit) await locator.press("Enter");
            await browser.capture(tab, true);
            return "Typed into " + p.selector;
          }
          case "keys": {
            if (!p.key) throw new Error("key required");
            const modifiers = (p.modifiers ?? []).map((x) => ({ ctrl: "Control", alt: "Alt", shift: "Shift", meta: "Meta" })[x] ?? x);
            await page.keyboard.press([...modifiers, p.key].join("+"));
            await browser.capture(tab, true);
            return "Pressed " + p.key;
          }
          case "scroll":
            await page.mouse.wheel(p.dx ?? 0, p.dy ?? 500);
            await browser.capture(tab, true);
            return "Scrolled";
          case "hover":
            if (!p.selector) throw new Error("selector required");
            await page.locator(p.selector).nth(p.index ?? 0).hover({ timeout: 8000 });
            await browser.capture(tab, true);
            return "Hovered " + p.selector;
          case "wait":
            if (p.selector) {
              await page.locator(p.selector).first().waitFor({ timeout: Math.min(30000, p.timeout ?? 8000) });
            } else {
              await page.waitForLoadState(p.idle === "network" ? "networkidle" : "load", { timeout: Math.min(30000, p.timeout ?? 8000) });
            }
            return "Wait completed";
          case "screenshot": {
            const shot = await browser.screenshot(tab, p.full_page === true);
            const sessionId = String((ctx as { sessionManager?: {getSessionId?:()=>string} }).sessionManager?.getSessionId?.() ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
            const directory = join(process.env.TCODE_DATA_DIR || ".", "browser-shots", sessionId);
            mkdirSync(directory, { recursive: true });
            const file = join(directory, Date.now() + ".jpg");
            writeFileSync(file, shot);
            return "Screenshot saved: " + file + " (JPEG, " + shot.length + " bytes)";
          }
          case "resize":
            browser.resize(tab, p.width ?? 900, p.height ?? 650, 1);
            return "Resized browser tab";
          case "script": {
            if (!p.code) throw new Error("code required");
            const result = await browser.evaluate(tab, p.code);
            return limitText(JSON.stringify(result) ?? "undefined");
          }
          case "cdp": {
            if (!p.method || !/^[a-zA-Z]+\.[a-zA-Z][a-zA-Z0-9]+$/.test(p.method)) throw new Error("CDP method required");
            const cdp = await page.context().newCDPSession(page);
            try {
              const result = await cdp.send(p.method as never, (p.params ?? {}) as never);
              return limitText(JSON.stringify(result));
            } finally { await cdp.detach(); }
          }
          case "console":
            return limitText(JSON.stringify(browser.readConsole(tab, p.clear === true)));
          case "close":
            if (p.all) browser.destroyAll();
            else browser.destroy(tab);
            return "Browser tab closed";
          default:
            throw new Error("Unsupported action: " + p.action);
        }
      };
      try {
        const text = await output();
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (error) {
        return { content: [{ type: "text" as const, text: "Browser error: " + (error as Error).message }], details: {} };
      }
    },
  });
}
