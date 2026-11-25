import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hydrateWebPromptImages } from "./web-file-upload";

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
describe("HTTP image upload references", () => {
  it("hydrates a large image without sending bytes over WebSocket", async () => {
    root = await mkdtemp(join(tmpdir(), "tcode-upload-"));
    await mkdir(join(root, "uploads"));
    const name = "11111111-2222-3333-4444-555555555555-vision.png";
    const bytes = Buffer.alloc(2 * 1024 * 1024, 17);
    await writeFile(join(root, "uploads", name), bytes);
    const args = {sessionId:"test",text:"read",webImageRefs:[{name,mimeType:"image/png"}]};
    expect(JSON.stringify(args).length).toBeLessThan(1024);
    expect(await hydrateWebPromptImages(args,root)).toEqual({sessionId:"test",text:"read",images:[{mimeType:"image/png",data:bytes.toString("base64")}]});
  });
  it("rejects arbitrary paths, wrong formats and mixed payloads", async () => {
    for (const name of ["../secret.png","C:/secret.png","secret.png"]) {
      await expect(hydrateWebPromptImages({webImageRefs:[{name,mimeType:"image/png"}]},tmpdir())).rejects.toThrow();
    }
    await expect(hydrateWebPromptImages({images:[],webImageRefs:[]},tmpdir())).rejects.toThrow();
    await expect(hydrateWebPromptImages({webImageRefs:[{name:"11111111-2222-3333-4444-555555555555-vision.png",mimeType:"image/jpeg"}]},tmpdir())).rejects.toThrow();
  });
  it("preserves existing text-only messages", async () => {
    const args = {sessionId:"test",text:"hello"};
    expect(await hydrateWebPromptImages(args,tmpdir())).toBe(args);
  });
});
