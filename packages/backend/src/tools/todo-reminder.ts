import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
	extractTodoToolUpdate,
	latestTodosFromEntries,
	TODO_REMINDER_CUSTOM_TYPE,
	type TodoItem,
} from "@tcode/shared";
import { formatTodoList } from "./todo";

export function makeTodoReminderExtension(): InlineExtension {
	return {
		name: "todo-reminder",
		factory: (pi) => {
			let currentTodos: TodoItem[] = [];
			let needsReminder = false;

			pi.on("session_start", (_event, ctx) => {
				currentTodos = latestTodosFromEntries(ctx.sessionManager.getBranch()) ?? [];
			});
			pi.on("tool_execution_end", (event) => {
				const todos = extractTodoToolUpdate(
					event.toolName,
					(event.result as { details?: unknown } | undefined)?.details,
					event.isError,
				);
				if (todos !== null) currentTodos = todos;
			});

			pi.on("session_compact", (_event, ctx) => {
				currentTodos = latestTodosFromEntries(ctx.sessionManager.getBranch()) ?? currentTodos;
				needsReminder = true;
			});

			pi.on("context", (event) => {
				if (!needsReminder) return;
				needsReminder = false;
				if (currentTodos.length === 0) return;
				return {
					messages: [
						...event.messages,
						{
							role: "custom",
							customType: TODO_REMINDER_CUSTOM_TYPE,
							content: `The conversation history was compacted. Continue working on this task list:\n${formatTodoList(currentTodos)}`,
							display: false,
							details: { todos: currentTodos },
							timestamp: Date.now(),
						},
					],
				};
			});
		},
	};
}
