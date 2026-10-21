import { applyBrushStamp, type Brush } from "./brush";
import { Emitter, type Unsubscribe } from "./emitter";
import type { TileGrid } from "./grid";

/** One undoable brush stroke: the override level of every tile it touched, before and after. */
interface Stroke {
	indices: number[];
	before: number[];
	after: number[];
}

const MAX_UNDO = 100;

interface EditorEvents {
	/** Chunks whose terrain changed and need redrawing. */
	terrain: ReadonlySet<number>;
	/** Undo/redo availability changed. */
	history: null;
}

/**
 * Brush editing of a TileGrid with undo/redo. Pure logic: the renderer feeds it tile
 * coordinates and redraws the chunks it reports.
 */
export class MapEditor {
	brush: Brush = { mode: "land", radius: 3, strength: 0.5 };
	private undoStack: Stroke[] = [];
	private redoStack: Stroke[] = [];
	private current: { before: Map<number, number>; lastX: number; lastY: number } | null = null;
	private emitter = new Emitter<EditorEvents>();

	constructor(private readonly grid: TileGrid) {}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	beginStroke(x: number, y: number): void {
		this.current = { before: new Map(), lastX: x, lastY: y };
		this.stamp(x, y);
	}

	/** Continues the stroke to (x, y), stamping every tile on the way so fast drags leave no gaps. */
	strokeTo(x: number, y: number): void {
		const stroke = this.current;
		if (!stroke) return;
		let { lastX, lastY } = stroke;
		const dx = Math.abs(x - lastX);
		const dy = Math.abs(y - lastY);
		const sx = lastX < x ? 1 : -1;
		const sy = lastY < y ? 1 : -1;
		let err = dx - dy;
		while (lastX !== x || lastY !== y) {
			const e2 = 2 * err;
			if (e2 > -dy) {
				err -= dy;
				lastX += sx;
			}
			if (e2 < dx) {
				err += dx;
				lastY += sy;
			}
			this.stamp(lastX, lastY);
		}
		stroke.lastX = x;
		stroke.lastY = y;
	}

	/** Finishes the stroke. Returns true if it changed anything (so the map should be saved). */
	endStroke(): boolean {
		const stroke = this.current;
		this.current = null;
		if (!stroke || stroke.before.size === 0) return false;
		const indices = [...stroke.before.keys()];
		this.undoStack.push({
			indices,
			before: indices.map((i) => stroke.before.get(i) as number),
			after: indices.map((i) => this.grid.overrides[i]),
		});
		if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
		this.redoStack = [];
		this.emitter.emit("history", null);
		return true;
	}

	undo(): boolean {
		const stroke = this.undoStack.pop();
		if (!stroke) return false;
		this.apply(stroke.indices, stroke.before);
		this.redoStack.push(stroke);
		this.emitter.emit("history", null);
		return true;
	}

	redo(): boolean {
		const stroke = this.redoStack.pop();
		if (!stroke) return false;
		this.apply(stroke.indices, stroke.after);
		this.undoStack.push(stroke);
		this.emitter.emit("history", null);
		return true;
	}

	on<K extends keyof EditorEvents>(event: K, fn: (payload: EditorEvents[K]) => void): Unsubscribe {
		return this.emitter.on(event, fn);
	}

	private stamp(x: number, y: number): void {
		const stroke = this.current;
		if (!stroke) return;
		const dirty = applyBrushStamp(this.grid, this.brush, x, y, (i) => {
			if (!stroke.before.has(i)) stroke.before.set(i, this.grid.overrides[i]);
		});
		if (dirty.size > 0) this.emitter.emit("terrain", dirty);
	}

	private apply(indices: number[], levels: number[]): void {
		const dirty = new Set<number>();
		indices.forEach((index, k) => {
			this.grid.setOverride(index, levels[k]);
			dirty.add(this.grid.chunkKeyOfIndex(index));
		});
		this.emitter.emit("terrain", dirty);
	}
}
