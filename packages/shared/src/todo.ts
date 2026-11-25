export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	content: string;
	status: TodoStatus;
}

export const TODO_TOOL_NAME = "todo";

export const TODO_REMINDER_CUSTOM_TYPE = "todo-reminder";

export function extractTodos(details: unknown): TodoItem[] | null {
	const d = details as { todos?: unknown } | null | undefined;
	if (!d || !Array.isArray(d.todos)) return null;
	const items: TodoItem[] = [];
	for (const raw of d.todos) {
		const item = raw as { content?: unknown; status?: unknown } | null | undefined;
		if (!item || typeof item.content !== "string" || item.content.length === 0) continue;
		if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed") {
			continue;
		}
		items.push({ content: item.content, status: item.status });
	}
	return items;
}

/** Actual normalized result is preferred. Older PTC records contain only an args preview. */
export function extractTodoToolUpdate(
	toolName: string | undefined,
	details: unknown,
	isError = false,
): TodoItem[] | null {
	if (toolName === TODO_TOOL_NAME) return isError ? null : extractTodos(details);
	if (toolName !== "run_code") return null;
	const subCalls = (details as { subCalls?: unknown } | null)?.subCalls;
	if (!Array.isArray(subCalls)) return null;
	for (let i = subCalls.length - 1; i >= 0; i--) {
		const call = subCalls[i];
		if (call?.tool !== TODO_TOOL_NAME || call.ok !== true) continue;
		const actual = extractTodos({ todos: call.todos });
		if (actual !== null) return actual;
		// Legacy history: only recover a complete, parseable successful request.
		// An incomplete preview is not evidence of a completed or empty list.
		if (typeof call.args !== "string") return null;
		try {
			const raw = extractTodos(JSON.parse(call.args));
			if (raw === null) return null;
			let active = false;
			const normalized: TodoItem[] = [];
			for (const item of raw) {
				const content = item.content.trim();
				if (!content) continue;
				if (normalized.length === 50) break;
				const status = item.status === "in_progress" && active ? "pending" : item.status;
				if (status === "in_progress") active = true;
				normalized.push({ content, status });
			}
			return normalized;
		} catch {
			return null;
		}
	}
	return null;
}

export function latestTodosFromEntries(entries: readonly unknown[]): TodoItem[] | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { message?: unknown; role?: string; type?: string } | undefined;
		if (!entry) continue;
		const m = (entry.message ?? entry) as {
			role?: string;
			type?: string;
			toolName?: string;
			isError?: boolean;
			customType?: string;
			details?: unknown;
		};
		const update =
			m.role === "toolResult"
				? extractTodoToolUpdate(m.toolName, m.details, m.isError)
				: (m.role === "custom" || m.type === "custom_message") && m.customType === TODO_REMINDER_CUSTOM_TYPE
					? extractTodos(m.details)
					: null;
		if (update !== null) return update;
	}
	return null;
}
