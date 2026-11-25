import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { getAgentDir, resizeImage } from "@earendil-works/pi-coding-agent";
import { resolveWorkspacePath } from "./fs-read";
import { resolvePathTarget } from "./path-target";

const images: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif",
};

export async function resolveWebArtifact(cwd: string, sessionId: string, target: string, agentDir = getAgentDir(), uploadsDir?: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !target || target.includes("\0")) throw new Error("Invalid file");
  const absolute = resolvePathTarget(target, cwd);
  try {
    return await resolveWorkspacePath(cwd, absolute);
  } catch {
    try {
      return await resolveWorkspacePath(join(agentDir, "generated-images", sessionId), absolute);
    } catch (error) {
      if (!uploadsDir || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-.+/i.test(basename(absolute))) throw error;
      const uploaded = await resolveWorkspacePath(uploadsDir, absolute);
      if (basename(uploaded) !== basename(absolute)) throw error;
      return uploaded;
    }
  }
}

const thumbnails = new Map<string, { bytes: Buffer; type: string }>();
const MAX_THUMBNAILS = 64;
const MAX_THUMB_INPUT = 32 * 1024 * 1024;

export async function sendWebArtifact(res: ServerResponse, cwd: string, sessionId: string, target: string, preview: boolean, thumbnail = false, metadata = false, uploadsDir?: string): Promise<void> {
  try {
    const file = await resolveWebArtifact(cwd, sessionId, target, getAgentDir(), uploadsDir);
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    const imageType = images[extname(file).toLowerCase()];
    if (metadata) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" })
        .end(JSON.stringify({ name: basename(file), size: info.size }));
      return;
    }
    if (thumbnail) {
      if (!imageType || info.size > MAX_THUMB_INPUT) {
        res.writeHead(415, { "cache-control": "no-store" }).end();
        return;
      }
      const key = file + ":" + info.size + ":" + info.mtimeMs;
      let thumb = thumbnails.get(key);
      if (!thumb) {
        const resized = await resizeImage(await readFile(file), imageType, { maxWidth: 480, maxHeight: 320, maxBytes: 180 * 1024 });
        if (!resized) { res.writeHead(415, { "cache-control": "no-store" }).end(); return; }
        thumb = { bytes: Buffer.from(resized.data, "base64"), type: resized.mimeType };
        if (thumbnails.size >= MAX_THUMBNAILS) thumbnails.delete(thumbnails.keys().next().value!);
        thumbnails.set(key, thumb);
      }
      res.writeHead(200, {
        "content-type": thumb.type, "content-length": thumb.bytes.length,
        "cache-control": "private, no-store", "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      }).end(thumb.bytes);
      return;
    }
    if (preview && !imageType) {
      res.writeHead(415, { "cache-control": "no-store" }).end();
      return;
    }
    const downloadName = uploadsDir && file.startsWith(uploadsDir) ? basename(file).replace(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-/i, "") : basename(file);
    const name = encodeURIComponent(downloadName).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16));
    res.writeHead(200, {
      "content-type": preview ? imageType : "application/octet-stream",
      "content-disposition": (preview ? "inline" : "attachment") + "; filename*=UTF-8\x27\x27" + name,
      "content-length": info.size,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    await pipeline(createReadStream(file), res);
  } catch {
    if (!res.headersSent) res.writeHead(404, { "cache-control": "no-store" }).end("File unavailable");
    else res.destroy();
  }
}
