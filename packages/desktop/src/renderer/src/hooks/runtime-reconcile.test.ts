import { describe, expect, it } from "vitest";
import { runtimeReconcileAction } from "./runtime-reconcile";

describe("runtime status reconciliation", () => {
	const running = [{ sessionId: "s1", streaming: true, compacting: false }];
	const idle = [{ sessionId: "s1", streaming: false, compacting: false }];

	it("restores stop control after reloading a tab during an active Pi run", () => {
		expect(runtimeReconcileAction("s1", { agentActive: false, phase: "idle" }, running)).toBe("restore-active");
	});
	it("stops showing a stale active run when the backend has ended", () => {
		expect(runtimeReconcileAction("s1", { agentActive: true, phase: "streaming" }, idle)).toBe("reload-idle");
	});
	it("recognizes running compaction, too", () => {
		expect(runtimeReconcileAction("s1", { agentActive: false, phase: "idle" }, [
			{ sessionId: "s1", streaming: false, compacting: true },
		])).toBe("restore-active");
	});
	it("does not modify correctly synchronized or unknown sessions", () => {
		expect(runtimeReconcileAction("s1", { agentActive: true, phase: "streaming" }, running)).toBe("none");
		expect(runtimeReconcileAction("s1", { agentActive: false, phase: "idle" }, idle)).toBe("none");
		expect(runtimeReconcileAction("s1", undefined, running)).toBe("none");
		expect(runtimeReconcileAction("s2", { agentActive: false, phase: "idle" }, running)).toBe("none");
	});
});
