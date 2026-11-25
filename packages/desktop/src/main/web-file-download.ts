import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolveWorkspacePath } from "./fs-read";
import { resolvePathTarget } from "./path-target";

const images: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif",
};

export async function resolveWebArtifact(cwd: string, sessionId: string, target: string, agentDir = getAgentDir()): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || !target || target.includes("\0")) throw new Error("Invalid file");
  const absolute = resolvePathTarget(target, cwd);
  try {
    return await resolveWorkspacePath(cwd, absolute);
  } catch {
    return await resolveWorkspacePath(join(agentDir, "generated-images", sessionId), absolute);
  }
}

export async function sendWebArtifact(res: ServerResponse, cwd: string, sessionId: string, target: string, preview: boolean): Promise<void> {
  try {
    const file = await resolveWebArtifact(cwd, sessionId, target);
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    const imageType = images[extname(file).toLowerCase()];
    if (preview && !imageType) {
      res.writeHead(415, { "cache-control": "no-store" }).end();
      return;
    }
    const name = encodeURIComponent(basename(file)).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16));
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
