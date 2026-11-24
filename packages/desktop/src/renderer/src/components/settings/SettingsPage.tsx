import { useMemo } from "react";
import { useT } from "../../i18n";
import { PluginBoundary } from "../../plugins/PluginBoundary";
import { EMPTY_CONTRIBUTIONS } from "../../plugins/RegionHost";
import { useUiPluginRegistry } from "../../plugins/registry";
import { UI_REGIONS } from "../../plugins/slots";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { findPluginContribution, pluginCategoryId, SETTINGS_PANELS, STATIC_CATEGORIES } from "./catalog";
import { selectSidebarHidden, useUiPreferencesStore } from "../../stores/ui-preferences";

export function SettingsPage() {
	const t = useT();
	const category = useSettingsStore((s) => s.category);
	const setCategory = useSettingsStore((s) => s.setCategory);
	const sidebarHidden = useUiPreferencesStore(selectSidebarHidden);

	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	const registryCategories = useUiPluginRegistry((s) => s.contributions[UI_REGIONS.SettingsPanel]);
	const pluginCategories = masterOn ? (registryCategories ?? EMPTY_CONTRIBUTIONS) : EMPTY_CONTRIBUTIONS;
	const pluginNonces = useUiPluginRegistry((s) => s.loadNonces);

	const activePluginContribution = useMemo(
		() => findPluginContribution(category, pluginCategories),
		[category, pluginCategories],
	);

	const Panel = SETTINGS_PANELS[category];

	return (
		<div data-settings-page="" className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className={`shrink-0 px-4 pb-2 ${sidebarHidden ? "" : "min-[641px]:hidden"}`}>
				<select
					data-settings-category=""
					aria-label={t("sidebar.settings")}
					className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
					value={category}
					onChange={(event) => setCategory(event.target.value as typeof category)}
				>
					{STATIC_CATEGORIES.map((id) => <option key={id} value={id}>{t(`settings.category.${id}`)}</option>)}
					{pluginCategories.map((item) => {
						const id = pluginCategoryId(item.pluginName, item.id);
						return <option key={id} value={id}>{item.title ?? item.pluginName}</option>;
					})}
					{!STATIC_CATEGORIES.some((id) => id === category) && !activePluginContribution &&
						<option value={category}>{category}</option>}
				</select>
			</div>
			<div className="mx-auto min-h-0 w-full max-w-[760px] flex-1 overflow-y-auto overflow-x-hidden px-4 pb-3">
				{Panel ? (
					<Panel />
				) : activePluginContribution ? (
					<PluginBoundary
						key={`${activePluginContribution.pluginName}:${activePluginContribution.id}:${
							pluginNonces[activePluginContribution.pluginName] ?? 0
						}`}
						pluginName={activePluginContribution.pluginName}
						label={category}
					>
						<activePluginContribution.component />
					</PluginBoundary>
				) : (
					<p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.comingSoon")}</p>
				)}
			</div>
		</div>
	);
}
