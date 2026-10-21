import { NO_OVERRIDE, chunkKey, quantize, CHUNK_SIZE, type TileGrid } from "./grid";

export type BrushMode = "deep" | "shallow" | "land" | "mountain" | "raise" | "lower" | "reset";

export const BRUSH_MODES: readonly { id: BrushMode; label: string; hint: string }[] = [
	{ id: "deep", label: "Deep water", hint: "Paint deep ocean" },
	{ id: "shallow", label: "Shallows", hint: "Paint shallow water" },
	{ id: "land", label: "Land", hint: "Paint plains" },
	{ id: "mountain", label: "Mountain", hint: "Paint mountains" },
	{ id: "raise", label: "Raise", hint: "Raise elevation gradually" },
	{ id: "lower", label: "Lower", hint: "Lower elevation gradually" },
	{ id: "reset", label: "Reset", hint: "Restore the generated terrain" },
];

export interface Brush {
	mode: BrushMode;
	/** Size in tiles: 1 is a single tile, 3 is a 3x3 blob, and so on. */
	radius: number;
	/** 0..1, how fast raise/lower change the height. */
	strength: number;
}

export const MIN_BRUSH_RADIUS = 1;
export const MAX_BRUSH_RADIUS = 24;

/** Height a paint brush sets (the middle of its terrain band). */
const PAINT_HEIGHT = { deep: 0.2, shallow: 0.37, land: 0.52, mountain: 0.82 } as const;

/** Height change per stamp at full strength in the middle of the brush. */
const RAISE_STEP = 0.05;

export interface BrushTile {
	x: number;
	y: number;
	/** 1 in the middle, fading towards the edge. */
	weight: number;
}

/** Tiles covered by a brush centered on (cx, cy). */
export function brushFootprint(cx: number, cy: number, radius: number): BrushTile[] {
	const r = Math.max(MIN_BRUSH_RADIUS, Math.round(radius));
	const reach = r - 0.5;
	const span = Math.ceil(reach);
	const tiles: BrushTile[] = [];
	for (let dy = -span; dy <= span; dy++) {
		for (let dx = -span; dx <= span; dx++) {
			const d2 = dx * dx + dy * dy;
			if (d2 <= reach * reach) tiles.push({ x: cx + dx, y: cy + dy, weight: 1 - Math.sqrt(d2) / r });
		}
	}
	return tiles;
}

/**
 * Applies one stamp of the brush. `touch(index)` is called before a tile changes so the
 * caller can remember its old value for undo. Returns the chunks that changed.
 */
export function applyBrushStamp(
	grid: TileGrid,
	brush: Brush,
	cx: number,
	cy: number,
	touch: (index: number) => void,
): Set<number> {
	const dirty = new Set<number>();
	for (const tile of brushFootprint(cx, cy, brush.radius)) {
		if (!grid.inBounds(tile.x, tile.y)) continue;
		const i = tile.y * grid.width + tile.x;
		let level: number;
		switch (brush.mode) {
			case "reset":
				level = NO_OVERRIDE;
				break;
			case "raise":
				level = quantize(grid.heights[i] + RAISE_STEP * brush.strength * tile.weight);
				break;
			case "lower":
				level = quantize(grid.heights[i] - RAISE_STEP * brush.strength * tile.weight);
				break;
			default:
				level = quantize(PAINT_HEIGHT[brush.mode]);
		}
		if (grid.overrides[i] === level) continue;
		touch(i);
		grid.setOverride(i, level);
		dirty.add(chunkKey(Math.floor(tile.x / CHUNK_SIZE), Math.floor(tile.y / CHUNK_SIZE)));
	}
	return dirty;
}
