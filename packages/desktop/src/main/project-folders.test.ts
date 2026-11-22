import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browseProjectFolders, createProjectFolder } from "./project-folders";

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
    // Quick links are provided by the host machine, never inferred from mobile paths.
    expect(view.shortcuts.find(s => s.name === "Home")?.path).toBeTruthy();
    expect(view.shortcuts.every(s => typeof s.path === "string" && s.path.length > 0)).toBe(true);
  });

  it("creates a new child folder and lists it", () => {
    const base = mkdtempSync(join(tmpdir(), "tcode-folder-create-"));
    created.push(base);
    const path = createProjectFolder(base, "新專案");
    expect(path).toContain("新專案");
    expect(browseProjectFolders(base).folders.map(f => f.name)).toContain("新專案");
    expect(() => createProjectFolder(base, "新專案")).toThrow();
    expect(browseProjectFolders(base).folders.filter(f => f.name === "新專案")).toHaveLength(1);
  });

  it("rejects unsafe Windows names and missing parents without creating directories", () => {
    const base = mkdtempSync(join(tmpdir(), "tcode-folder-create-"));
    created.push(base);
    for (const invalid of ["", ".", "..", "CON", "CON.txt", "PRN", "COM1", "LPT9",
      " bad", "bad ", "bad.", "a/b", "a\\b", "a:b", "bad?", "bad*", "bad<", "bad|", "a\u0000b"]) {
      expect(() => createProjectFolder(base, invalid)).toThrow();
    }
    expect(() => createProjectFolder(join(base, "does-not-exist"), "new")).toThrow();
    expect(browseProjectFolders(base).folders).toEqual([]);
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
