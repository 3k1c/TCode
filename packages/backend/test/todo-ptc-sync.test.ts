import { describe, expect, it } from "vitest";
import {
	extractTodoToolUpdate,
	latestTodosFromEntries,
	emptyTranscript,
	reduceEvent,
	type PtcSubCallEvent,
} from "@tcode/shared";
import { PtcBridge } from "../src/tools/ptc/bridge";
import { makeTodoTool } from "../src/tools/todo";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

describe("todo synchronization through run_code", () => {
	const active = [{ content: "Verify CI", status: "in_progress" as const }];
	const old = { role: "toolResult", toolName: "todo", details: { todos: active } };
	it("restores the most recent successful nested clear from legacy session history", () => {
		const nested = {
			role: "toolResult",
			toolName: "run_code",
			details: { subCalls: [{ tool: "todo", ok: true, args: JSON.stringify({ todos: [] }) }] },
		};
		expect(latestTodosFromEntries([{ message: old }, { message: nested }])).toEqual([]);
	});
	it("ignores failed subcalls and accepts successful subcalls from a failed outer program", () => {
		const details = {
			subCalls: [
				{ tool: "todo", ok: true, todos: active },
				{ tool: "todo", ok: false, todos: [] },
			],
		};
		expect(extractTodoToolUpdate("run_code", details, true)).toEqual(active);
		expect(extractTodoToolUpdate("todo", { todos: [] }, true)).toBeNull();
		expect(
			extractTodoToolUpdate("run_code", { subCalls: [{ tool: "todo", ok: true, args: "{truncated" }] }),
		).toBeNull();
	});
	it("updates the transcript from successful nested end events without waiting for the outer tool", () => {
		const base: PtcSubCallEvent = {
			type: "ptc_subcall",
			phase: "end",
			id: "a",
			parentToolCallId: "p",
			tool: "todo",
			ok: true,
			todos: active,
		};
		const state = reduceEvent(emptyTranscript(), base);
		expect(state.todos).toEqual(active);
		expect(reduceEvent(state, { ...base, ok: false, todos: [] }).todos).toEqual(active);
		expect(reduceEvent(state, { ...base, id: "b", todos: [] }).todos).toEqual([]);
	});
	it("emits and persists actual normalized todo results even when args are truncated", async () => {
		const events: PtcSubCallEvent[] = [];
		const bridge = new PtcBridge({
			cwd: process.cwd(),
			parentToolCallId: "p",
			ctx: {} as ExtensionToolContext,
			resolveTool: (_sessionId, name) => (name === "todo" ? makeTodoTool() : undefined),
			onSubCall: (event) => events.push(event),
		});
		const control = { pauseClock: () => {}, resumeClock: () => {} };
		const long = [
			{ content: "x".repeat(500), status: "in_progress" },
			{ content: "second", status: "in_progress" },
		];
		await bridge.dispatch("todo", { todos: long }, control);
		const expected = [
			{ content: "x".repeat(500), status: "in_progress" },
			{ content: "second", status: "pending" },
		];
		expect(events.at(-1)?.todos).toEqual(expected);
		expect(bridge.summaries[0]?.todos).toEqual(expected);
		await bridge.dispatch("todo", { todos: [] }, control);
		expect(events.at(-1)?.todos).toEqual([]);
		expect(extractTodoToolUpdate("run_code", { subCalls: bridge.summaries })).toEqual([]);
		bridge.dispose();
	});
});
