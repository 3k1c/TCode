import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { resolveWorkspacePath } from "./fs-read";

/** Browser-selected files are not paths. Receive bytes over an authenticated endpoint. */
export const WEB_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export async function handleWebFileUpload(
  req: IncomingMessage,
  res: ServerResponse,
  dataDir: string,
): Promise<void> {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  const fail = (status: number, error: string) => {
    if (!res.headersSent) res.writeHead(status, headers).end(JSON.stringify({ error }));
  };
  try {
    const rawName = req.headers["x-tcode-file-name"];
    if (typeof rawName !== "string" || rawName.length > 512) {
      fail(400, "Missing or invalid file name");
      return;
    }
    const decoded = decodeURIComponent(rawName);
    // Windows and POSIX separators, reserved characters and control characters are forbidden.
    const name = decoded.replace(/[\\/<>:"|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100);
    if (!name || name === "." || name === "..") {
      fail(400, "Invalid file name");
      return;
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > WEB_UPLOAD_MAX_BYTES) {
      fail(413, "File exceeds 20 MiB limit");
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const part of req) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      bytes += chunk.length;
      if (bytes > WEB_UPLOAD_MAX_BYTES) {
        fail(413, "File exceeds 20 MiB limit");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    if (req.aborted) return;
    if (bytes === 0) {
      fail(400, "Empty file");
      return;
    }
    const dir = join(dataDir, "uploads");
    await mkdir(dir, { recursive: true });
    const file = join(dir, randomUUID() + "-" + name);
    await writeFile(file, Buffer.concat(chunks), { flag: "wx", mode: 0o600 });
    res.writeHead(201, headers).end(JSON.stringify({ path: file, name, bytes }));
  } catch {
    fail(400, "File upload failed");
  }
}

const visionTypes: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/bmp": "bmp", "image/avif": "avif",
};

/** Only resolve server-issued upload names, never arbitrary client paths. */
export async function hydrateWebPromptImages(args: unknown, dataDir: string): Promise<unknown> {
  if (!args || typeof args !== "object" || !("webImageRefs" in args)) return args;
  const { webImageRefs, ...rest } = args as Record<string, unknown>;
  if (!Array.isArray(webImageRefs) || webImageRefs.length > 16 || rest.images !== undefined) throw new Error("Invalid uploaded images");
  let total = 0;
  const images = [];
  for (const ref of webImageRefs) {
    const { name, mimeType } = ref ?? {};
    if (typeof name !== "string" || typeof mimeType !== "string" ||
      !Object.hasOwn(visionTypes, mimeType) ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-vision\.(png|jpg|webp|gif|bmp|avif)$/i.test(name) ||
      !name.endsWith("." + visionTypes[mimeType])) throw new Error("Invalid uploaded image reference");
    const file = await resolveWorkspacePath(join(dataDir, "uploads"), name);
    const info = await stat(file);
    total += info.size;
    if (!info.isFile() || !info.size || info.size > WEB_UPLOAD_MAX_BYTES || total > 40 * 1024 * 1024) throw new Error("Uploaded images exceed size limit");
    images.push({ mimeType, data: (await readFile(file)).toString("base64") });
  }
  return { ...rest, images };
}
