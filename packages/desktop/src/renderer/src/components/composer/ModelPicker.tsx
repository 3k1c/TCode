import type { AvailableModel } from "@tcode/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { anchorOfElement, placeMenu } from "../ui/place-menu";
import { useActiveModelInfo, useThinkingLevelState } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { thinkingLevelKey } from "../../lib/thinking";
import { useSessionsStore } from "../../stores/sessions";
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from "../icons";
import { Tooltip } from "../ui/Tooltip";
import { filterModelGroups, type ModelGroup } from "./model-filter";
import { ThinkingSlider } from "./ThinkingSlider";

const LIST_MAX_HEIGHT = "min(248px, max(72px, calc(100dvh - 190px)))";

function modelKey(m: AvailableModel): string {
	return `${m.provider}/${m.id}`;
}

export function ModelPicker({ compact = false }: { compact?: boolean }) {
	const t = useT();
	const models = useSessionsStore((s) => s.models);

	const current = useActiveModelInfo() ?? null;
	const setCurrentModel = useSessionsStore((s) => s.setCurrentModel);

	const { display } = useThinkingLevelState();
	const [open, setOpen] = useState(false);

	const [query, setQuery] = useState("");

	const [activeKey, setActiveKey] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

	// Position the portal against the viewport rather than the clipped composer footer.
	useLayoutEffect(() => {
		if (!open) {
			setPosition(null);
			return;
		}
		const trigger = triggerRef.current;
		const popup = popupRef.current;
		if (!trigger || !popup) return;
		const measure = () => {
			const { width, height } = popup.getBoundingClientRect();
			const next = placeMenu(anchorOfElement(trigger), { width, height },
				{ width: window.innerWidth, height: window.innerHeight },
				{ align: "end", gap: 6, margin: 8 });
			setPosition((previous) => previous?.x === next.x && previous?.y === next.y ? previous : next);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(trigger);
		observer.observe(popup);
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	}, [open]);
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const openByKeyboard = useRef(false);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActiveKey(null);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const groups = useMemo<ModelGroup[]>(() => {
		const map = new Map<string, ModelGroup>();
		for (const m of models) {
			const key = m.providerName || m.provider;
			const group = map.get(key);
			if (group) {
				group.items.push(m);
			} else {
				map.set(key, { name: key, items: [m] });
			}
		}
		return Array.from(map.values());
	}, [models]);

	const filtered = useMemo(() => filterModelGroups(groups, query), [groups, query]);

	const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered]);
	const currentModelKey = current ? modelKey(current) : null;
	const highlightedKey =
		activeKey && flat.some((m) => modelKey(m) === activeKey) ? activeKey : (currentModelKey ?? null);

	useEffect(() => {
		if (!open || !highlightedKey) return;
		listRef.current
			?.querySelector<HTMLElement>(`[data-model-key="${highlightedKey}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [open, highlightedKey]);

	const select = (m: AvailableModel) => {
		void setCurrentModel(m.provider, m.id);
	};

	const onSearchKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (flat.length === 0) return;
			const at = flat.findIndex((m) => modelKey(m) === highlightedKey);
			const next =
				e.key === "ArrowDown" ? (at + 1 + flat.length) % flat.length : (at <= 0 ? flat.length : at) - 1;
			const target = flat[next];
			if (target) setActiveKey(modelKey(target));
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			const target = flat.find((m) => modelKey(m) === highlightedKey) ?? flat[0];
			if (target) select(target);
		}
	};

	const label =
		current?.label ?? (current ? `${current.provider}/${current.id}` : t("composer.modelDefault"));

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				ref={triggerRef}
				data-model-picker-trigger=""
				aria-haspopup="dialog"
				aria-expanded={open}
				className="flex w-full min-w-0 max-w-[208px] items-center gap-1 rounded-full px-2.5 py-1 text-xs text-ink-dim transition-colors hover:bg-hover hover:text-ink"
				onClick={(e) => {
					openByKeyboard.current = e.detail === 0;
					setOpen((v) => !v);
				}}
			>
				<span data-model-name="" className="min-w-0 truncate">
					{label}
				</span>
				<span
					data-compact-piece="suffix"
					className={`shrink-0 text-ink-faint${compact ? " absolute invisible" : ""}`}
				>
					·
				</span>
				<span
					data-compact-piece="suffix"
					className={`shrink-0 text-ink-faint${compact ? " absolute invisible" : ""}`}
				>
					{t(thinkingLevelKey(display))}
				</span>
				<ChevronDownIcon className={open ? "shrink-0 rotate-180 transition-transform" : "shrink-0 transition-transform"} />
			</button>

			{open && createPortal(
				<div
					ref={popupRef}
					data-composer-overlay=""
					data-model-picker-popup=""
					role="dialog"
					aria-label={t("composer.modelSearchPlaceholder")}
					className="fixed z-50 w-72 max-w-[calc(100vw-16px)] rounded-xl border border-border bg-surface p-1 shadow-pop"
					style={{ left: position?.x ?? 0, top: position?.y ?? 0, visibility: position ? "visible" : "hidden" }}
				>
					<div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 pr-3">
						<SearchIcon size={13} className="shrink-0 text-ink-faint" />
						<input
							ref={inputRef}
							autoFocus={openByKeyboard.current}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={onSearchKeyDown}
							placeholder={t("composer.modelSearchPlaceholder")}
							className="w-full bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none"
						/>
						{query !== "" && (
							<Tooltip label={t("composer.modelSearchClear")}>
								<button
									type="button"
									className="shrink-0 text-ink-faint transition-colors hover:text-ink-2"
									onClick={() => {
										setQuery("");
										inputRef.current?.focus();
									}}
								>
									<CloseIcon size={12} />
								</button>
							</Tooltip>
						)}
					</div>

					<div className="fade-rule mb-1" />
					{flat.length === 0 && (
						<div className="px-2 py-3 text-center text-xs text-ink-faint">
							{query === "" ? t("settings.providers.empty") : t("composer.modelSearchEmpty")}
						</div>
					)}

					<div ref={listRef} className="mb-2 max-h-64 overflow-y-auto" style={{ maxHeight: LIST_MAX_HEIGHT }}>
						{filtered.map((group) => (
							<div key={group.name}>
								<div className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
									{group.name}
								</div>
								{group.items.map((m) => {
									const key = modelKey(m);
									const selected = currentModelKey === key;
									const active = highlightedKey === key;
									return (
										<button
											key={key}
											type="button"
											data-model-key={key}
											className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
												selected ? "text-ink" : "text-ink-2 hover:text-ink"
											} ${active ? "bg-hover" : "hover:bg-hover"}`}
											onMouseEnter={() => setActiveKey(key)}
											onClick={() => select(m)}
										>
											<span className="truncate">{m.label}</span>
											{selected && <CheckIcon size={12} />}
										</button>
									);
								})}
							</div>
						))}
					</div>
					<div className="fade-rule mb-1" />

					<ThinkingSlider level={display} thinkingLevels={current?.thinkingLevels} />
				</div>,
				document.body,
			)}
		</div>
	);
}
