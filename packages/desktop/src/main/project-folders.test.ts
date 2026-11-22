import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browseProjectFolders } from "./project-folders";

const created: string[] = [];
afterEach(() => { for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe("remote Windows project folder listing", () => {
  it("lists folders but never exposes files", () => {
    const base = mkdtempSync(join(tmpdir(), "tcode-folder-picker-"));
    created.push(base);
    mkdirSync(join(base, "Project A"));
    mkdirSync(join(base, "Project B"));
    writeFileSync(join(base, "secret.txt"), "do not list files");
    const view = browseProjectFolders(base);
    expect(view.current).toBeTruthy();
    expect(view.folders.map((f) => f.name)).toEqual(["Project A", "Project B"]);
    expect(view.folders.some((f) => f.name === "secret.txt")).toBe(false);
    expect(view.parent).toBeTruthy();
    expect(view.breadcrumbs.at(-1)?.name).toBe(view.current.split(/[\\/]/).at(-1));
  });

  it("rejects relative, missing, and file targets", () => {
    const base = mkdtempSync(join(tmpdir(), "tcode-folder-picker-"));
    created.push(base);
    const file = join(base, "file.txt");
    writeFileSync(file, "x");
    expect(() => browseProjectFolders("../relative")).toThrow();
    expect(() => browseProjectFolders(join(base, "missing"))).toThrow();
    expect(() => browseProjectFolders(file)).toThrow();
  });
});
