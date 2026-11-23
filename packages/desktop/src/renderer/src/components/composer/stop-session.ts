/**
 * Start an agent cancellation before waiting for any queue operation.
 * Pi remains the only authority for the session's actual running/idle state.
 */
export interface SessionStopApi {
	abort(args: { sessionId: string }): Promise<void>;
	clearQueue(args: { sessionId: string }): Promise<{ steering: string[]; followUp: string[] }>;
}

export function beginSessionStop(api: SessionStopApi, sessionId: string) {
	// Scheduling both calls means a slow/failing queue operation cannot prevent abort.
	const aborted = Promise.resolve().then(() => api.abort({ sessionId }));
	const cleared = Promise.resolve().then(() => api.clearQueue({ sessionId }));
	return { aborted, cleared };
}

export function composerControlVisibility(isStreaming: boolean, hasContent: boolean) {
	return { showStop: isStreaming, showSend: !isStreaming || hasContent };
}
