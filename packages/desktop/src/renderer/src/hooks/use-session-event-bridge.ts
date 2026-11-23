import { messagesToUIMessages, type SessionEvent, type TrustRequest } from "@tcode/shared";
import { useEffect } from "react";
import { getPi } from "../api";
import { missedSessionCompletion } from "../lib/session-runtime-reconcile";
import { useDraftStore } from "../stores/drafts";
import { EventConflator } from "../stores/event-conflator";
import { useProjectsStore } from "../stores/projects";
import { finishSessionHistory, retrySessionHistory } from "../stores/session-history";
import { useSessionsStore } from "../stores/sessions";
import { pushExtensionToast } from "../stores/toasts";
import { useTranscriptStore } from "../stores/transcript";

export function useSessionEventBridge({
	onTrustRequest,
}: {
	onTrustRequest: (req: TrustRequest) => void;
}): void {
	useEffect(() => {
		const pi = getPi();
		const recovering = new Set<string>();
		const reconcile = () => {
			const sessionId = useSessionsStore.getState().activeSessionId;
			if (!sessionId || recovering.has(sessionId)) return;
			const local = useTranscriptStore.getState().bySession[sessionId];
			if (!local || (!local.agentActive && local.phase !== "streaming")) return;
			recovering.add(sessionId);
			void (async () => {
				try {
					const runtime = await pi.getActiveSessionRuntime();
					if (!missedSessionCompletion(local, sessionId, runtime)) return;
					const before = useTranscriptStore.getState().bySession[sessionId];
					const history = await pi.getSessionMessages({ sessionId });
					const after = useTranscriptStore.getState().bySession[sessionId];
					if (before !== after || useSessionsStore.getState().activeSessionId !== sessionId) return;
					const currentRuntime = await pi.getActiveSessionRuntime();
					if (!missedSessionCompletion(after, sessionId, currentRuntime)) return;
					if (useTranscriptStore.getState().bySession[sessionId] !== after) return;
					useTranscriptStore.getState().loadHistory(sessionId, messagesToUIMessages(history));
					finishSessionHistory(sessionId);
				} catch (error) {
					console.warn("Failed to reconcile session runtime", error);
				} finally {
					recovering.delete(sessionId);
				}
			})();
		};
		const runtimeTimer = setInterval(reconcile, 12_000);
		void Promise.resolve().then(reconcile);
		const conflator = new EventConflator({
			apply: (sessionId, event) => {
				useTranscriptStore.getState().applyEvent(sessionId, event, {
					isActiveViewing: useSessionsStore.getState().activeSessionId === sessionId,
				});
				if (event.type === "agent_settled") void retrySessionHistory(sessionId);
			},
		});
		const offEvent = pi.onEvent(({ sessionId, event }: { sessionId: string; event: SessionEvent }) => {
			if (event.type === "session_info_changed") {
				useSessionsStore.getState().updateSessionName(sessionId, event.name);

				useProjectsStore.getState().applySessionName(sessionId, event.name);
				return;
			}
			conflator.push(sessionId, event);
		});
		const offPermission = pi.onPermissionRequest((req) => {
			useTranscriptStore.getState().addPermission(req.sessionId, req);
		});
		const offPermissionResolved = pi.onPermissionResolved((result) => {
			useTranscriptStore.getState().resolvePermission(result.sessionId, result.requestId);
		});

		const offDialogRequest = pi.onExtensionDialogRequest((req) => {
			useTranscriptStore.getState().addExtensionDialog(req.sessionId, req);
		});
		const offDialogResolved = pi.onExtensionDialogResolved((result) => {
			useTranscriptStore.getState().resolveExtensionDialog(result.sessionId, result.requestId);
		});
		const offNotify = pi.onExtensionNotify((event) => {
			pushExtensionToast(event.level, event.message, event.extensionPath || undefined);
		});
		const offEditorText = pi.onExtensionEditorText((event) => {
			useDraftStore.getState().updateDraft(event.sessionId, (d) => ({ ...d, text: event.text }));
			useTranscriptStore.getState().markExtensionPrefill(event.sessionId, event.source ?? "");
		});
		const offTrust = pi.onTrustRequest(onTrustRequest);
		const offNotificationOpen = pi.onNotificationOpen(({ sessionId }) => {
			const meta = useProjectsStore.getState().allSessions.find((s) => s.sessionId === sessionId);
			if (!meta) return;
			useProjectsStore.getState().select(meta.cwd);
			void useProjectsStore.getState().openSession(meta);
		});
		return () => {
			clearInterval(runtimeTimer);
			offEvent();
			conflator.dispose();
			offPermission();
			offPermissionResolved();
			offDialogRequest();
			offDialogResolved();
			offNotify();
			offEditorText();
			offTrust();
			offNotificationOpen();
		};
	}, [onTrustRequest]);
}
