import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import { DEFAULT_TYPE_FOLDERS } from "../../core/folders";
import { NODE_TYPES } from "../../core/nodeTypes";
import type { MentionMode } from "../../core/tracker";

export interface WBuilderSettings {
	/** Folder new notes and maps are created in. */
	noteFolder: string;
	/** Put each type of new note in its own folder under the notes folder (Characters, Events, ...). */
	sortByType: boolean;
	/** Folder names the user changed, by node type. Types missing here use the defaults. */
	typeFolders: Record<string, string>;
	/** Folder whose images become custom stickers. */
	stickerFolder: string;
	/** Whether plain links to characters in an event place them at the event. */
	mentionMode: MentionMode;
}

export const DEFAULT_SETTINGS: WBuilderSettings = {
	noteFolder: "World",
	sortByType: true,
	typeFolders: {},
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
		this.render();
	}

	private render(): void {
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
			.setName("A folder for each type")
			.setDesc(
				"New notes go into a folder named for their type inside the notes folder, such as World/Characters and World/Events. " +
					"Turn off to put every new note straight in the notes folder. Notes that already exist are never moved.",
			)
			.addToggle((toggle) =>
				toggle.setValue(owner.settings.sortByType).onChange(async (value) => {
					owner.settings.sortByType = value;
					await owner.saveSettings();
					this.render();
				}),
			);

		if (owner.settings.sortByType) {
			for (const type of NODE_TYPES) {
				new Setting(containerEl)
					.setName(`${type.label} folder`)
					.setDesc(type.id === NODE_TYPES[0].id ? 'Leave empty for the default shown, or type "." to use the notes folder itself.' : "")
					.addText((text) =>
						text
							.setPlaceholder(DEFAULT_TYPE_FOLDERS[type.id] ?? "")
							.setValue(owner.settings.typeFolders[type.id] ?? "")
							.onChange(async (value) => {
								const folders = { ...owner.settings.typeFolders };
								if (value.trim()) folders[type.id] = value.trim();
								else delete folders[type.id];
								owner.settings.typeFolders = folders;
								await owner.saveSettings();
							}),
					);
			}
		}

		new Setting(containerEl)
			.setName("Sticker folder")
			.setDesc("Image files in this folder show up in the sticker palette.")
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
