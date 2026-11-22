// Bundle the headless server: desktop main-process modules + backend + LocalRunner, with `electron` aliased to a shim.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const desktop = join(root, "packages/desktop");
const dist = join(here, "dist");

// Fail early if the shim misses a named export the desktop sources import from "electron".
const shimSrc = readFileSync(join(here, "src/electron-shim.ts"), "utf8");
const shimNames = new Set([...shimSrc.matchAll(/export (?:const|class|function) (\w+)/g)].map((m) => m[1]));
const needed = new Set();
const walk = (dir) => {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p);
		else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) {
			const src = readFileSync(p, "utf8");
			for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"electron"/g))
				for (const part of m[1].split(",")) {
					const n = part.trim().replace(/^type\s+.*/, "").split(/\s+as\s+/)[0].trim();
					if (n) needed.add(n);
				}
		}
	}
};
walk(join(desktop, "src/main"));
const missing = [...needed].filter((n) => !shimNames.has(n));
if (missing.length) {
	console.error(`electron shim is missing exports: ${missing.join(", ")}`);
	process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
	entryPoints: [join(here, "src/main.ts")],
	outfile: join(dist, "server.mjs"),
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	sourcemap: "linked",
	minify: false,
	alias: {
		electron: join(here, "src/electron-shim.ts"),
		"@tcode/backend": join(root, "packages/backend/src/index.ts"),
		"@tcode/shared": join(root, "packages/shared/src/index.ts"),
	},
	external: [
		"@earendil-works/*",
		"ws",
		"node-pty",
		"esbuild",
		"typebox",
		"fsevents",
		"bufferutil",
		"utf-8-validate",
	],
	define: {
		__COMPONENT_SHA256__: '""',
		__DEV_BUILD__: "false",
	},
	banner: {
		js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
	},
	logLevel: "info",
});

cpSync(join(desktop, "resources/ui-plugins"), join(dist, "resources/ui-plugins"), { recursive: true });
cpSync(join(desktop, "resources/skills"), join(dist, "resources/skills"), { recursive: true });

const renderer = join(desktop, "out/renderer");
if (existsSync(join(renderer, "index.html"))) {
	const headlessRenderer = join(dist, "renderer");
	cpSync(renderer, headlessRenderer, { recursive: true });

	// Headless web shortcut / home-screen icon only; leave Electron artwork unchanged.
	cpSync(join(here, "assets/web-icons"), join(headlessRenderer, "icons"), { recursive: true });
	const indexPath = join(headlessRenderer, "index.html");
	const html = readFileSync(indexPath, "utf8");
	if (!html.includes("</head>")) throw new Error("headless icon injection: HTML head not found");
	const iconLinks = [
		'<meta name="theme-color" content="#ffffff">',
		'<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">',
		'<link rel="icon" type="image/png" sizes="48x48" href="/icons/favicon-48.png">',
		'<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">',
		'<link rel="manifest" href="/icons/manifest.json">',
	].join("\n    ");
	writeFileSync(indexPath, html.replace("</head>", `    ${iconLinks}\n  </head>`), "utf8");
} else {
	console.warn("! desktop/out/renderer not found — run `npm run build -w packages/desktop` first");
}

cpSync(join(here, "scripts/smoke.mjs"), join(dist, "smoke.mjs"));

writeFileSync(
	join(dist, "package.json"),
	JSON.stringify({ name: "tcode-headless-dist", private: true, type: "module" }, null, 2),
);
console.log("headless build ready:", dist);
