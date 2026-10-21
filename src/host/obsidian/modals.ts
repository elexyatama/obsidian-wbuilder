import { Modal, Notice, Setting, type App } from "obsidian";
import { NODE_TYPES, getNodeType } from "../../core/nodeTypes";
import { MAX_MAP_SIZE, MIN_MAP_SIZE, isValidMapSize } from "../../core/mapFile";

export interface StickerOption {
	id: string;
	label: string;
}

export interface NewNodeResult {
	name: string;
	type: string;
	/** Empty/undefined means the type's default sticker. */
	icon?: string;
	/** One or two sentences shown when hovering the node on the map. */
	overview?: string;
	/** Name of the affiliation note it belongs to. */
	affiliation?: string;
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

/** The wording for a node's years: a character is born and dies, anything else starts and ends. */
function yearWords(type: string): { start: string; end: string; startDesc: string; endDesc: string } {
	return type === "character"
		? {
				start: "Born year",
				end: "Died year",
				startDesc: "Leave empty if unknown or they have always been around.",
				endDesc: "Leave empty if they are still alive, or unknown.",
			}
		: {
				start: "Start year",
				end: "End year",
				startDesc: "When it begins to exist. Leave empty if it has always existed.",
				endDesc: "The last year it exists. Leave empty if it lasts indefinitely.",
			};
}

/**
 * Asks for a name, type, sticker, overview, affiliation and (optional) period for a new note.
 * Opened for a tile on the map, or (with no tile) for a note that is not placed, like a character.
 */
export class NewNodeModal extends Modal {
	private name = "";
	private type: string;
	private icon: string;
	private overview = "";
	private affiliation = "";
	private start = "";
	private end = "";
	private readonly typeLocked: boolean;

	constructor(
		app: App,
		init: { type: string; icon?: string; x?: number; y?: number; lockType?: boolean },
		private readonly stickers: readonly StickerOption[],
		/** Names of the existing affiliation notes. */
		private readonly affiliations: readonly string[],
		/** The folder a new note of a type is saved in, so the dialog can say where it will go. */
		private readonly destination: (type: string) => string,
		private readonly onSubmit: (result: NewNodeResult) => void,
	) {
		super(app);
		this.type = init.type;
		this.icon = init.icon ?? "";
		this.typeLocked = init.lockType === true;
		const placed = init.x !== undefined && init.y !== undefined;
		this.setTitle(placed ? `New note at ${init.x}, ${init.y}` : `New ${getNodeType(init.type).label.toLowerCase()}`);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName("Name").addText((text) => {
			text.setPlaceholder(this.type === "character" ? "Alaric" : "Dragon Keep").onChange((value) => (this.name = value));
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.submit();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		// the labels for the two year fields depend on the type, so they are updated when it changes
		let startSetting: Setting | null = null;
		let endSetting: Setting | null = null;
		const showYearWords = () => {
			const words = yearWords(this.type);
			startSetting?.setName(words.start).setDesc(words.startDesc);
			endSetting?.setName(words.end).setDesc(words.endDesc);
		};

		const typeSetting = new Setting(contentEl).setName("Type");
		const showDestination = () => {
			const where = `Saved in ${this.destination(this.type) || "the vault's top folder"}`;
			typeSetting.setDesc(this.typeLocked ? `${getNodeType(this.type).label}. ${where}` : where);
		};
		// a "New character" button fixes the type, so there is nothing to choose
		if (!this.typeLocked) {
			typeSetting.addDropdown((dropdown) => {
				for (const type of NODE_TYPES) dropdown.addOption(type.id, type.label);
				if (!NODE_TYPES.some((t) => t.id === this.type)) dropdown.addOption(this.type, getNodeType(this.type).label);
				dropdown.setValue(this.type).onChange((value) => {
					this.type = value;
					showDestination();
					showYearWords();
				});
			});
		}
		showDestination();

		new Setting(contentEl).setName("Sticker").addDropdown((dropdown) => {
			dropdown.addOption("", "Default for type");
			for (const sticker of this.stickers) dropdown.addOption(sticker.id, sticker.label);
			if (this.icon && !this.stickers.some((s) => s.id === this.icon)) dropdown.addOption(this.icon, this.icon);
			dropdown.setValue(this.icon).onChange((value) => (this.icon = value));
		});

		new Setting(contentEl)
			.setName("Overview")
			.setDesc("One or two sentences, shown when you hover it on the map. Optional.")
			.addTextArea((area) => {
				area.setPlaceholder("A ruined fortress on the plains.").onChange((value) => (this.overview = value));
				area.inputEl.rows = 2;
			});

		new Setting(contentEl)
			.setName("Affiliation")
			.setDesc(this.affiliations.length > 0 ? "The group it belongs to." : "None yet. Create a note with type: affiliation, then pick it here.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "None");
				for (const name of this.affiliations) dropdown.addOption(name, name);
				dropdown.setValue("").onChange((value) => (this.affiliation = value));
			});

		startSetting = new Setting(contentEl).addText((text) => text.setPlaceholder("indefinite").onChange((value) => (this.start = value)));
		endSetting = new Setting(contentEl).addText((text) => text.setPlaceholder("indefinite").onChange((value) => (this.end = value)));
		showYearWords();

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
		const words = yearWords(this.type);
		const start = parseYear(this.start, words.start);
		const end = parseYear(this.end, words.end);
		if (start === "invalid" || end === "invalid") return;
		if (start !== undefined && end !== undefined && start > end) {
			new Notice(`The ${words.start.toLowerCase()} can't be after the ${words.end.toLowerCase()}.`);
			return;
		}
		this.close();
		this.onSubmit({
			name: this.name,
			type: this.type,
			icon: this.icon || undefined,
			overview: this.overview.trim() || undefined,
			affiliation: this.affiliation || undefined,
			start,
			end,
		});
	}
}

export interface NewMapResult {
	name: string;
	seed: string;
	size: number;
}

const SIZES = [64, 128, 256, 512, 1024].filter((s) => s >= MIN_MAP_SIZE && s <= MAX_MAP_SIZE);

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

export interface MapSettingsInit {
	id: string;
	seed: string;
	width: number;
	height: number;
	/** How many notes would sit outside a map of this size. */
	outside(width: number, height: number): number;
}

/**
 * The size of an existing map. Growing adds terrain on the right and bottom, shrinking crops
 * from there; painted terrain inside the new size is kept, and notes keep their coordinates.
 */
export class MapSettingsModal extends Modal {
	private width: number;
	private height: number;
	private summary: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly init: MapSettingsInit,
		private readonly onSubmit: (size: { width: number; height: number }) => void,
	) {
		super(app);
		this.width = init.width;
		this.height = init.height;
		this.setTitle("Map settings");
	}

