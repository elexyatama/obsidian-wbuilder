import { brushFootprint } from "../core/brush";
import { Camera, type Vec2 } from "../core/camera";
import { CHUNK_SIZE, type TileGrid } from "../core/grid";
import type { MapLabel } from "../core/mapFile";
import { getNodeType } from "../core/nodeTypes";
import type { TrackLine } from "../core/tracking";
import type { Pin } from "../core/types";
import { ChunkCache } from "./chunkCache";
import { MIN_LABEL_PX, drawMapLabel, labelFontPx, measureLabel } from "./labelPainter";
import { drawPin, drawPinLabel, pinRadius } from "./pinPainter";
import { builtinResolver, type StickerResolver } from "./stickerPainter";

/**
 * "pan": dragging moves the map. "paint": dragging paints (shift or middle mouse still pans).
 * "label": click empty map to add a label, click a label to edit it, drag a label to move it.
 */
export type RendererMode = "pan" | "paint" | "label";

export interface PointerInfo {
	tile: Vec2;
	/** Pins under the pointer, nearest first. */
	pins: Pin[];
	event: MouseEvent;
}

export interface RendererCallbacks {
	/** `point` is the pointer in canvas pixels, for placing a hover card. */
	onHover?: (info: { tile: Vec2 | null; pins: Pin[]; point: Vec2 | null }) => void;
	/** A pan, paint or label drag has started (a hover card should get out of the way). */
	onDragStart?: () => void;
	/** A click (not a drag) inside the map while in "pan" mode. */
	onClick?: (info: PointerInfo) => void;
	onContextMenu?: (info: PointerInfo) => void;
	onStrokeStart?: (tile: Vec2) => void;
	onStrokeMove?: (tile: Vec2) => void;
	onStrokeEnd?: () => void;
	onDropSticker?: (tile: Vec2, stickerId: string, event: DragEvent) => void;
	/** Label mode: a click on empty map. `world` is in tile units, `point` in canvas pixels. */
	onLabelCreate?: (world: Vec2, point: Vec2) => void;
	/** Label mode: a click on an existing label. */
	onLabelClick?: (label: MapLabel, point: Vec2) => void;
	/** Label mode: a label is being dragged to `world`. */
	onLabelMove?: (id: string, world: Vec2) => void;
	onLabelMoveEnd?: (id: string) => void;
}

/** Marks a dragged sticker so the canvas can tell it from other drops. */
export const STICKER_DRAG_PREFIX = "wbuilder-sticker:";

const CLICK_SLOP_PX = 4;
const LABEL_MIN_SCALE = 10;
const BACKGROUND = "#0b1020";
const TAU = Math.PI * 2;

interface Drag {
	id: number;
	kind: "pan" | "paint" | "label";
	button: number;
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	moved: boolean;
	lastTile: Vec2;
	/** For "label" drags: which label, and where it is relative to the pointer so it doesn't jump. */
	label?: MapLabel;
	grab?: Vec2;
}

/**
 * Canvas2D map view: owns the camera, input handling and drawing. It knows nothing about
 * notes or the host app; pins come in via setPins, and clicks, strokes and drops go out
 * via callbacks. Camera state lives here (not in any shared store) because it changes
 * every frame.
 */
