import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const renderer = join(process.cwd(), "src", "renderer");
const html = readFileSync(join(renderer, "index.html"), "utf8");
const main = readFileSync(join(renderer, "src", "main.tsx"), "utf8");
const app = readFileSync(join(renderer, "src", "App.tsx"), "utf8");

describe("direct startup without splash animation", () => {
	it("loads the app without adding a splash overlay or stylesheet", () => {
		expect(html).not.toContain("splash-dom.ts");
		expect(html).not.toContain("styles/splash.css");
		expect(html).toContain("/src/main.tsx");
	});
	it("does not block the first render behind splash timers", () => {
		expect(main).not.toContain("initSplash");
		expect(app).not.toContain("finishSplash");
	});
	it("removes unused animation sources", () => {
		expect(existsSync(join(renderer, "src", "splash.ts"))).toBe(false);
		expect(existsSync(join(renderer, "src", "splash-dom.ts"))).toBe(false);
		expect(existsSync(join(renderer, "src", "styles", "splash.css"))).toBe(false);
	});
});
