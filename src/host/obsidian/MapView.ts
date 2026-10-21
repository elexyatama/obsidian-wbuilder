import { Menu, Notice, TextFileView, type WorkspaceLeaf } from "obsidian";
import { TileGrid } from "../../core/grid";
import { MAP_EXTENSION, parseMapData, serializeMapData, type MapData } from "../../core/mapFile";
import { MapScreen, type CameraState, type MapScreenHost } from "../../render/MapScreen";
import { VIEW_TYPE_MAP } from "./constants";
import type { WorldContext } from "./world";

/**
 * A `.worldmap` file opened as a map. The file holds the seed and painted terrain; the
 * pins come from the notes themselves. Saving is debounced by TextFileView.requestSave.
 */
export class MapView extends TextFileView {
	private screen: MapScreen | null = null;
	private mapData: MapData | null = null;
	/** The file's text as loaded, so a file we could not parse is never overwritten. */
	private rawData = "";
	private pendingFocus: { x: number; y: number } | null = null;
	private camera: CameraState | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly world: WorldContext,
	) {
		super(leaf);
		this.register(
			world.bus.on("focus-tile", ({ map, x, y }) => {
				if (this.mapData?.id === map) this.focusTile(x, y);
			}),
		);
	}

	getViewType(): string {
		return VIEW_TYPE_MAP;
	}

	override getIcon(): string {
		return "map";
	}

	override canAcceptExtension(extension: string): boolean {
		return extension === MAP_EXTENSION;
	}

	getViewData(): string {
		if (!this.mapData) return this.rawData;
		return serializeMapData({ ...this.mapData, edits: this.screen ? this.screen.exportEdits() : this.mapData.edits });
	}

	setViewData(data: string, _clear: boolean): void {
		this.rawData = data;
		const parsed = parseMapData(data);
		if (!parsed.ok) {
			this.screen?.destroy();
			this.screen = null;
			this.mapData = null;
			this.contentEl.empty();
			this.contentEl.createEl("p", { text: parsed.error, cls: "wb-error" });
			new Notice(`WBuilder: ${parsed.error}`);
			return;
		}
		this.mapData = parsed.data;
		this.mount(parsed.data);
	}

	clear(): void {
		this.screen?.destroy();
		this.screen = null;
		this.mapData = null;
		this.rawData = "";
	}

	focusTile(x: number, y: number): void {
		if (this.screen) this.screen.focusTile(x, y);
		else this.pendingFocus = { x, y };
	}

	override async onClose(): Promise<void> {
		this.screen?.destroy();
		this.screen = null;
	}

	private mount(data: MapData): void {
		if (this.screen) this.camera = this.screen.getCamera();
		this.screen?.destroy();
		const grid = TileGrid.generate(data, data.edits);
		this.screen = new MapScreen(this.contentEl, this.host(), data, grid);
		if (this.camera) this.screen.setCamera(this.camera);
		if (this.pendingFocus) {
			this.screen.focusTile(this.pendingFocus.x, this.pendingFocus.y);
			this.pendingFocus = null;
		}
	}

	private host(): MapScreenHost {
		const { world } = this;
		return {
			index: world.index,
			timeline: world.timeline,
			openNote: (path) => world.bus.emit("open-note", { path }),
			showFamilyTree: (path) => world.showFamilyTree(path),
			createNode: (request) => world.requestCreateNode(request),
			showMenu: (entries, event) => {
				const menu = new Menu();
				for (const entry of entries) menu.addItem((item) => item.setTitle(entry.title).onClick(entry.onClick));
				menu.showAtMouseEvent(event);
			},
			terrainChanged: () => this.requestSave(),
			resolveSticker: world.stickers.resolve,
			customStickers: () => world.stickers.custom(),
			onStickersChanged: (fn) => world.stickers.onChanged(fn),
		};
	}
}
