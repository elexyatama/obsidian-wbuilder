import { MarkdownView, Menu, Notice, Plugin, TFile, normalizePath, type WorkspaceLeaf } from "obsidian";
import { BUILTIN_STICKERS, defaultStickerFor } from "../../core/stickers";
import { createMapData, MAP_EXTENSION, serializeMapData } from "../../core/mapFile";
import { createNavigationBus } from "../../core/navigation";
import { NodeIndex } from "../../core/nodeIndex";
import { buildFrontmatter, type NewNodeSpec } from "../../core/nodeTemplate";
import { Timeline } from "../../core/timeline";
import { removeLocationRaw, upsertLocationRaw, type MentionMode } from "../../core/tracker";
import { isPin, type LocationEntry, type NodeRecord, type Pin } from "../../core/types";
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

const hasFamily = (node: NodeRecord) => node.type === "character" || node.parents.length > 0;

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
	private trackingTimer = 0;

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
			resolveLink: (target, from) => this.app.metadataCache.getFirstLinkpathDest(target, from)?.path ?? null,
			mentionMode: (): MentionMode => this.settings.mentionMode,
			setLocation: (path, entry) => this.editLocations(path, (list) => upsertLocationRaw(list, entry)),
			removeLocation: (path, year) => this.editLocations(path, (list) => removeLocationRaw(list, year)),
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
				const node = this.activeNode();
				if (!node || !isPin(node)) return false;
				if (!checking) void this.revealOnMap(node);
				return true;
			},
		});
		this.addCommand({
			id: "show-family-tree",
			name: "Show family tree of active note",
			checkCallback: (checking) => {
				const node = this.activeNode();
				if (!node || !hasFamily(node)) return false;
				if (!checking) void this.showFamilyTree(node.path);
				return true;
			},
		});
		this.addCommand({
			id: "track-character",
			name: "Track active character on map",
			checkCallback: (checking) => {
				const node = this.activeNode();
				if (!node || node.type !== "character") return false;
				if (!checking) void this.trackOnMap(node.path);
				return true;
			},
		});

		syncIndexWithVault(this, this.index);
		this.watchMapAndStickerFiles();

		// right-click a note (in the file list or the editor) to reach the same actions
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => this.addNoteMenuItems(menu, file instanceof TFile ? file : null)));
		this.registerEvent(this.app.workspace.on("editor-menu", (menu, _editor, info) => this.addNoteMenuItems(menu, info.file)));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) this.lastNoteLeaf = leaf;
			}),
		);
		// links resolving differently (a note created or renamed) can change where events place characters
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleTrackingRefresh()));
		this.register(this.bus.on("open-note", ({ path }) => void this.openNote(path)));
		this.register(() => window.clearTimeout(this.trackingTimer));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	stickerFolderChanged(): void {
		this.stickers.changed();
	}

	mentionModeChanged(): void {
		this.bus.emit("tracking-changed", null);
	}

	private scheduleTrackingRefresh(): void {
		window.clearTimeout(this.trackingTimer);
		this.trackingTimer = window.setTimeout(() => this.bus.emit("tracking-changed", null), 200);
	}

	/**
	 * The note the user is working in. While a map tab is active Obsidian reports the map
	 * file as the active file, so fall back to the last note that was open in an editor.
	 */
	private activeNote(): TFile | null {
		const { workspace } = this.app;
		const active = workspace.getActiveFile();
		if (active && active.extension === "md") return active;
		const leaf = this.lastNoteLeaf;
		if (leaf && workspace.getLeavesOfType("markdown").includes(leaf)) return (leaf.view as MarkdownView).file;
		return null;
	}

	private activeNode(): NodeRecord | undefined {
		const file = this.activeNote();
		return file ? this.index.get(file.path) : undefined;
	}

	private addNoteMenuItems(menu: Menu, file: TFile | null): void {
		const node = file ? this.index.get(file.path) : undefined;
		if (!node) return;
		if (hasFamily(node)) {
			menu.addItem((item) => item.setTitle("Show family tree").setIcon("network").onClick(() => void this.showFamilyTree(node.path)));
		}
		if (node.type === "character") {
			menu.addItem((item) => item.setTitle("Track on map").setIcon("map-pin").onClick(() => void this.trackOnMap(node.path)));
		}
		if (isPin(node)) {
			menu.addItem((item) => item.setTitle("Reveal on map").setIcon("map").onClick(() => void this.revealOnMap(node)));
		}
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

	/** The default map file, creating a "World" map if the vault has none yet. */
	private async defaultMapFile(): Promise<TFile | null> {
		await this.maps.refresh();
		return this.maps.first() ?? (await this.createMapFile(DEFAULT_MAP.name, DEFAULT_MAP.id, DEFAULT_MAP.seed, DEFAULT_MAP.width));
	}

	private async openMap(): Promise<void> {
		const file = await this.defaultMapFile();
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

	/** Opens a map (the character's own if it has one) with this character selected in the tracker. */
	private async trackOnMap(path: string): Promise<void> {
		const node = this.index.get(path);
		await this.maps.refresh();
		const file = (node?.map ? this.maps.fileFor(node.map) : undefined) ?? (await this.defaultMapFile());
		if (!file) return;
		const leaf = await this.openMapFile(file);
		await leaf.loadIfDeferred();
		if (leaf.view instanceof MapView) leaf.view.trackCharacter(path);
	}

	private async showFamilyTree(path: string): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_FAMILY)[0];
		if (!leaf) leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_FAMILY, active: true, state: { focus: path } });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * Rewrites a character's `locations` list with Obsidian's frontmatter API (so the rest of
	 * the YAML is preserved), then updates the index right away instead of waiting for the
	 * file watcher.
	 */
	private async editLocations(path: string, change: (list: unknown) => unknown[]): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		let updated: Record<string, unknown> = {};
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.locations = change(frontmatter.locations);
			updated = { ...frontmatter };
		});
		this.index.upsert(file.path, updated);
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
