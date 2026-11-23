import { describe, expect, it } from "vitest";
import { ExtensionDialogHost } from "../src/session/extension-dialog-host";
import { makeAskUserTool } from "../src/tools/ask-user";

function setup() {
	const requests: string[] = [];
	const resolutions: string[] = [];
	const dialogs = new ExtensionDialogHost({
		onRequest: (request) => requests.push(request.id),
		onResolved: (event) => resolutions.push(event.reason),
	});
	dialogs.bind("s1");
	const tool = makeAskUserTool({
		askForm: (sessionId, questions, signal) => {
			expect(sessionId).toBe("s1");
			return dialogs.ask("form", { title: "", questions }, { signal }) as Promise<string[] | undefined>;
		},
	});
	const context = { sessionManager: { getSessionId: () => "s1" }, hasUI: true };
	const run = (signal: AbortSignal) =>
		tool.execute("call1", { question: "Approve?" }, signal, () => {}, context as never);
	return { dialogs, requests, resolutions, run };
}

describe("ask_user cancellation", () => {
	it("passes Pi abort through the form dialog and settles a pending tool", async () => {
		const { requests, resolutions, run } = setup();
		const controller = new AbortController();
		const operation = run(controller.signal);
		expect(requests).toHaveLength(1);
		controller.abort();
		const answer = await operation;
		expect(answer.details?.cancelled).toBe(true);
		expect(resolutions).toEqual(["aborted"]);
	});

	it("does not display a form when Pi is already aborted", async () => {
		const { requests, resolutions, run } = setup();
		const controller = new AbortController();
		controller.abort();
		const result = await run(controller.signal);
		expect(requests).toHaveLength(0);
		expect(resolutions).toEqual(["aborted"]);
		expect(result.details?.cancelled).toBe(true);
	});

	it("preserves an answered form when it is not aborted", async () => {
		const { dialogs, requests, resolutions, run } = setup();
		const controller = new AbortController();
		const operation = run(controller.signal);
		dialogs.respond(requests[0], { answers: ["Yes"] });
		const result = await operation;
		expect(result.details?.answers).toEqual(["Yes"]);
		expect(result.details?.cancelled).toBeUndefined();
		expect(resolutions).toEqual(["answered"]);
	});
});
