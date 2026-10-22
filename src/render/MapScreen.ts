import type { Brush } from "../core/brush";
import type { Vec2 } from "../core/camera";
import type { Unsubscribe } from "../core/emitter";
import type { LinkResolver } from "../core/family";
import type { TileGrid } from "../core/grid";
import { MapEditor } from "../core/mapEditor";
import { createLabelId, type LabelSize, type MapLabel } from "../core/mapFile";
import type { NodeIndex } from "../core/nodeIndex";
import { getNodeType } from "../core/nodeTypes";
import { periodRange, type Period, type Timeline } from "../core/timeline";
import { buildTracks, type MentionMode, type Track } from "../core/tracker";
import { TRACK_COLORS, computeTracking, type TrackingView } from "../core/tracking";
import { TERRAIN_NAMES, type LocationEntry, type MapDefinition, type NodeRecord, type Pin } from "../core/types";
import { MapRenderer, type PointerInfo } from "./MapRenderer";
import { pinRadius } from "./pinPainter";
import type { StickerResolver } from "./stickerPainter";
import { h } from "./ui/dom";
import { LabelEditor } from "./ui/labelEditor";
import { PinTooltip } from "./ui/pinTooltip";
import { StickerPalette, type CustomSticker } from "./ui/stickerPalette";
import { TimelineBar } from "./ui/timelineBar";
import { Toolbar, type Tool } from "./ui/toolbar";
import { TrackerPanel } from "./ui/trackerPanel";

export interface MenuEntry {
	title: string;
	onClick: () => void;
}

export interface CreateNodeRequest {
	map: string;
	/** The tile to place the note on. Leave out both for a note that is not placed on the map (a new character). */
	x?: number;
	y?: number;
	type: string;
	/** Sticker id the user picked; undefined means "the type's default". */
	icon?: string;
	/** The type is fixed (it came from a "New character" button), so the dialog doesn't offer a choice. */
	lockType?: boolean;
}

/** What a map screen needs from the app it runs in. Implemented by each host. */
export interface MapScreenHost {
	index: NodeIndex;
	timeline: Timeline;
	openNote(path: string): void;
	showFamilyTree(path: string): void;
	/** Ask for details and create the note. */
	createNode(request: CreateNodeRequest): void;
	showMenu(entries: MenuEntry[], event: MouseEvent): void;
	/** The map itself changed (painted terrain, or a label): save it. */
	mapChanged(): void;
	/** Let the user change this map's settings (its size). */
	openMapSettings(): void;
	/** Turns a node's icon into something drawable; wraps `builtinResolver` to add image stickers. */
	resolveSticker: StickerResolver;
	customStickers(): CustomSticker[];
	/** Fires when sticker images finish loading or the sticker folder changes. */
	onStickersChanged(fn: () => void): Unsubscribe;
	/** Turns an event's link text into a note path (null if there is no such note). */
	resolveLink: LinkResolver;
	/** Whether plain links in an event place characters there (see tracker.ts). */
	mentionMode(): MentionMode;
	/** Writes or replaces a character's `locations` entry for a year. */
	setLocation(path: string, entry: LocationEntry): void;
	removeLocation(path: string, year: number): void;
	/** Fires when the tracker's inputs changed outside the index (a setting, links resolving differently). */
	onTrackingChanged(fn: () => void): Unsubscribe;
}

export interface CameraState {
	cx: number;
	cy: number;
	scale: number;
}

/** The earliest year we know anything about a character, used to jump the timeline when tracking starts. */
function firstYear(node: NodeRecord): number | undefined {
	const years = [node.start, ...node.locations.map((l) => l.year)].filter((y): y is number => y !== undefined);
	return years.length > 0 ? Math.min(...years) : undefined;
}

/** Labels sit on a quarter-tile grid: free enough to place anywhere, tidy enough to line up. */
const snap = (value: number) => Math.round(value * 4) / 4;

interface LabelEdit {
	label: MapLabel;
	isNew: boolean;
	/** What it looked like when the editor opened, so Escape can put it back. */
	original: MapLabel;
}

/**
 * One map tab's UI: canvas, toolbar, characters panel, sticker palette, timeline bar, hover
 * card and status line, wired to the editor, the node index and the host. Everything
 * host-specific goes through MapScreenHost, so an Obsidian tab and a standalone window can
 * share this.
 */
