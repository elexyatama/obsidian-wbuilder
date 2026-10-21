import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { MentionMode } from "../../core/tracker";

export interface WBuilderSettings {
	/** Folder new notes and maps are created in. */
	noteFolder: string;
	/** Folder whose images become custom stickers. */
	stickerFolder: string;
	/** Whether plain links to characters in an event place them at the event. */
	mentionMode: MentionMode;
}

export const DEFAULT_SETTINGS: WBuilderSettings = {
	noteFolder: "World",
	stickerFolder: "Stickers",
	mentionMode: "auto",
};

export interface SettingsOwner extends Plugin {
	settings: WBuilderSettings;
	saveSettings(): Promise<void>;
	/** The sticker folder setting changed. */
	stickerFolderChanged(): void;
	/** The mention mode setting changed. */
	mentionModeChanged(): void;
}

export class WBuilderSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly owner: SettingsOwner,
	) {
		super(app, owner);
	}

	override display(): void {
		const { containerEl, owner } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Notes folder")
			.setDesc("Where notes created from the map, and new map files, are saved. Created if missing.")
			.addText((text) =>
				text
					.setPlaceholder("World")
					.setValue(owner.settings.noteFolder)
					.onChange(async (value) => {
						owner.settings.noteFolder = value.trim();
						await owner.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sticker folder")
			.setDesc("Images in this folder (PNG, JPG, GIF, WebP, SVG) show up in the sticker palette.")
			.addText((text) =>
				text
					.setPlaceholder("Stickers")
					.setValue(owner.settings.stickerFolder)
					.onChange(async (value) => {
						owner.settings.stickerFolder = value.trim();
						await owner.saveSettings();
						owner.stickerFolderChanged();
					}),
			);

		new Setting(containerEl)
			.setName("Characters mentioned in events")
			.setDesc(
				"Decides which links in an event note put a character at that event (on its map tile, in its start year). " +
					"Either way, @[[Name]] always counts and ~[[Name]] never does.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", "Every link counts, unless marked ~")
					.addOption("marked", "Only links marked @ count")
					.setValue(owner.settings.mentionMode)
					.onChange(async (value) => {
						owner.settings.mentionMode = value === "marked" ? "marked" : "auto";
						await owner.saveSettings();
						owner.mentionModeChanged();
					}),
			);
	}
}
