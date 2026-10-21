import { Modal, Notice, Setting, type App } from "obsidian";
import { NODE_TYPES, getNodeType } from "../../core/nodeTypes";
import { MAX_MAP_SIZE, MIN_MAP_SIZE } from "../../core/mapFile";

export interface StickerOption {
	id: string;
	label: string;
}

export interface NewNodeResult {
	name: string;
	type: string;
	/** Empty/undefined means the type's default sticker. */
	icon?: string;
	start?: number;
	end?: number;
}

function parseYear(text: string, label: string): number | undefined | "invalid" {
	const value = text.trim();
	if (value === "") return undefined;
	const year = Number(value);
	if (!Number.isFinite(year)) {
		new Notice(`${label} must be a number, or empty for indefinite.`);
		return "invalid";
	}
	return year;
}

/** Asks for a name, type, sticker and (optional) period for a note about to be placed on the map. */
export class NewNodeModal extends Modal {
	private name = "";
	private type: string;
	private icon: string;
	private start = "";
	private end = "";

	constructor(
		app: App,
		init: { type: string; icon?: string; x: number; y: number },
		private readonly stickers: readonly StickerOption[],
		private readonly onSubmit: (result: NewNodeResult) => void,
	) {
		super(app);
		this.type = init.type;
		this.icon = init.icon ?? "";
		this.setTitle(`New note at ${init.x}, ${init.y}`);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName("Name").addText((text) => {
			text.setPlaceholder("Dragon Keep").onChange((value) => (this.name = value));
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.submit();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(contentEl).setName("Type").addDropdown((dropdown) => {
			for (const type of NODE_TYPES) dropdown.addOption(type.id, type.label);
			if (!NODE_TYPES.some((t) => t.id === this.type)) dropdown.addOption(this.type, getNodeType(this.type).label);
			dropdown.setValue(this.type).onChange((value) => (this.type = value));
		});

		new Setting(contentEl).setName("Sticker").addDropdown((dropdown) => {
			dropdown.addOption("", "Default for type");
			for (const sticker of this.stickers) dropdown.addOption(sticker.id, sticker.label);
			if (this.icon && !this.stickers.some((s) => s.id === this.icon)) dropdown.addOption(this.icon, this.icon);
			dropdown.setValue(this.icon).onChange((value) => (this.icon = value));
		});

		new Setting(contentEl)
			.setName("Start year")
			.setDesc("When it begins to exist. Leave empty if it has always existed.")
			.addText((text) => text.setPlaceholder("indefinite").onChange((value) => (this.start = value)));
		new Setting(contentEl)
			.setName("End year")
			.setDesc("The last year it exists. Leave empty if it lasts indefinitely.")
			.addText((text) => text.setPlaceholder("indefinite").onChange((value) => (this.end = value)));

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText("Create").setCta().onClick(() => this.submit()));
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		if (!this.name.trim()) {
			new Notice("Give the note a name.");
			return;
		}
		const start = parseYear(this.start, "Start year");
		const end = parseYear(this.end, "End year");
		if (start === "invalid" || end === "invalid") return;
		if (start !== undefined && end !== undefined && start > end) {
			new Notice("The start year can't be after the end year.");
			return;
		}
		this.close();
		this.onSubmit({ name: this.name, type: this.type, icon: this.icon || undefined, start, end });
	}
}

export interface NewMapResult {
	name: string;
	seed: string;
	size: number;
}

const SIZES = [128, 256, 512].filter((s) => s >= MIN_MAP_SIZE && s <= MAX_MAP_SIZE);

/** Asks for the name, seed and size of a new map. */
export class NewMapModal extends Modal {
	private name = "";
	private seed = Math.random().toString(36).slice(2, 8);
	private size = 256;

	constructor(
		app: App,
		private readonly onSubmit: (result: NewMapResult) => void,
	) {
		super(app);
		this.setTitle("New map");
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName("Name").addText((text) => {
			text.setPlaceholder("Eldoria").onChange((value) => (this.name = value));
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.setName("Seed")
			.setDesc("The same seed always generates the same terrain.")
			.addText((text) => text.setValue(this.seed).onChange((value) => (this.seed = value)));
		new Setting(contentEl).setName("Size").addDropdown((dropdown) => {
			for (const size of SIZES) dropdown.addOption(String(size), `${size} × ${size} tiles`);
			dropdown.setValue(String(this.size)).onChange((value) => (this.size = Number(value)));
		});
		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Create")
					.setCta()
					.onClick(() => {
						if (!this.name.trim()) {
							new Notice("Give the map a name.");
							return;
						}
						this.close();
						this.onSubmit({ name: this.name, seed: this.seed.trim() || "wbuilder", size: this.size });
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