export class MapScreen {
	readonly renderer: MapRenderer;
	private readonly editor: MapEditor;
	private readonly toolbar: Toolbar;
	private readonly characters: TrackerPanel;
	private readonly palette: StickerPalette;
	private readonly timelineBar: TimelineBar;
	private readonly tooltip: PinTooltip;
	private readonly labelEditor: LabelEditor;
	private readonly status: HTMLElement;
	private readonly disposers: Array<() => void> = [];
	private tool: Tool = "select";
	private nodeType = "place";
	private sticker: string | null = null;
	private charactersOpen = false;
	private showPaths = false;
	/** Tracked characters, and the color each was given when picked. */
	private readonly tracked = new Set<string>();
	private readonly colors = new Map<string, string>();
	private tracks = new Map<string, Track>();
	private view: TrackingView | null = null;
	private readonly labels: MapLabel[];
	private labelEdit: LabelEdit | null = null;
	/** Size used for the next new label: the last one the user picked. */
	private labelSize: LabelSize = "m";

	constructor(
		private readonly container: HTMLElement,
		private readonly host: MapScreenHost,
		private readonly map: MapDefinition,
		private readonly grid: TileGrid,
		labels: readonly MapLabel[] = [],
	) {
		this.labels = labels.map((label) => ({ ...label }));
		container.replaceChildren();
		container.classList.add("wb-map");
		container.tabIndex = 0;

		const canvas = h("canvas", { class: "wb-canvas" });
		container.append(canvas);
		this.editor = new MapEditor(grid);
		const panels = h("div", { class: "wb-panels" });
		container.append(panels);
		this.toolbar = new Toolbar(panels, {
			// clicking the tool that is on switches it off, which leaves a map you can click freely
			toggleTool: (tool) => this.setTool(this.tool === tool ? "none" : tool),
			toggleCharacters: () => this.setCharactersOpen(!this.charactersOpen),
			openMapSettings: () => host.openMapSettings(),
			newCharacter: () => {
				// open the list first, so the new character is visible in it as soon as it exists
				this.setCharactersOpen(true);
				host.createNode({ map: map.id, type: "character", lockType: true });
			},
			setNodeType: (id) => {
				this.nodeType = id;
				this.refreshToolbar();
			},
			setBrush: (patch) => this.setBrush(patch),
			undo: () => this.undo(),
			redo: () => this.redo(),
		});
		this.characters = new TrackerPanel(panels, {
			toggle: (path, selected) => this.select(path, selected),
			setShowPaths: (show) => {
				this.showPaths = show;
				this.refreshPins();
			},
			showTree: (path) => host.showFamilyTree(path),
			goTo: (path) => {
				const at = this.view?.rows.find((r) => r.path === path)?.at;
				if (at) this.renderer.focusTile(at.x, at.y);
			},
		});
		this.palette = new StickerPalette(panels, (id) => {
			this.sticker = id;
			if (id !== null) this.setTool("place");
		});
		this.palette.setCustom(host.customStickers());

		this.tooltip = new PinTooltip(container);
		this.labelEditor = new LabelEditor(container);

		// the status line sits above the timeline so a long coordinate readout never resizes the timeline
		const bottom = h("div", { class: "wb-bottom" });
		this.status = h("div", { class: "wb-status" });
		bottom.append(this.status);
		this.timelineBar = new TimelineBar(bottom, host.timeline);
		container.append(bottom);

		this.renderer = new MapRenderer(canvas, grid, {
			onHover: ({ tile, pins, point }) => {
				this.showStatus(tile, pins);
				this.showTooltip(pins, point);
			},
			onDragStart: () => this.tooltip.hide(),
			onClick: (info) => this.handleClick(info),
			onContextMenu: (info) => this.handleContextMenu(info),
			onStrokeStart: (tile) => this.editor.beginStroke(tile.x, tile.y),
			onStrokeMove: (tile) => this.editor.strokeTo(tile.x, tile.y),
			onStrokeEnd: () => {
				if (this.editor.endStroke()) this.host.mapChanged();
			},
			onDropSticker: (tile, id) =>
				this.host.createNode({ map: map.id, x: tile.x, y: tile.y, type: this.nodeType, icon: id }),
			onLabelCreate: (world) => this.createLabel(world),
			onLabelClick: (label) => {
				this.commitLabelEdit();
				this.beginLabelEdit(label, false);
			},
			onLabelMove: (id, world) => this.moveLabel(id, world),
			onLabelMoveEnd: () => this.host.mapChanged(),
		});
		this.renderer.setStickerResolver(host.resolveSticker);
		this.renderer.setBrushRadius(this.editor.brush.radius);

		const onKey = (e: KeyboardEvent) => this.onKey(e);
		container.addEventListener("keydown", onKey);
		const focus = () => container.focus({ preventScroll: true });
		// pressing anywhere on the map, or zooming it, finishes the label being typed
		const finishLabel = () => this.commitLabelEdit();
		canvas.addEventListener("pointerdown", focus);
		canvas.addEventListener("pointerdown", finishLabel);
		canvas.addEventListener("wheel", finishLabel, { passive: true });
		this.disposers.push(
			() => container.removeEventListener("keydown", onKey),
			() => canvas.removeEventListener("pointerdown", focus),
			() => canvas.removeEventListener("pointerdown", finishLabel),
			() => canvas.removeEventListener("wheel", finishLabel),
			this.editor.on("terrain", (keys) => this.renderer.invalidateChunks(keys)),
			this.editor.on("history", () => this.refreshToolbar()),
			host.index.on("changed", () => this.refreshAll()),
			host.onTrackingChanged(() => this.refreshAll()),
			host.timeline.on("changed", () => this.refreshPins()),
			host.onStickersChanged(() => {
				this.palette.setCustom(host.customStickers());
				this.renderer.invalidate();
			}),
		);

		this.setTool("select");
		this.setCharactersOpen(false);
		this.refreshLabels();
		this.refreshAll();
	}

