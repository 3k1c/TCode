import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.TCODE_URL;
const token = process.env.TCODE_TOKEN;
if (!base || !token) throw new Error("TCODE_URL and TCODE_TOKEN required");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const categories = ["models", "general", "mcp", "extensions", "archive", "update", "about"];
try {
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 641, isMobile: viewport.width < 641 });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(25000);
      await page.goto(base + "/?token=" + encodeURIComponent(token));
      const trigger = page.locator("[data-model-picker-trigger]");
      await trigger.waitFor({ state: "visible" });
      await trigger.click();
      const popup = page.locator("[data-model-picker-popup]");
      await popup.waitFor({ state: "visible" });
      const a = popup.locator('[data-model-key="ui-smoke/ui-model-a"]');
      const b = popup.locator('[data-model-key="ui-smoke/ui-model-b"]');
      await a.waitFor({ state: "visible" });
      const rect = await popup.boundingBox();
      const innerWidth = await page.evaluate(() => window.innerWidth);
      const innerHeight = await page.evaluate(() => window.innerHeight);
      assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= innerWidth + 1 && rect.y + rect.height <= innerHeight + 1, "model popup outside viewport");
      await b.click();
      await page.waitForFunction(() => document.querySelector("[data-model-picker-trigger]")?.textContent?.includes("UI Model B"));
      await a.click();
      await page.waitForFunction(() => document.querySelector("[data-model-picker-trigger]")?.textContent?.includes("UI Model A"));
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "detached" });
      console.log("PASS model picker and model switching at " + viewport.width + "px");

      for (const category of categories) {
        const settingsEntry = page.locator("[data-settings-open]").first();
        if (!(await settingsEntry.isVisible())) await page.locator("[data-sidebar-toggle]").click();
        await settingsEntry.click();
        const panel = page.locator("[data-settings-page]");
        await panel.waitFor({ state: "visible" });
        const select = page.locator("[data-settings-category]");
        if (await select.isVisible()) await select.selectOption(category);
        else {
          // Desktop settings navigation uses the same category store.
          await page.locator('[data-settings-category-link="' + category + '"]').click();
        }
        const back = page.locator("[data-settings-back]");
        await back.click();
        await panel.waitFor({ state: "detached" });
        await trigger.waitFor({ state: "visible" });
        console.log("PASS settings " + category + " returns to chat at " + viewport.width + "px");
      }
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
