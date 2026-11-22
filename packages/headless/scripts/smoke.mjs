// End-to-end smoke test against a running headless server.
//   TCODE_TOKEN=... [TCODE_URL=http://127.0.0.1:1200] [TCODE_ORIGIN=https://host] node scripts/smoke.mjs
// TCODE_SMOKE_LIGHT=1 skips checks that leave data behind (sessions, checkpoints) - use it against a live deployment.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const TOKEN = process.env.TCODE_TOKEN;
if (!TOKEN) throw new Error("set TCODE_TOKEN");
const base = process.env.TCODE_URL || "http://127.0.0.1:1200";
const origin = process.env.TCODE_ORIGIN;
let failed = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
	if (!ok) failed++;
};

check("no token -> 401", (await fetch(`${base}/api/auth-check`)).status === 401);
check("token -> 204", (await fetch(`${base}/api/auth-check?token=${TOKEN}`)).status === 204);
const r = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
const cookie = r.headers.get("set-cookie")?.split(";")[0];
check("token -> cookie + redirect", r.status === 302 && !!cookie);
const html = await (await fetch(`${base}/`, { headers: { cookie } })).text();
check("renderer served", html.includes('id="root"'));

const wsUrl = `${base.replace(/^http/, "ws")}/api/ws`;
const ws = new WebSocket(wsUrl, { headers: { cookie, ...(origin ? { origin } : {}) } });
await new Promise((res, rej) => (ws.on("open", res), ws.on("error", rej)));
let n = 0;
const pending = new Map();
let ptyOut = "";
ws.on("message", (d) => {
	const m = JSON.parse(d.toString());
	if (m.kind === "result") pending.get(m.id)?.(m);
	else if (m.kind === "event" && m.channel === "pty:data") ptyOut += m.payload.data;
});
const call = (channel, args) =>
	new Promise((res) => {
		const id = ++n;
		pending.set(id, res);
		ws.send(JSON.stringify({ kind: "invoke", id, channel, args }));
		setTimeout(() => res({ ok: false, error: { message: "timeout" } }), 20000);
	});

const proj = mkdtempSync(join(tmpdir(), "tcode-smoke-"));
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: proj });
execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: proj });
writeFileSync(join(proj, "f.txt"), "one\n");

check("web-access settings locked", (await call("webAccess:setScope", { scope: "local" })).ok === false);
check("list sessions", (await call("session:listAll")).ok);
const light = process.env.TCODE_SMOKE_LIGHT === "1";
if (!light) check("create session", (await call("session:create", { options: { cwd: proj } })).ok);
check("git branches", (await call("project:listGitBranches", { cwd: proj })).result?.current === "main");
if (!light) {
	const sid = `smoke-${Date.now()}`;
	check("checkpoint 1", (await call("checkpoint:create", { sessionId: sid, cwd: proj, message: "cp1" })).ok);
	writeFileSync(join(proj, "f.txt"), "two\n");
	const cp2 = await call("checkpoint:create", { sessionId: sid, cwd: proj, message: "cp2" });
	check("checkpoint 2", cp2.ok);
	const list = await call("checkpoint:list", { sessionId: sid, cwd: proj });
	const first = list.result?.[list.result.length - 1] ?? list.result?.[0];
	const restore = first ? await call("checkpoint:restore", { sessionId: sid, cwd: proj, sha: first.sha }) : { ok: false };
	check("checkpoint restore", restore.ok && restore.result?.changed === true);
}
const pty = await call("pty:create", { cwd: proj, cols: 80, rows: 24 });
check("pty create", pty.ok);
if (pty.ok) {
	await call("pty:write", { id: pty.result.id, data: "echo PTY_OK_$((6*7))\n" });
	await new Promise((x) => setTimeout(x, 1500));
	check("pty echo", ptyOut.includes("PTY_OK_42"));
	await call("pty:kill", { id: pty.result.id });
}
ws.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