	focusTile(x: number, y: number): void {
		this.renderer.focusTile(x, y);
	}

	/** Start following a character (opens the characters panel and turns the timeline on). */
	trackCharacter(path: string): void {
		this.setCharactersOpen(true);
		this.select(path, true);
	}

	/** Painted tiles, ready to store in the map file. */
	exportEdits(): Record<string, string> {
		return this.grid.exportEdits();
	}

	/** The map's labels, ready to store in the map file (an empty one still being typed is left out). */
	exportLabels(): MapLabel[] {
		return this.labels.filter((l) => l.text.trim() !== "").map((l) => ({ ...l }));
	}

	getCamera(): CameraState {
		const { cx, cy, scale } = this.renderer.camera;
		return { cx, cy, scale };
	}

	setCamera(state: CameraState): void {
		Object.assign(this.renderer.camera, state);
		this.renderer.invalidate();
	}

	destroy(): void {
		this.commitLabelEdit();
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		this.timelineBar.destroy();
		this.renderer.destroy();
		this.container.classList.remove("wb-map");
		this.container.replaceChildren();
	}

	private setTool(tool: Tool): void {
		if (this.tool === "label" && tool !== "label") this.commitLabelEdit();
		this.tool = tool;
		this.renderer.setMode(tool === "brush" ? "paint" : tool === "label" ? "label" : "pan");
		this.palette.setVisible(tool === "place");
		this.tooltip.hide();
		this.refreshToolbar();
	}

	private setCharactersOpen(open: boolean): void {
		this.charactersOpen = open;
		this.characters.setVisible(open);
		this.refreshToolbar();
	}

	private setBrush(patch: Partial<Brush>): void {
		this.editor.brush = { ...this.editor.brush, ...patch };
		this.renderer.setBrushRadius(this.editor.brush.radius);
		this.refreshToolbar();
	}

	private undo(): void {
		if (this.editor.undo()) this.host.mapChanged();
	}

	private redo(): void {
		if (this.editor.redo()) this.host.mapChanged();
	}

	/** Pick or drop a character. Picking turns the timeline on, since that is what moves them. */
	private select(path: string, selected: boolean): void {
		if (!selected) {
			this.tracked.delete(path);
			this.colors.delete(path);
			this.refreshPins();
			return;
		}
		this.tracked.add(path);
		if (!this.colors.has(path)) {
			const used = new Set(this.colors.values());
			this.colors.set(path, TRACK_COLORS.find((c) => !used.has(c)) ?? TRACK_COLORS[this.tracked.size % TRACK_COLORS.length]);
		}
		const { timeline, index } = this.host;
		if (!timeline.state.enabled) {
			const node = index.get(path);
			const year = node ? firstYear(node) : undefined;
			timeline.set({ enabled: true, year: year ?? timeline.state.year });
		}
		this.refreshPins();
	}

	private refreshToolbar(): void {
		this.toolbar.update({
			tool: this.tool,
			charactersOpen: this.charactersOpen,
			nodeType: this.nodeType,
			brush: this.editor.brush,
			canUndo: this.editor.canUndo,
			canRedo: this.editor.canRedo,
		});
	}

