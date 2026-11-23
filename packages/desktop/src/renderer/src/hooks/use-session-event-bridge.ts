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
import { runtimeReconcileAction } from "./runtime-reconcile";

export function useSessionEventBridge({
	onTrustRequest,
}: {
	onTrustRequest: (req: TrustRequest) => void;
}): void {
	useEffect(() => {
		const pi = getPi();
		const recovering = new Set<string>();
		const reconcile = (snapshot?: { sessionId: string; streaming: boolean; compacting: boolean; stopping?: boolean }[]) => {
			const sessionId = useSessionsStore.getState().activeSessionId;
			if (!sessionId || recovering.has(sessionId)) return;
			const local = useTranscriptStore.getState().bySession[sessionId];
			if (!local) return;
			recovering.add(sessionId);
			void (async () => {
				try {
					const runtime = snapshot ?? await pi.getActiveSessionRuntime();
					const action = runtimeReconcileAction(sessionId, local, runtime);
					if (action === "none") return;
					const before = useTranscriptStore.getState().bySession[sessionId];
					if (before !== local || useSessionsStore.getState().activeSessionId !== sessionId) return;
					if (action === "restore-active") {
						const latest = await pi.getActiveSessionRuntime();
						if (useTranscriptStore.getState().bySession[sessionId] === before &&
							useSessionsStore.getState().activeSessionId === sessionId &&
							runtimeReconcileAction(sessionId, before, latest) === "restore-active") {
							useTranscriptStore.getState().markAgentActive(sessionId, true);
						}
						return;
					}
					const history = await pi.getSessionMessages({ sessionId });
					const after = useTranscriptStore.getState().bySession[sessionId];
					if (before !== after || useSessionsStore.getState().activeSessionId !== sessionId) return;
					const latest = await pi.getActiveSessionRuntime();
					if (runtimeReconcileAction(sessionId, after, latest) !== "reload-idle") return;
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
		// The server pushes a full snapshot on every WebSocket reconnection.
		// Recheck when the active Session changes or the phone becomes visible.
		const offSnapshot = pi.onRuntimeSnapshot?.((snapshot) => reconcile(snapshot));
		const offSessionSwitch = useSessionsStore.subscribe((state, previous) => {
			if (state.activeSessionId !== previous.activeSessionId) reconcile();
		});
		const onVisible = () => { if (document.visibilityState === "visible") reconcile(); };
		document.addEventListener("visibilitychange", onVisible);
		void Promise.resolve().then(() => reconcile());
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
			offSnapshot?.();
			offSessionSwitch();
			document.removeEventListener("visibilitychange", onVisible);
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
