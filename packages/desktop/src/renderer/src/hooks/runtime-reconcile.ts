/** The backend (Pi) is the authority on whether a session is still running. */
export interface RuntimeSession {
	sessionId: string;
	streaming: boolean;
	compacting: boolean;
}

export interface LocalRunState {
	agentActive: boolean;
	phase: string;
}

export type RuntimeReconcileAction = "restore-active" | "reload-idle" | "none";

export function runtimeReconcileAction(
	sessionId: string,
	local: LocalRunState | null | undefined,
	runtime: readonly RuntimeSession[],
): RuntimeReconcileAction {
	if (!local) return "none";
	const backendRunning = runtime.some(
		(entry) => entry.sessionId === sessionId && (entry.streaming || entry.compacting),
	);
	const localRunning = local.agentActive || local.phase === "streaming";
	if (backendRunning === localRunning) return "none";
	return backendRunning ? "restore-active" : "reload-idle";
}
