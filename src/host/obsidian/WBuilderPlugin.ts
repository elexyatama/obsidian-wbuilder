import { MarkdownView, Notice, Plugin, TFile, normalizePath, type WorkspaceLeaf } from "obsidian";
import { BUILTIN_STICKERS, defaultStickerFor } from "../../core/stickers";
import { createMapData, MAP_EXTENSION, serializeMapData } from "../../core/mapFile";
import { createNavigationBus } from "../../core/navigation";
import { NodeIndex } from "../../core/nodeIndex";
import { buildFrontmatter, type NewNodeSpec } from "../../core/nodeTemplate";
import { Timeline } from "../../core/timeline";
import { isPin, type Pin } from "../../core/types";
import type { CreateNodeRequest } from "../../render/MapScreen";
import { DEFAULT_MAP, VIEW_TYPE_FAMILY, VIEW_TYPE_MAP, isImageExtension } from "./constants";
import { createNodeNote, ensureFolder, pathInFolder } from "./createNote";
import { FamilyTreeView } from "./FamilyTreeView";
import { MapRegistry } from "./mapRegistry";
import { MapView } from "./MapView";
import { NewMapModal, NewNodeModal, type StickerOption } from "./modals";
import { DEFAULT_SETTINGS, WBuilderSettingTab, type SettingsOwner, type WBuilderSettings } from "./settings";
import { StickerLibrary } from "./stickerLibrary";
import { syncIndexWithVault } from "./vaultSync";
import type { WorldContext } from "./world";

/**
 * Obsidian host. Everything Obsidian-specific lives under host/obsidian; a standalone
 * app would replace this folder (file watching, opening notes) and reuse core/ and render/.
 */
export default class WBuilderPlugin extends Plugin implements SettingsOwner {
	override settings: WBuilderSettings = { ...DEFAULT_SETTINGS };
	private readonly index = new NodeIndex();
	private readonly bus = createNavigationBus();
	private readonly timeline = new Timeline();
	private maps!: MapRegistry;
	private stickers!: StickerLibrary;
	/** Where pins open their notes, so the map tab itself is never navigated away. */
	private lastNoteLeaf: WorkspaceLeaf | null = null;

