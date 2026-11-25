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

const visionTypes: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/bmp": "bmp", "image/avif": "avif",
};

export async function uploadPromptImages(images: {data: string; mimeType: string}[]) {
  if (images.length > 16) throw new Error("At most 16 images per message");
  const refs: {name: string; mimeType: string}[] = [];
  let total = 0;
  for (const image of images) {
    if (!Object.hasOwn(visionTypes, image.mimeType)) throw new Error("Unsupported image type");
    const size = Math.floor(image.data.length * 3 / 4);
    total += size;
    if (size > 20 * 1024 * 1024 + 2 || total > 40 * 1024 * 1024 + 32) throw new Error("Images exceed the upload limit");
    const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
    const path = await uploadWebFile(new File([bytes], "vision." + visionTypes[image.mimeType], {type: image.mimeType}));
    refs.push({name: path.split(/[\\/]/).pop()!, mimeType: image.mimeType});
  }
  return refs;
}