	/** The index or the tracker's inputs changed: rebuild the tracks, then the pins. */
	private refreshAll(): void {
		const { index, resolveLink } = this.host;
		for (const path of this.tracked) {
			if (!index.get(path)) {
				this.tracked.delete(path);
				this.colors.delete(path);
			}
		}
		this.tracks = buildTracks(index.all(), resolveLink, this.host.mentionMode());
		this.refreshPins();
	}

	private refreshPins(): void {
		const { index, timeline } = this.host;
		const { enabled, year } = timeline.state;
		const nodes = index.all();

		const view = computeTracking({
			characters: nodes.filter((n) => n.type === "character"),
			tracks: this.tracks,
			tracked: this.tracked,
			colors: this.colors,
			enabled,
			year,
			mapId: this.map.id,
			showPaths: this.showPaths,
			warnings: (path) => index.warningsFor(path),
		});
		this.view = view;

		// a note that sits outside the map (after the map was made smaller) keeps its coordinates but isn't shown
		const inside = (pin: Pin) => this.grid.inBounds(pin.x, pin.y);
		const onMap = index.inMap(this.map.id).filter(inside);
		const shown = onMap.filter((pin) => !view.hidden.has(pin.path) && timeline.shows(pin));
		const moved = view.moved.filter(inside);
		this.renderer.setPins([...shown, ...moved]);
		this.renderer.setPinRings(view.rings);
		this.renderer.setTrackLines(view.lines);
		this.characters.update({ rows: view.rows, showPaths: this.showPaths });

		const periods: Period[] = [...nodes, ...nodes.flatMap((n) => n.locations.map((l) => ({ start: l.year })))];
		this.timelineBar.setRange(periodRange(periods));
		const total = new Set([...onMap.map((p) => p.path), ...moved.map((p) => p.path)]).size;
		this.timelineBar.setSummary(`${shown.length + moved.length} of ${total} on map`);
	}

	private showStatus(tile: { x: number; y: number } | null, pins: Pin[]): void {
		if (!tile) {
			this.status.textContent = "";
			return;
		}
		const names = pins.length > 0 ? ` · ${pins.map((p) => p.name).join(", ")}` : "";
		this.status.textContent = `x ${tile.x}, y ${tile.y} · ${TERRAIN_NAMES[this.grid.terrainAt(tile.x, tile.y)]}${names}`;
	}

	private bounds(): { width: number; height: number } {
		return { width: this.container.clientWidth, height: this.container.clientHeight };
	}

	/** The hover card for the pins under the pointer, placed beside the first one. */
	private showTooltip(pins: Pin[], point: Vec2 | null): void {
		if (pins.length === 0 || !point || this.tool === "brush" || this.labelEditor.isOpen) {
			this.tooltip.hide();
			return;
		}
		const { camera } = this.renderer;
		const c = camera.worldToScreen(pins[0].x + 0.5, pins[0].y + 0.5);
		this.tooltip.show(pins, { x: c.x + pinRadius(camera.scale), y: c.y }, this.bounds());
	}

	private handleClick({ tile, pins, event }: PointerInfo): void {
		// with no tool switched on, a click does nothing: the map is for looking at
		if (this.tool !== "select" && this.tool !== "place") return;
		if (pins.length === 1) {
			this.host.openNote(pins[0].path);
		} else if (pins.length > 1) {
			this.host.showMenu(
				pins.map((pin) => ({ title: `${pin.name} (${getNodeType(pin.type).label})`, onClick: () => this.host.openNote(pin.path) })),
				event,
			);
		} else if (this.tool === "place") {
			this.host.createNode({
				map: this.map.id,
				x: tile.x,
				y: tile.y,
				type: this.nodeType,
				icon: this.sticker ?? undefined,
			});
		}
	}