	override async onload(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
		this.maps = new MapRegistry(this.app);
		this.stickers = new StickerLibrary(this.app, () => this.settings.stickerFolder);

		const world: WorldContext = {
			index: this.index,
			timeline: this.timeline,
			bus: this.bus,
			stickers: this.stickers,
			requestCreateNode: (request) => this.requestCreateNode(request),
			createNote: (spec) => this.createNote(spec),
			showFamilyTree: (path) => void this.showFamilyTree(path),
		};

		this.registerView(VIEW_TYPE_MAP, (leaf) => new MapView(leaf, world));
		this.registerExtensions([MAP_EXTENSION], VIEW_TYPE_MAP);
		this.registerView(VIEW_TYPE_FAMILY, (leaf) => new FamilyTreeView(leaf, world));
		this.addSettingTab(new WBuilderSettingTab(this.app, this));

		this.addRibbonIcon("map", "Open WBuilder map", () => void this.openMap());
		this.addCommand({ id: "open-map", name: "Open map", callback: () => void this.openMap() });
		this.addCommand({ id: "new-map", name: "Create new map", callback: () => this.promptNewMap() });
		this.addCommand({
			id: "reveal-active-note",
			name: "Reveal active note on map",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const node = file ? this.index.get(file.path) : undefined;
				if (!node || !isPin(node)) return false;
				if (!checking) void this.revealOnMap(node);
				return true;
			},
		});
		this.addCommand({
			id: "show-family-tree",
			name: "Show family tree of active note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const node = file ? this.index.get(file.path) : undefined;
				if (!node || (node.type !== "character" && node.parents.length === 0)) return false;
				if (!checking) void this.showFamilyTree(node.path);
				return true;
			},
		});

		syncIndexWithVault(this, this.index);
		this.watchMapAndStickerFiles();

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) this.lastNoteLeaf = leaf;
			}),
		);
		this.register(this.bus.on("open-note", ({ path }) => void this.openNote(path)));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	stickerFolderChanged(): void {
		this.stickers.changed();
	}

	private watchMapAndStickerFiles(): void {
		const { vault, workspace } = this.app;
		workspace.onLayoutReady(() => void this.maps.refresh());
		const readMap = (file: unknown) => {
			if (MapRegistry.isMapFile(file)) void this.maps.read(file);
		};
		this.registerEvent(vault.on("create", readMap));
		this.registerEvent(vault.on("modify", readMap));
		this.registerEvent(vault.on("delete", (file) => this.maps.remove(file.path)));
		this.registerEvent(
			vault.on("rename", (file, oldPath) => {
				this.maps.remove(oldPath);
				readMap(file);
			}),
		);

		const stickerFileChanged = (file: unknown) => {
			if (file instanceof TFile && isImageExtension(file.extension)) this.stickers.changed();
		};
		this.registerEvent(vault.on("create", stickerFileChanged));
		this.registerEvent(vault.on("delete", stickerFileChanged));
		this.registerEvent(vault.on("rename", stickerFileChanged));
	}

	/** Opens the default map, creating a "World" map if the vault has none yet. */
	private async openMap(): Promise<void> {
		await this.maps.refresh();
		const file = this.maps.first() ?? (await this.createMapFile(DEFAULT_MAP.name, DEFAULT_MAP.id, DEFAULT_MAP.seed, DEFAULT_MAP.width));
		if (file) await this.openMapFile(file);
	}

	private promptNewMap(): void {
		new NewMapModal(this.app, async ({ name, seed, size }) => {
			const file = await this.createMapFile(name, "", seed, size);
			if (file) await this.openMapFile(file);
		}).open();
	}

	/** `id` empty means: derive it from the name. */
	private async createMapFile(name: string, id: string, seed: string, size: number): Promise<TFile | null> {
		const fileName = name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
		if (!fileName) return null;
		let mapId = id || fileName.toLowerCase().replace(/\s+/g, "-");
		while (this.maps.has(mapId)) mapId += "-2";

		const folder = this.settings.noteFolder;
		const path = pathInFolder(folder, `${fileName}.${MAP_EXTENSION}`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`"${path}" already exists.`);
			return null;
		}
		if (folder) await ensureFolder(this.app, folder);
		const file = await this.app.vault.create(path, serializeMapData(createMapData({ id: mapId, seed, width: size, height: size })));
		await this.maps.read(file);
		return file;
	}

	private async openMapFile(file: TFile): Promise<WorkspaceLeaf> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_MAP).find((l) => (l.view as MapView).file?.path === file.path);
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.openFile(file);
		}
		await workspace.revealLeaf(leaf);
		return leaf;
	}

	private async revealOnMap(pin: Pin): Promise<void> {
		const file = this.maps.fileFor(pin.map);
		if (!file) {
			new Notice(`No map with the id "${pin.map}" was found.`);
			return;
		}
		const leaf = await this.openMapFile(file);
		await leaf.loadIfDeferred();
		if (leaf.view instanceof MapView) leaf.view.focusTile(pin.x, pin.y);
	}

	private async showFamilyTree(path: string): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FAMILY)[0];
		if (!leaf) leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_FAMILY, active: true, state: { focus: path } });
		await workspace.revealLeaf(leaf);
	}

	private stickerOptions(): StickerOption[] {
		return [
			...BUILTIN_STICKERS.map((s) => ({ id: s.id, label: `${s.glyph} ${s.label}` })),
			...this.stickers.custom().map((s) => ({ id: s.id, label: s.label })),
		];
	}

	private requestCreateNode(request: CreateNodeRequest): void {
		new NewNodeModal(this.app, request, this.stickerOptions(), async (result) => {
			// a sticker equal to the type's default needs no `icon` line
			const icon = result.icon && result.icon !== defaultStickerFor(result.type).id ? result.icon : undefined;
			const file = await this.createNote({
				name: result.name,
				type: result.type,
				map: request.map,
				x: request.x,
				y: request.y,
				icon,
				start: result.start,
				end: result.end,
			});
			if (file) this.bus.emit("open-note", { path: file.path });
		}).open();
	}

	/** Creates the note and puts it in the index straight away, so its pin appears without waiting for Obsidian to re-read it. */
	private async createNote(spec: NewNodeSpec): Promise<TFile | null> {
		const file = await createNodeNote(this.app, this.settings.noteFolder, spec);
		if (file) this.index.upsert(file.path, buildFrontmatter(spec));
		return file;
	}

	private async openNote(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return;

		const { workspace } = this.app;
		const noteLeaves = workspace.getLeavesOfType("markdown");
		const remembered = this.lastNoteLeaf && noteLeaves.includes(this.lastNoteLeaf) ? this.lastNoteLeaf : undefined;
		const leaf =
			noteLeaves.find((l) => (l.view as MarkdownView).file?.path === path) ??
			remembered ??
			noteLeaves[0] ??
			workspace.getLeaf("split", "vertical");

		await leaf.openFile(file);
		await workspace.revealLeaf(leaf);
	}
}
