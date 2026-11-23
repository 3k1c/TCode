import { describe, expect, it, vi } from "vitest";
import { beginSessionStop, composerControlVisibility } from "./stop-session";

describe("composer stop", () => {
	it("always exposes stop during a running agent, even with queued draft text", () => {
		expect(composerControlVisibility(true, false)).toEqual({ showStop: true, showSend: false });
		expect(composerControlVisibility(true, true)).toEqual({ showStop: true, showSend: true });
		expect(composerControlVisibility(false, true)).toEqual({ showStop: false, showSend: true });
		expect(composerControlVisibility(false, false)).toEqual({ showStop: false, showSend: true });
	});

	it("asks Pi to abort before clearing the follow-up queue", async () => {
		const calls: string[] = [];
		const api = {
			abort: vi.fn(async ({ sessionId }: { sessionId: string }) => {
				calls.push(`abort:${sessionId}`);
			}),
			clearQueue: vi.fn(async ({ sessionId }: { sessionId: string }) => {
				calls.push(`clear:${sessionId}`);
				return { steering: [], followUp: ["queued item"] };
			}),
		};
		const result = beginSessionStop(api, "s1");
		await Promise.all([result.aborted, result.cleared]);
		expect(calls).toEqual(["abort:s1", "clear:s1"]);
		expect(await result.cleared).toEqual({ steering: [], followUp: ["queued item"] });
	});

	it("still requests abort if queue clearing rejects", async () => {
		const api = {
			abort: vi.fn(async () => {}),
			clearQueue: vi.fn(async (): Promise<{ steering: string[]; followUp: string[] }> => {
				throw new Error("queue unavailable");
			}),
		};
		const result = beginSessionStop(api, "s1");
		const results = await Promise.allSettled([result.aborted, result.cleared]);
		expect(api.abort).toHaveBeenCalledOnce();
		expect(results[0].status).toBe("fulfilled");
		expect(results[1].status).toBe("rejected");
	});

	it("does not await a hung queue before firing abort", async () => {
		const calls: string[] = [];
		const api = {
			abort: vi.fn(async () => {
				calls.push("abort");
			}),
			clearQueue: vi.fn(
				() =>
					new Promise<{ steering: string[]; followUp: string[] }>(() => {
						calls.push("clear");
					}),
			),
		};
		const result = beginSessionStop(api, "s1");
		await result.aborted;
		expect(calls).toEqual(["abort", "clear"]);
	});
});