	override onOpen(): void {
		const { contentEl, init } = this;
		contentEl.empty();

		new Setting(contentEl).setName("Map id").setDesc(`${init.id}. Notes join this map with map: ${init.id}.`);
		new Setting(contentEl).setName("Seed").setDesc(`${init.seed}. The same seed always generates the same terrain, so it is fixed.`);
		new Setting(contentEl)
			.setName("Width")
			.setDesc(`Tiles, from ${MIN_MAP_SIZE} to ${MAX_MAP_SIZE}.`)
			.addText((text) =>
				text.setValue(String(this.width)).onChange((value) => {
					this.width = Number(value);
					this.refreshSummary();
				}),
			);
		new Setting(contentEl)
			.setName("Height")
			.setDesc(`Tiles, from ${MIN_MAP_SIZE} to ${MAX_MAP_SIZE}.`)
			.addText((text) =>
				text.setValue(String(this.height)).onChange((value) => {
					this.height = Number(value);
					this.refreshSummary();
				}),
			);
		this.summary = contentEl.createDiv({ cls: "setting-item-description" });
		this.refreshSummary();

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText("Resize").setCta().onClick(() => this.submit()));
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	/** What the chosen size would do, before it is applied. */
	private refreshSummary(): void {
		const { summary, init, width, height } = this;
		if (!summary) return;
		if (!isValidMapSize(width, height)) {
			summary.setText(`Use whole numbers from ${MIN_MAP_SIZE} to ${MAX_MAP_SIZE} for both sides.`);
			return;
		}
		const lines = [
			width === init.width && height === init.height
				? "That is the current size."
				: "New terrain is generated on the right and bottom when growing; shrinking crops from there. Painted terrain inside the new size is kept.",
		];
		const outside = init.outside(width, height);
		if (outside > 0) {
			lines.push(
				`${outside} ${outside === 1 ? "note is" : "notes are"} outside this size. ${outside === 1 ? "It keeps" : "They keep"} their coordinates and reappear if you grow the map again.`,
			);
		}
		if (width * height > 600_000) lines.push("Large maps take a few seconds to generate.");
		summary.setText(lines.join(" "));
	}

	private submit(): void {
		if (!isValidMapSize(this.width, this.height)) {
			new Notice(`A map must be between ${MIN_MAP_SIZE} and ${MAX_MAP_SIZE} tiles on each side.`);
			return;
		}
		this.close();
		if (this.width !== this.init.width || this.height !== this.init.height) this.onSubmit({ width: this.width, height: this.height });
	}
}
