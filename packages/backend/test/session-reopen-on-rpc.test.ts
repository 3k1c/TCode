import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import type { SessionRegistry } from "../src/session/registry";

const root = mkdtempSync(join(tmpdir(), "tcode-session-reopen-"));
const file = join(root, "existing.jsonl");
writeFileSync(file, '{"type":"session"}\n');
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe("PiBackend restores disconnected persisted sessions", () => {
  it("reopens the same session and accepts a prompt without losing it", async () => {
    const backend = new PiBackend({ projectTrust: false, permissionGates: false });
    const registry = (backend as unknown as { registry: SessionRegistry }).registry;
    const sid = "persisted-id";
    const prompt = vi.fn(async (_text: string, options?: { preflightResult?: (ok: boolean) => void }) => {
      options?.preflightResult?.(true);
    });
    vi.spyOn(SessionManager, "listAll").mockResolvedValue([{ id: sid, path: file, cwd: root }] as never);
    const open = vi.spyOn(backend, "openSession").mockImplementation(async () => {
      if (!registry.has(sid)) {
        registry.add({
          session: {
            sessionId: sid,
            prompt,
            getFollowUpMessages: () => ["queued"],
            sessionManager: { getBranch: () => [] },
            messages: [],
          } as unknown as AgentSession,
          unsubscribe: () => {},
          cwd: root,
        } as never);
      }
      return { sessionId: sid } as never;
    });

    expect(await backend.getFollowUpMessages(sid)).toEqual(["queued"]);
    await expect(backend.prompt(sid, "繼續")).resolves.toBeUndefined();
    await expect(backend.getSessionMessages(sid)).resolves.toEqual([]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(file);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("does not silently create a nonexistent session", async () => {
    const backend = new PiBackend({ projectTrust: false, permissionGates: false });
    vi.spyOn(SessionManager, "listAll").mockResolvedValue([] as never);
    await expect(backend.prompt("missing-id", "hi")).rejects.toThrow("Session not found: missing-id");
  });
});