	private handleContextMenu({ tile, pins, event }: PointerInfo): void {
		const entries: MenuEntry[] = [];
		for (const pin of pins) {
			entries.push({ title: `Open ${pin.name}`, onClick: () => this.host.openNote(pin.path) });
			if (pin.type === "character") {
				const following = this.tracked.has(pin.path);
				entries.push({
					title: following ? `Stop tracking ${pin.name}` : `Track ${pin.name} through time`,
					onClick: () => this.select(pin.path, !following),
				});
				entries.push({ title: `Family tree of ${pin.name}`, onClick: () => this.host.showFamilyTree(pin.path) });
			}
		}

		// edit where a tracked character is in the year the timeline is showing
		const { enabled, year } = this.host.timeline.state;
		if (enabled) {
			for (const path of this.tracked) {
				const node = this.host.index.get(path);
				if (!node) continue;
				entries.push({
					title: `Place ${node.name} here in year ${year}`,
					onClick: () => this.host.setLocation(path, { year, map: this.map.id, x: tile.x, y: tile.y }),
				});
				entries.push({
					title: `${node.name} goes missing from year ${year}`,
					onClick: () => this.host.setLocation(path, { year, missing: true }),
				});
				if (node.locations.some((l) => l.year === year)) {
					entries.push({ title: `Remove ${node.name}'s entry for year ${year}`, onClick: () => this.host.removeLocation(path, year) });
				}
			}
		}

		const type = getNodeType(this.nodeType);
		entries.push({
			title: `Create ${type.label.toLowerCase()} here…`,
			onClick: () =>
				this.host.createNode({ map: this.map.id, x: tile.x, y: tile.y, type: this.nodeType, icon: this.sticker ?? undefined }),
		});
		this.host.showMenu(entries, event);
	}

	/* ---------------------------------- labels ---------------------------------- */

	private refreshLabels(): void {
		this.renderer.setLabels(this.labels);
	}

	private createLabel(world: Vec2): void {
		this.commitLabelEdit();
		const label: MapLabel = { id: createLabelId(), text: "", x: snap(world.x), y: snap(world.y), size: this.labelSize };
		this.labels.push(label);
		this.beginLabelEdit(label, true);
	}

	private moveLabel(id: string, world: Vec2): void {
		const label = this.labels.find((l) => l.id === id);
		if (!label) return;
		label.x = snap(world.x);
		label.y = snap(world.y);
		this.refreshLabels();
		if (this.labelEdit?.label === label) this.labelEditor.moveTo(this.renderer.camera.worldToScreen(label.x, label.y), this.bounds());
	}

	private beginLabelEdit(label: MapLabel, isNew: boolean): void {
		this.labelEdit = { label, isNew, original: { ...label } };
		this.labelSize = label.size;
		this.tooltip.hide();
		this.labelEditor.open(
			{ text: label.text, size: label.size, anchor: this.renderer.camera.worldToScreen(label.x, label.y), bounds: this.bounds() },
			{
				onText: (text) => {
					label.text = text;
					this.refreshLabels();
				},
				onSize: (size) => {
					label.size = size;
					this.labelSize = size;
					this.labelEditor.setSize(size);
					this.refreshLabels();
				},
				onDone: () => this.commitLabelEdit(),
				onCancel: () => this.cancelLabelEdit(),
				onDelete: () => this.deleteEditedLabel(),
			},
		);
	}

	/** Finish typing: keep the label (an empty one is dropped) and save the map if anything changed. */
	private commitLabelEdit(): void {
		const edit = this.labelEdit;
		if (!edit) return;
		this.labelEdit = null;
		this.labelEditor.close();
		const { label } = edit;
		label.text = label.text.trim();
		if (label.text === "") {
			this.removeLabel(label.id);
			if (!edit.isNew) this.host.mapChanged();
		} else if (edit.isNew || JSON.stringify(label) !== JSON.stringify(edit.original)) {
			this.host.mapChanged();
		}
		this.refreshLabels();
	}

	private cancelLabelEdit(): void {
		const edit = this.labelEdit;
		if (!edit) return;
		this.labelEdit = null;
		this.labelEditor.close();
		if (edit.isNew) this.removeLabel(edit.label.id);
		else Object.assign(edit.label, edit.original);
		this.refreshLabels();
	}

	private deleteEditedLabel(): void {
		const edit = this.labelEdit;
		if (!edit) return;
		this.labelEdit = null;
		this.labelEditor.close();
		this.removeLabel(edit.label.id);
		if (!edit.isNew) this.host.mapChanged();
		this.refreshLabels();
	}

	private removeLabel(id: string): void {
		const i = this.labels.findIndex((l) => l.id === id);
		if (i >= 0) this.labels.splice(i, 1);
	}

	private onKey(e: KeyboardEvent): void {
		const target = e.target as HTMLElement;
		if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
		// Escape puts the tool down, leaving a map you can click freely
		if (e.key === "Escape") {
			this.setTool("none");
			e.preventDefault();
			return;
		}
		if (!(e.ctrlKey || e.metaKey)) return;
		const key = e.key.toLowerCase();
		if (key === "z" && !e.shiftKey) this.undo();
		else if ((key === "z" && e.shiftKey) || key === "y") this.redo();
		else return;
		e.preventDefault();
	}
}
