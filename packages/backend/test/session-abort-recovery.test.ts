import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import type { SessionRegistry } from "../src/session/registry";

const root = mkdtempSync(join(tmpdir(), "pi-abort-recovery-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

function setup(abort: () => Promise<void>, streaming = true) {
  const backend = new PiBackend({ projectTrust: false, permissionGates: false });
  const registry = (backend as unknown as { registry: SessionRegistry }).registry;
  const sessionId = "stuck";
  const file = join(root, "stuck.jsonl");
  writeFileSync(file, '{"type":"session"}\n');
  const session = {
    sessionId,
    isStreaming: streaming,
    abort: vi.fn(abort),
    sessionManager: { getSessionFile: () => file },
  };
  const entry = {
    session: session as unknown as AgentSession,
    unsubscribe: vi.fn(),
    cwd: root,
    gate: { dispose: vi.fn() },
    dialogs: { dispose: vi.fn() },
    modeRef: { current: "default" },
  };
  registry.add(entry as never);
  const dispose = vi.spyOn(backend as never, "disposeSession" as never).mockImplementation(async () => {
    registry.delete(sessionId);
  });
  const open = vi.spyOn(backend, "openSession").mockResolvedValue({ sessionId } as never);
  const emit = vi.spyOn(backend as never, "emitEvent" as never).mockImplementation(() => {});
  return { backend, registry, session, dispose, open, emit };
}

describe("PiBackend abort recovery", () => {
  it("recovers a saved session when the underlying abort hangs", async () => {
    vi.useFakeTimers();
    const { backend, registry, session, dispose, open, emit } = setup(() => new Promise<void>(() => {}));
    const promise = backend.abort("stuck");
    await vi.advanceTimersByTimeAsync(8_100);
    await promise;
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(registry.has("stuck")).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("stuck", { type: "agent_settled", aborted: true });
  });

  it("leaves a normally-aborted session intact", async () => {
    const { backend, session, dispose, open } = setup(async () => { session.isStreaming = false; });
    await backend.abort("stuck");
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
