import { Menu, Notice, TextFileView, type WorkspaceLeaf } from "obsidian";
import { TileGrid } from "../../core/grid";
import { MAP_EXTENSION, parseMapData, resizeMapData, serializeMapData, type MapData } from "../../core/mapFile";
import { MapScreen, type CameraState, type MapScreenHost } from "../../render/MapScreen";
import { VIEW_TYPE_MAP } from "./constants";
import { MapSettingsModal } from "./modals";
import type { WorldContext } from "./world";

/**
 * A `.worldmap` file opened as a map. The file holds the seed, the painted terrain and the
 * labels; the pins come from the notes themselves. Saving is debounced by
 * TextFileView.requestSave.
 */
export class MapView extends TextFileView {
	private screen: MapScreen | null = null;
	private mapData: MapData | null = null;
	/** The file's text as loaded, so a file we could not parse is never overwritten. */
	private rawData = "";
	private pendingFocus: { x: number; y: number } | null = null;
	private pendingTrack: string | null = null;
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
		const { screen } = this;
		return serializeMapData({
			...this.mapData,
			edits: screen ? screen.exportEdits() : this.mapData.edits,
			labels: screen ? screen.exportLabels() : this.mapData.labels,
		});
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
		this.mountScreen(parsed.data);
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

	/** Start following a character through time. */
	trackCharacter(path: string): void {
		if (this.screen) this.screen.trackCharacter(path);
		else this.pendingTrack = path;
	}

	override async onClose(): Promise<void> {
		this.screen?.destroy();
		this.screen = null;
	}

	private mountScreen(data: MapData): void {
		if (this.screen) this.camera = this.screen.getCamera();
		this.screen?.destroy();
		const grid = TileGrid.generate(data, data.edits);
		this.screen = new MapScreen(this.contentEl, this.screenHost(), data, grid, data.labels);
		if (this.camera) this.screen.setCamera(this.camera);
		if (this.pendingFocus) {
			this.screen.focusTile(this.pendingFocus.x, this.pendingFocus.y);
			this.pendingFocus = null;
		}
		if (this.pendingTrack) {
			this.screen.trackCharacter(this.pendingTrack);
			this.pendingTrack = null;
		}
	}

	/** Opens the dialog for this map's size. */
	private openMapSettings(): void {
		const data = this.mapData;
		if (!data) return;
		new MapSettingsModal(
			this.app,
			{
				id: data.id,
				seed: data.seed,
				width: data.width,
				height: data.height,
				outside: (width, height) => this.world.index.inMap(data.id).filter((pin) => pin.x >= width || pin.y >= height).length,
			},
			({ width, height }) => this.resizeMap(width, height),
		).open();
	}

	/**
	 * Applies a new size and rebuilds the map. The current painted terrain and labels are read
	 * back first so nothing unsaved is lost, and the camera stays where it was.
	 */
	private resizeMap(width: number, height: number): void {
		if (!this.mapData) return;
		const current: MapData = {
			...this.mapData,
			edits: this.screen?.exportEdits() ?? this.mapData.edits,
			labels: this.screen?.exportLabels() ?? this.mapData.labels,
		};
		try {
			this.mapData = resizeMapData(current, width, height);
		} catch (error) {
			new Notice(`WBuilder: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		this.mountScreen(this.mapData);
		this.requestSave();
		new Notice(`Map resized to ${width} × ${height} tiles.`);
	}

	private screenHost(): MapScreenHost {
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
			mapChanged: () => this.requestSave(),
			openMapSettings: () => this.openMapSettings(),
			resolveSticker: world.stickers.resolve,
			customStickers: () => world.stickers.custom(),
			onStickersChanged: (fn) => world.stickers.onChanged(fn),
			resolveLink: world.resolveLink,
			mentionMode: () => world.mentionMode(),
			setLocation: (path, entry) => void world.setLocation(path, entry),
			removeLocation: (path, year) => void world.removeLocation(path, year),
			onTrackingChanged: (fn) => world.bus.on("tracking-changed", () => fn()),
		};
	}
}
