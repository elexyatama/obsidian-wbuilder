import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";

export interface WBuilderSettings {
	/** Folder new notes and maps are created in. */
	noteFolder: string;
	/** Folder whose images become custom stickers. */
	stickerFolder: string;
}

export const DEFAULT_SETTINGS: WBuilderSettings = {
	noteFolder: "World",
	stickerFolder: "Stickers",
};

export interface SettingsOwner extends Plugin {
	settings: WBuilderSettings;
	saveSettings(): Promise<void>;
	/** The sticker folder setting changed. */
	stickerFolderChanged(): void;
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
	}
}
