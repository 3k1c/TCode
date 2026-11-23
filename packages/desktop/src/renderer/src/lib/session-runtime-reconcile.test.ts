import { describe, expect, it } from "vitest";
import { missedSessionCompletion } from "./session-runtime-reconcile";

describe("missedSessionCompletion", () => {
	const running = { sessionId: "ocr", streaming: true, compacting: false };
	const compacting = { sessionId: "ocr", streaming: false, compacting: true };
	const finished = { sessionId: "ocr", streaming: false, compacting: false };

	it("recovers only a stale busy UI", () => {
		expect(missedSessionCompletion({ agentActive: true, phase: "streaming" }, "ocr", [finished])).toBe(true);
		expect(missedSessionCompletion({ agentActive: true, phase: "streaming" }, "ocr", [])).toBe(true);
		expect(missedSessionCompletion({ agentActive: false, phase: "streaming" }, "ocr", [finished])).toBe(true);
		expect(missedSessionCompletion({ agentActive: false, phase: "idle" }, "ocr", [finished])).toBe(false);
	});

	it("does not interrupt an actual running or compacting Pi session", () => {
		expect(missedSessionCompletion({ agentActive: true, phase: "streaming" }, "ocr", [running])).toBe(false);
		expect(missedSessionCompletion({ agentActive: true, phase: "streaming" }, "ocr", [compacting])).toBe(
			false,
		);
	});
});
