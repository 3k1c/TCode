import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, parse, relative, sep } from "node:path";

/** Read-only view of directories on the machine running TCode, not the phone. */
export interface ProjectFolderListing {
  current: string;
  parent: string | null;
  roots: string[];
  breadcrumbs: Array<{ name: string; path: string }>;
  folders: Array<{ name: string; path: string }>;
  truncated: boolean;
}

const MAX_FOLDERS = 400;

export function browseProjectFolders(requestedPath?: string): ProjectFolderListing {
  const requested = requestedPath?.trim() || homedir();
  if (requested.length > 1024 || !isAbsolute(requested)) {
    throw new Error("Please provide an absolute folder path on the TCode computer.");
  }
  // Canonicalize symlinks/junctions before showing paths to the browser.
  const current = realpathSync(requested);
  if (!statSync(current).isDirectory()) throw new Error("The path is not a directory.");
  const root = parse(current).root;
  const breadcrumbs: ProjectFolderListing["breadcrumbs"] = [{ name: root, path: root }];
  let step = root;
  for (const part of relative(root, current).split(sep).filter(Boolean)) {
    step = join(step, part);
    breadcrumbs.push({ name: part, path: step });
  }
  const entries = readdirSync(current, { withFileTypes: true });
  const folders = entries.flatMap((entry) => {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return [];
    const next = join(current, entry.name);
    try {
      if (!statSync(next).isDirectory()) return [];
    } catch {
      return [];
    }
    return [{ name: entry.name, path: next }];
  }).sort((a, b) => {
    // Keep hidden dot-directories available, but put ordinary project locations first.
    const hiddenDelta = Number(a.name.startsWith(".")) - Number(b.name.startsWith("."));
    return hiddenDelta || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  const roots = platform() === "win32"
    ? Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ":\\").filter((p) => existsSync(p))
    : ["/"];
  return {
    current,
    parent: current === root ? null : dirname(current),
    roots,
    breadcrumbs,
    folders: folders.slice(0, MAX_FOLDERS),
    truncated: folders.length > MAX_FOLDERS,
  };
}
