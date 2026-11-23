import { useEffect, useState } from "react";

const supported = () =>
  typeof window !== "undefined" && window.isSecureContext &&
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function pushRequest(path: string, body?: unknown, method = "GET"): Promise<any> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: method === "GET" ? undefined : { "content-type": "application/json", "x-tcode-push": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "推播服務沒有回應");
  return result;
}

function decodeVapidKey(value: string): ArrayBuffer {
  const normalized = (value + "=".repeat((4 - value.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return data.buffer;
}

/** Browser permission is requested only from an explicit user click. */
export function WebPushControls() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const available = supported();

  useEffect(() => {
    if (!available) return;
    void navigator.serviceWorker.getRegistration("/").then(async (reg) => {
      setEnabled(Boolean(await reg?.pushManager.getSubscription()));
    }).catch(() => {});
  }, [available]);

  const action = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (enabled) {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await pushRequest("/api/push/subscription", { endpoint: sub.endpoint }, "DELETE");
          await sub.unsubscribe();
        }
        setEnabled(false);
        setMessage("這部裝置已停用推播");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("瀏覽器未授予通知權限");
        const data = await pushRequest("/api/push/key");
        await navigator.serviceWorker.register("/tcode-push-sw.js", { scope: "/" });
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: decodeVapidKey(data.publicKey),
          });
        }
        await pushRequest("/api/push/subscription", sub.toJSON(), "POST");
        setEnabled(true);
        setMessage("已啟用，即使關閉網頁也可收到任務通知");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setMessage("");
    try {
      const data = await pushRequest("/api/push/test", {}, "POST");
      setMessage(data.sent > 0 ? "已交付推播服務，請查看裝置通知" : "沒有可用的推播裝置");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "測試失敗");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-[11px] leading-relaxed text-ink-faint">
        網頁推播：任務完成、需要批准或發生錯誤時通知。每部裝置須自行啟用。
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!available || busy}
          className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-ink hover:bg-hover disabled:opacity-40"
          onClick={() => void action()}>
          {busy ? "處理中…" : enabled ? "停用此裝置推播" : "啟用此裝置推播"}
        </button>
        {enabled && (
          <button type="button" disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-ink-2 hover:bg-hover disabled:opacity-40"
            onClick={() => void test()}>測試推播</button>
        )}
      </div>
      {!available && <p className="text-[11px] text-ink-faint">此瀏覽器不支援推播，或不是安全 HTTPS 連線。</p>}
      {message && <p role="status" className="text-[11px] text-ink-2">{message}</p>}
    </div>
  );
}
