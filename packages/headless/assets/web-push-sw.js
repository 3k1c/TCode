/* TCode Headless web push: independent from Pi and Electron. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = typeof data.title === "string" ? data.title.slice(0, 120) : "TCode";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "任務有新進度";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: "tcode-task-update",
    data: { url: "/" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (existing) { await existing.focus(); return; }
    await self.clients.openWindow("/");
  }));
});
