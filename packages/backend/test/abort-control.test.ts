import { describe, expect, it, vi } from "vitest";
import { awaitAbortOrTimeout } from "../src/session/abort-control";

describe("abort without session replacement", () => {
	it("resolves a normal Pi abort", async () => {
		const abort = vi.fn().mockResolvedValue(undefined);
		await expect(awaitAbortOrTimeout(abort, 100)).resolves.toBeUndefined();
		expect(abort).toHaveBeenCalledTimes(1);
	});
	it("reports an abort failure instead of pretending the session ended", async () => {
		await expect(awaitAbortOrTimeout(async () => { throw new Error("failure"); }, 100))
			.rejects.toThrow("failure");
	});
	it("times out without trying to reload or replace a session", async () => {
		vi.useFakeTimers();
		try {
			const pending = awaitAbortOrTimeout(() => new Promise<void>(() => {}), 200);
			const rejected = expect(pending).rejects.toThrow("session retained for recovery");
			await vi.advanceTimersByTimeAsync(210);
			await rejected;
		} finally { vi.useRealTimers(); }
	});
});
