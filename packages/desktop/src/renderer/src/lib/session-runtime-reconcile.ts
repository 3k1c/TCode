import type { SessionPhase } from "../stores/transcript";

export interface ActiveRuntime {
	sessionId: string;
	streaming: boolean;
	compacting: boolean;
}

/** Recover only a locally busy session that Pi has already finished. */
export function missedSessionCompletion(
	local: { agentActive: boolean; phase: SessionPhase } | undefined,
	sessionId: string,
	runtime: ActiveRuntime[],
): boolean {
	if (!local || (!local.agentActive && local.phase !== "streaming")) return false;
	const active = runtime.find((entry) => entry.sessionId === sessionId);
	return !active?.streaming && !active?.compacting;
}
