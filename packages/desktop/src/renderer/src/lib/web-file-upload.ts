/** Upload a browser-local file to the authenticated TCode headless machine. */
export async function uploadWebFile(file: File): Promise<string> {
  if (!file.size) throw new Error("不能上載空白檔案");
  if (file.size > 20 * 1024 * 1024) throw new Error("單一檔案上限為 20 MiB");
  const parts = location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const prefix = parts[0] === "preview" && parts[1] ? "/preview/" + parts[1] : "";
  const response = await fetch(prefix + "/api/files", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/octet-stream",
      "x-tcode-upload": "1",
      "x-tcode-file-name": encodeURIComponent(file.name || "attachment"),
    },
    body: file,
  });
  const data: { path?: string; error?: string } = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.path !== "string") {
    throw new Error(data.error || ("檔案上載失敗（HTTP " + response.status + "）"));
  }
  return data.path;
}
