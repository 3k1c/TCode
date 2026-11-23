import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import * as webPush from "web-push";
import type { TaskNotification } from "@tcode/shared";

interface SavedSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}
interface PushState {
  publicKey: string;
  privateKey: string;
  subscriptions: SavedSubscription[];
}
type JsonRecord = Record<string, unknown>;
const MAX_SUBSCRIPTIONS = 20;
const MAX_REQUEST_BYTES = 8192;

function trustedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || endpoint.length > 4096) return false;
    const host = url.hostname.toLowerCase();
    return [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "push.services.mozilla.com",
      "web.push.apple.com",
    ].includes(host) || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
  } catch { return false; }
}

function parseSubscription(value: unknown): SavedSubscription | null {
  if (!value || typeof value !== "object") return null;
  const item = value as JsonRecord;
  if (typeof item.endpoint !== "string" || !trustedEndpoint(item.endpoint)) return null;
  const keys = item.keys as JsonRecord | undefined;
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{12,64}$/.test(keys.auth)) return null;
  return { endpoint: item.endpoint, expirationTime: null, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const item of req) {
    const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item);
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export class HeadlessWebPush {
  private state: PushState;
  private file: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "web-push.json");
    let saved: PushState | undefined;
    try { saved = JSON.parse(readFileSync(this.file, "utf8")) as PushState; } catch {}
    if (saved && typeof saved.publicKey === "string" && typeof saved.privateKey === "string") {
      this.state = { ...saved, subscriptions: Array.isArray(saved.subscriptions)
        ? saved.subscriptions.map(parseSubscription).filter((x): x is SavedSubscription => x !== null).slice(-MAX_SUBSCRIPTIONS)
        : [] };
    } else {
      const keys = webPush.generateVAPIDKeys();
      this.state = { ...keys, subscriptions: [] };
      this.save();
    }
    webPush.setVapidDetails("https://tcode.kovami.app", this.state.publicKey, this.state.privateKey);
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  private response(res: ServerResponse, status: number, body: JsonRecord): void {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    }).end(JSON.stringify(body));
  }

  /** Called only after WebBridge's cookie+CSRF validation. */
  handle(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (url.pathname === "/api/push/key" && req.method === "GET") {
      this.response(res, 200, { publicKey: this.state.publicKey, subscribedDevices: this.state.subscriptions.length });
      return;
    }
    if (url.pathname === "/api/push/subscription" && req.method === "POST") {
      void jsonBody(req).then((body) => {
        const sub = parseSubscription(body);
        if (!sub) { this.response(res, 400, { error: "Invalid push subscription" }); return; }
        this.state.subscriptions = [...this.state.subscriptions.filter((x) => x.endpoint !== sub.endpoint), sub].slice(-MAX_SUBSCRIPTIONS);
        this.save();
        this.response(res, 201, { ok: true });
      }).catch(() => this.response(res, 400, { error: "Invalid subscription request" }));
      return;
    }
    if (url.pathname === "/api/push/subscription" && req.method === "DELETE") {
      void jsonBody(req).then((body) => {
        const endpoint = (body as JsonRecord | null)?.endpoint;
        if (typeof endpoint !== "string") { this.response(res, 400, { error: "Missing endpoint" }); return; }
        this.state.subscriptions = this.state.subscriptions.filter((s) => s.endpoint !== endpoint);
        this.save();
        this.response(res, 200, { ok: true });
      }).catch(() => this.response(res, 400, { error: "Invalid unsubscribe request" }));
      return;
    }
    if (url.pathname === "/api/push/test" && req.method === "POST") {
      void this.send({ title: "TCode", body: "網頁推播測試成功", url: "/" }).then((sent) =>
        this.response(res, sent ? 200 : 409, { sent, subscribedDevices: this.state.subscriptions.length }),
      ).catch(() => this.response(res, 502, { error: "Push provider unavailable" }));
      return;
    }
    this.response(res, 404, { error: "Not found" });
  }

  async send(message: { title: string; body: string; url: string }): Promise<number> {
    let sent = 0;
    const obsolete = new Set<string>();
    await Promise.all(this.state.subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification(sub, JSON.stringify(message), { TTL: 3600, urgency: "normal" });
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) obsolete.add(sub.endpoint);
        else console.warn("[web-push] delivery failed", status ?? "unknown");
      }
    }));
    if (obsolete.size > 0) {
      this.state.subscriptions = this.state.subscriptions.filter((s) => !obsolete.has(s.endpoint));
      this.save();
    }
    return sent;
  }

  notify(event: TaskNotification): void {
    const labels = { done: "任務完成", attention: "需要確認", error: "發生錯誤" };
    const title = event.sessionName + " · " + labels[event.kind];
    const body = (event.detail?.trim() || labels[event.kind]).slice(0, 180);
    // No account tokens, local file paths or request contents in notification URLs.
    void this.send({ title, body, url: "/" }).catch((e) =>
      console.warn("[web-push] notify error", String(e)),
    );
  }
}
