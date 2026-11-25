import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWebArtifact } from "./web-file-download";

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
describe("web artifact scope", () => {
  it("accepts project files and the current session's generated image; rejects escapes and other sessions", async () => {
    root = await mkdtemp(join(tmpdir(), "tcode-artifact-"));
    const cwd = join(root, "project");
    const agent = join(root, "agent");
    const generated = join(agent, "generated-images", "session-1");
    const other = join(agent, "generated-images", "session-2");
    await Promise.all([cwd, generated, other].map(p => mkdir(p, { recursive: true })));
    const doc = join(cwd, "report.pdf");
    const img = join(generated, "image.png");
    const secret = join(agent, "auth.json");
    const outside = join(other, "image.png");
    await Promise.all([doc, img, secret, outside].map(p => writeFile(p, "test")));
    expect(await resolveWebArtifact(cwd, "session-1", "report.pdf", agent)).toBe(doc);
    expect(await resolveWebArtifact(cwd, "session-1", img, agent)).toBe(img);
    await expect(resolveWebArtifact(cwd, "session-1", secret, agent)).rejects.toThrow();
    await expect(resolveWebArtifact(cwd, "session-1", outside, agent)).rejects.toThrow();
    await expect(resolveWebArtifact(cwd, "../agent", img, agent)).rejects.toThrow();
  });
});