export class MapRenderer {
	readonly camera = new Camera();
	private readonly ctx: CanvasRenderingContext2D;
	private readonly chunks: ChunkCache;
	private readonly disposers: Array<() => void> = [];
	private pins: Pin[] = [];
	private labels: readonly MapLabel[] = [];
	private lines: readonly TrackLine[] = [];
	private rings: ReadonlyMap<string, string> = new Map();
	private mode: RendererMode = "pan";
	private brushRadius = 1;
	private resolveSticker: StickerResolver = builtinResolver;
	private hover: Vec2 | null = null;
	private hoverPins: Pin[] = [];
	private dpr = 1;
	private frame = 0;
	private drag: Drag | null = null;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly grid: TileGrid,
		private readonly callbacks: RendererCallbacks = {},
	) {
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2D canvas is not available");
		this.ctx = ctx;
		this.chunks = new ChunkCache(grid);
		this.camera.cx = grid.width / 2;
		this.camera.cy = grid.height / 2;
		this.listen();
		this.resize();
	}

	setPins(pins: readonly Pin[]): void {
		// lower pins are drawn last so they overlap the ones behind them
		this.pins = [...pins].sort((a, b) => a.y - b.y || a.x - b.x || a.path.localeCompare(b.path));
		this.invalidate();
	}

	/** Journey lines of tracked characters, drawn under the pins. */
	setTrackLines(lines: readonly TrackLine[]): void {
		this.lines = lines;
		this.invalidate();
	}

	/** Colored ring around the pins of tracked characters, by note path. */
	setPinRings(rings: ReadonlyMap<string, string>): void {
		this.rings = rings;
		this.invalidate();
	}

	/** Text labels written on the map, drawn above the terrain and below the pins. */
	setLabels(labels: readonly MapLabel[]): void {
		this.labels = labels;
		this.invalidate();
	}

	setMode(mode: RendererMode): void {
		this.mode = mode;
		this.canvas.classList.toggle("is-paint", mode === "paint");
		this.canvas.classList.toggle("is-label", mode === "label");
		this.invalidate();
	}

	/** Brush size shown as a footprint under the cursor in paint mode. */
	setBrushRadius(radius: number): void {
		this.brushRadius = radius;
		this.invalidate();
	}

	setStickerResolver(resolver: StickerResolver): void {
		this.resolveSticker = resolver;
		this.invalidate();
	}

	/** Redraw painted chunks (keys from MapEditor's `terrain` event). */
	invalidateChunks(keys: Iterable<number>): void {
		this.chunks.invalidate(keys);
		this.invalidate();
	}

	/** Center on a tile, zooming in if the view is currently zoomed far out. */
	focusTile(x: number, y: number, minScale = 12): void {
		this.camera.centerOn(x, y);
		if (this.camera.scale < minScale) this.camera.scale = minScale;
		this.camera.clampCenter(this.grid.width, this.grid.height);
		this.invalidate();
	}

	invalidate(): void {
		if (this.frame) return;
		this.frame = this.win.requestAnimationFrame(() => {
			this.frame = 0;
			this.draw();
		});
	}

	destroy(): void {
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		if (this.frame) this.win.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.chunks.clear();
	}

	private get win(): Window {
		return this.canvas.ownerDocument.defaultView ?? window;
	}

	private listen(): void {
		const { canvas } = this;
		const on = <K extends keyof HTMLElementEventMap>(
			type: K,
			fn: (e: HTMLElementEventMap[K]) => void,
			options?: AddEventListenerOptions,
		) => {
			canvas.addEventListener(type, fn, options);
			this.disposers.push(() => canvas.removeEventListener(type, fn, options));
		};
		on("pointerdown", (e) => this.onPointerDown(e));
		on("pointermove", (e) => this.onPointerMove(e));
		on("pointerup", (e) => this.onPointerUp(e));
		on("pointercancel", (e) => this.endDrag(e));
		on("pointerleave", () => this.setHover(null, [], null));
		on("wheel", (e) => this.onWheel(e), { passive: false });
		on("contextmenu", (e) => this.onContextMenu(e));
		on("dragover", (e) => {
			if (e.dataTransfer?.types.includes("text/plain")) {
				e.preventDefault();
				e.dataTransfer.dropEffect = "copy";
			}
		});
		on("drop", (e) => this.onDrop(e));

		const observer = new ResizeObserver(() => this.resize());
		observer.observe(canvas);
		this.disposers.push(() => observer.disconnect());
	}

	private resize(): void {
		const { canvas } = this;
		this.dpr = this.win.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(canvas.clientWidth * this.dpr));
		canvas.height = Math.max(1, Math.round(canvas.clientHeight * this.dpr));
		this.camera.setViewport(canvas.clientWidth, canvas.clientHeight);
		this.invalidate();
	}

	private local(e: MouseEvent): Vec2 {
		const rect = this.canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	/** Pins whose badge covers a screen point, nearest first. */
	private pinsAt(sx: number, sy: number): Pin[] {
		const radius = pinRadius(this.camera.scale);
		const hits: Array<{ pin: Pin; d: number }> = [];
		for (const pin of this.pins) {
			const c = this.camera.worldToScreen(pin.x + 0.5, pin.y + 0.5);
			const d = Math.hypot(c.x - sx, c.y - sy);
			if (d <= radius) hits.push({ pin, d });
		}
		return hits.sort((a, b) => a.d - b.d).map((h) => h.pin);
	}

	/** The label under a screen point, topmost first, or null. */
	private labelAt(sx: number, sy: number): MapLabel | null {
		const { camera, ctx } = this;
		for (let i = this.labels.length - 1; i >= 0; i--) {
			const label = this.labels[i];
			if (!label.text || labelFontPx(label.size, camera.scale) < MIN_LABEL_PX) continue;
			const c = camera.worldToScreen(label.x, label.y);
			const { width, height } = measureLabel(ctx, label, camera.scale);
			if (Math.abs(sx - c.x) <= width / 2 + 4 && Math.abs(sy - c.y) <= height / 2 + 4) return label;
		}
		return null;
	}

	private onPointerDown(e: PointerEvent): void {
		if (this.drag) return;
		const plain = e.button === 0 && !e.shiftKey;
		const wantsPaint = plain && this.mode === "paint";
		const wantsPan = e.button === 1 || (e.button === 0 && (this.mode !== "paint" || e.shiftKey));
		if (!wantsPan && !wantsPaint) return;
		e.preventDefault();
		const p = this.local(e);
		const tile = this.camera.screenToTile(p.x, p.y);
		const label = plain && this.mode === "label" ? this.labelAt(p.x, p.y) : null;
		const world = this.camera.screenToWorld(p.x, p.y);
		this.drag = {
			id: e.pointerId,
			kind: wantsPaint ? "paint" : label ? "label" : "pan",
			button: e.button,
			startX: p.x,
			startY: p.y,
			lastX: p.x,
			lastY: p.y,
			moved: false,
			lastTile: tile,
			label: label ?? undefined,
			grab: label ? { x: label.x - world.x, y: label.y - world.y } : undefined,
		};
		this.canvas.setPointerCapture(e.pointerId);
		this.canvas.classList.add("is-dragging");
		this.callbacks.onDragStart?.();
		if (wantsPaint) this.callbacks.onStrokeStart?.(tile);
	}

	private onPointerMove(e: PointerEvent): void {
		const p = this.local(e);
		const d = this.drag;
		if (d && d.id === e.pointerId) {
			if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) > CLICK_SLOP_PX) d.moved = true;
			if (d.kind === "pan") {
				this.camera.panByPixels(p.x - d.lastX, p.y - d.lastY);
				this.camera.clampCenter(this.grid.width, this.grid.height);
				this.invalidate();
			} else if (d.kind === "label") {
				if (d.moved && d.label && d.grab) {
					const world = this.camera.screenToWorld(p.x, p.y);
					this.callbacks.onLabelMove?.(d.label.id, { x: world.x + d.grab.x, y: world.y + d.grab.y });
				}
			} else {
				const tile = this.camera.screenToTile(p.x, p.y);
				if (tile.x !== d.lastTile.x || tile.y !== d.lastTile.y) {
					this.callbacks.onStrokeMove?.(tile);
					d.lastTile = tile;
				}
			}
			d.lastX = p.x;
			d.lastY = p.y;
		}
		if (!this.drag) this.updateHover(p);
	}

	private onPointerUp(e: PointerEvent): void {
		const d = this.drag;
		if (!d || d.id !== e.pointerId) return;
		this.endDrag(e);
		const p = this.local(e);
		// the hover card was hidden for the drag: work out what is under the pointer again
		this.hover = null;
		this.hoverPins = [];
		this.updateHover(p);

		if (d.kind === "paint") {
			this.callbacks.onStrokeEnd?.();
			return;
		}
		if (d.kind === "label") {
			if (!d.label) return;
			if (d.moved) this.callbacks.onLabelMoveEnd?.(d.label.id);
			else this.callbacks.onLabelClick?.(d.label, p);
			return;
		}
		if (d.moved || d.button !== 0) return;
		const tile = this.camera.screenToTile(p.x, p.y);
		if (!this.grid.inBounds(tile.x, tile.y)) return;
		if (this.mode === "label") {
			this.callbacks.onLabelCreate?.(this.camera.screenToWorld(p.x, p.y), p);
		} else if (this.mode === "pan") {
			this.callbacks.onClick?.({ tile, pins: this.pinsAt(p.x, p.y), event: e });
		}
	}

	private endDrag(e: PointerEvent): void {
		this.drag = null;
		this.canvas.classList.remove("is-dragging");
		if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
	}

	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		const p = this.local(e);
		const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
		this.camera.zoomAt(p.x, p.y, Math.exp(-delta * 0.0015));
		this.camera.clampCenter(this.grid.width, this.grid.height);
		// zooming moves everything under the pointer, so a hover card has to be placed again
		this.hover = null;
		this.hoverPins = [];
		this.updateHover(p);
		this.invalidate();
	}

	private onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		const p = this.local(e);
		const tile = this.camera.screenToTile(p.x, p.y);
		if (this.grid.inBounds(tile.x, tile.y)) {
			this.callbacks.onContextMenu?.({ tile, pins: this.pinsAt(p.x, p.y), event: e });
		}
	}

	private onDrop(e: DragEvent): void {
		const text = e.dataTransfer?.getData("text/plain") ?? "";
		if (!text.startsWith(STICKER_DRAG_PREFIX)) return;
		e.preventDefault();
		const p = this.local(e);
		const tile = this.camera.screenToTile(p.x, p.y);
		if (this.grid.inBounds(tile.x, tile.y)) {
			this.callbacks.onDropSticker?.(tile, text.slice(STICKER_DRAG_PREFIX.length), e);
		}
	}

	private updateHover(p: Vec2): void {
		const tile = this.camera.screenToTile(p.x, p.y);
		const inside = this.grid.inBounds(tile.x, tile.y);
		const pins = inside ? this.pinsAt(p.x, p.y) : [];
		this.setHover(inside ? tile : null, pins, p);
		const overLabel = this.mode === "label" && this.labelAt(p.x, p.y) !== null;
		this.canvas.classList.toggle("is-over-label", overLabel);
	}

	private setHover(tile: Vec2 | null, pins: Pin[], point: Vec2 | null): void {
		const same =
			tile?.x === this.hover?.x &&
			tile?.y === this.hover?.y &&
			pins.length === this.hoverPins.length &&
			pins.every((p, i) => p.path === this.hoverPins[i].path);
		if (same) return;
		this.hover = tile;
		this.hoverPins = pins;
		this.canvas.classList.toggle("is-over-pin", pins.length > 0 && this.mode === "pan");
		this.callbacks.onHover?.({ tile, pins, point });
		this.invalidate();
	}

	private draw(): void {
		const { ctx, camera, grid, dpr } = this;
		ctx.imageSmoothingEnabled = false;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = BACKGROUND;
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		const view = camera.visibleRect();
		const cx0 = Math.max(0, Math.floor(view.x0 / CHUNK_SIZE));
		const cy0 = Math.max(0, Math.floor(view.y0 / CHUNK_SIZE));
		const cx1 = Math.min(Math.ceil(grid.width / CHUNK_SIZE) - 1, Math.floor(view.x1 / CHUNK_SIZE));
		const cy1 = Math.min(Math.ceil(grid.height / CHUNK_SIZE) - 1, Math.floor(view.y1 / CHUNK_SIZE));
		for (let cy = cy0; cy <= cy1; cy++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const chunk = this.chunks.get(cx, cy);
				const a = camera.worldToScreen(cx * CHUNK_SIZE, cy * CHUNK_SIZE);
				const b = camera.worldToScreen(cx * CHUNK_SIZE + chunk.width, cy * CHUNK_SIZE + chunk.height);
				// Round edges to whole *device* pixels (identity transform) so neighbouring chunks
				// share an exact edge; fractional edges blend with the background and show seams.
				const left = Math.round(a.x * dpr);
				const top = Math.round(a.y * dpr);
				ctx.drawImage(chunk, left, top, Math.round(b.x * dpr) - left, Math.round(b.y * dpr) - top);
			}
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.drawCursor();
		this.drawLines();
		this.drawLabels();
		this.drawPins(view);
	}

	private drawLabels(): void {
		const { ctx, camera, grid } = this;
		for (const label of this.labels) {
			// a label whose anchor is outside the map (after shrinking it) is kept in the file but not shown
			if (!grid.inBounds(Math.floor(label.x), Math.floor(label.y))) continue;
			const c = camera.worldToScreen(label.x, label.y);
			drawMapLabel(ctx, label, c.x, c.y, camera.scale);
		}
	}

	/** Each leg of a journey: solid once reached, dashed and faint while still ahead, with an arrow for direction. */
	private drawLines(): void {
		if (this.lines.length === 0) return;
		const { ctx, camera } = this;
		ctx.save();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const line of this.lines) {
			ctx.strokeStyle = line.color;
			ctx.fillStyle = line.color;
			for (const s of line.segments) {
				const a = camera.worldToScreen(s.x0 + 0.5, s.y0 + 0.5);
				const b = camera.worldToScreen(s.x1 + 0.5, s.y1 + 0.5);
				ctx.globalAlpha = s.traveled ? 0.95 : 0.45;
				ctx.lineWidth = 3;
				ctx.setLineDash(s.traveled ? [] : [7, 6]);
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.stroke();
				ctx.setLineDash([]);

				const mx = (a.x + b.x) / 2;
				const my = (a.y + b.y) / 2;
				const angle = Math.atan2(b.y - a.y, b.x - a.x);
				ctx.beginPath();
				ctx.moveTo(mx + Math.cos(angle) * 7, my + Math.sin(angle) * 7);
				ctx.lineTo(mx + Math.cos(angle + 2.5) * 7, my + Math.sin(angle + 2.5) * 7);
				ctx.lineTo(mx + Math.cos(angle - 2.5) * 7, my + Math.sin(angle - 2.5) * 7);
				ctx.closePath();
				ctx.fill();

				for (const p of [a, b]) {
					ctx.beginPath();
					ctx.arc(p.x, p.y, 3.5, 0, TAU);
					ctx.fill();
				}
			}
		}
		ctx.restore();
	}

	private drawCursor(): void {
		const { ctx, camera } = this;
		if (!this.hover) return;
		if (this.mode === "paint") {
			ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
			for (const t of brushFootprint(this.hover.x, this.hover.y, this.brushRadius)) {
				if (!this.grid.inBounds(t.x, t.y)) continue;
				const a = camera.worldToScreen(t.x, t.y);
				ctx.fillRect(a.x, a.y, camera.scale, camera.scale);
			}
			return;
		}
		const a = camera.worldToScreen(this.hover.x, this.hover.y);
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
		ctx.strokeRect(a.x + 0.5, a.y + 0.5, camera.scale - 1, camera.scale - 1);
	}

	private drawPins(view: { x0: number; y0: number; x1: number; y1: number }): void {
		const { ctx, camera } = this;
		const radius = pinRadius(camera.scale);
		const visible: Array<{ pin: Pin; x: number; y: number }> = [];
		for (const pin of this.pins) {
			if (pin.x + 1 < view.x0 || pin.x > view.x1 || pin.y + 1 < view.y0 || pin.y > view.y1) continue;
			const c = camera.worldToScreen(pin.x + 0.5, pin.y + 0.5);
			visible.push({ pin, x: c.x, y: c.y });
		}
		// tracked characters (the ones with a ring) are drawn last so they sit on top of what they stand next to
		visible.sort((a, b) => Number(this.rings.has(a.pin.path)) - Number(this.rings.has(b.pin.path)));
		for (const { pin, x, y } of visible) {
			drawPin(ctx, x, y, radius, getNodeType(pin.type).color, this.resolveSticker(pin));
			const ring = this.rings.get(pin.path);
			if (ring) {
				ctx.beginPath();
				ctx.arc(x, y, radius + 3, 0, TAU);
				ctx.lineWidth = 3;
				ctx.strokeStyle = ring;
				ctx.stroke();
			}
		}

		// one label per tile: when pins share a tile, name the top one and count the rest
		const hovered = new Set(this.hoverPins.map((p) => p.path));
		const byTile = new Map<string, Array<{ pin: Pin; x: number; y: number }>>();
		for (const entry of visible) {
			const key = `${entry.pin.x},${entry.pin.y}`;
			const group = byTile.get(key);
			if (group) group.push(entry);
			else byTile.set(key, [entry]);
		}
		for (const group of byTile.values()) {
			const top = group[group.length - 1];
			if (camera.scale < LABEL_MIN_SCALE && !group.some((e) => hovered.has(e.pin.path))) continue;
			const extra = group.length > 1 ? ` +${group.length - 1}` : "";
			drawPinLabel(ctx, top.pin.name + extra, top.x, top.y, radius);
		}
	}
}
