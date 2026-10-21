import { base64ToBytes, bytesToBase64 } from "./base64";
import { classify, samplerFor } from "./heightmap";
import type { MapDefinition, Terrain } from "./types";

/** Tiles per chunk side. Chunks are the unit of rendering cache and of saved edits. */
export const CHUNK_SIZE = 64;

/** Marks a tile whose height still comes from the procedural generator. */
export const NO_OVERRIDE = 255;
const MAX_LEVEL = 254;

/** Heights are stored as 0..254 when edited. */
export const quantize = (height: number) => Math.round(Math.min(1, Math.max(0, height)) * MAX_LEVEL);

export const chunkKey = (cx: number, cy: number) => cy * 65536 + cx;

/**
 * A tile map: one height and one terrain class per tile, row-major. Heights start as the
 * procedural terrain for the map's seed; painted tiles carry an *override* so that saving
 * only needs the edits, and "reset" can bring the generated terrain back.
 */
export class TileGrid {
	private constructor(
		readonly width: number,
		readonly height: number,
		readonly terrain: Uint8Array,
		readonly heights: Float32Array,
		/** Per tile: NO_OVERRIDE, or the painted height as 0..254. */
		readonly overrides: Uint8Array,
		private readonly sample: (x: number, y: number) => number,
	) {}

	static generate(def: MapDefinition, edits: Record<string, string> = {}): TileGrid {
		const sample = samplerFor(def);
		const count = def.width * def.height;
		const heights = new Float32Array(count);
		const terrain = new Uint8Array(count);
		for (let y = 0; y < def.height; y++) {
			for (let x = 0; x < def.width; x++) {
				const i = y * def.width + x;
				heights[i] = sample(x, y);
				terrain[i] = classify(heights[i]);
			}
		}
		const grid = new TileGrid(
			def.width,
			def.height,
			terrain,
			heights,
			new Uint8Array(count).fill(NO_OVERRIDE),
			sample,
		);
		grid.loadEdits(edits);
		return grid;
	}

	inBounds(x: number, y: number): boolean {
		return x >= 0 && y >= 0 && x < this.width && y < this.height;
	}

	terrainAt(x: number, y: number): Terrain {
		return this.terrain[y * this.width + x] as Terrain;
	}

	heightAt(x: number, y: number): number {
		return this.heights[y * this.width + x];
	}

	/** Chunk key of the tile at array index `i`. */
	chunkKeyOfIndex(i: number): number {
		const x = i % this.width;
		const y = (i - x) / this.width;
		return chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
	}

	/** Sets (0..254) or clears (NO_OVERRIDE) the painted height of tile `i`. */
	setOverride(i: number, level: number): void {
		this.overrides[i] = level;
		const height = level === NO_OVERRIDE ? this.sample(i % this.width, Math.floor(i / this.width)) : level / MAX_LEVEL;
		this.heights[i] = height;
		this.terrain[i] = classify(height);
	}

	/** Painted tiles as base64 per chunk ("cx,cy" -> bytes), ready to save in the map file. */
	exportEdits(): Record<string, string> {
		return encodeOverrides(this.overrides, this.width, this.height);
	}

	private loadEdits(edits: Record<string, string>): void {
		const overrides = decodeOverrides(edits, this.width, this.height);
		for (let i = 0; i < overrides.length; i++) {
			if (overrides[i] !== NO_OVERRIDE) this.setOverride(i, overrides[i]);
		}
	}
}

/**
 * Painted levels per tile (NO_OVERRIDE where untouched) from a saved map's edits. Chunks at the
 * right and bottom edge are stored at their real, smaller size, so the map's width and height are
 * needed to read them. Corrupt chunks are skipped.
 */
export function decodeOverrides(edits: Record<string, string>, width: number, height: number): Uint8Array {
	const overrides = new Uint8Array(width * height).fill(NO_OVERRIDE);
	for (const [key, encoded] of Object.entries(edits)) {
		const match = /^(\d+),(\d+)$/.exec(key);
		if (!match) continue;
		const x0 = Number(match[1]) * CHUNK_SIZE;
		const y0 = Number(match[2]) * CHUNK_SIZE;
		if (x0 >= width || y0 >= height) continue;
		const w = Math.min(CHUNK_SIZE, width - x0);
		const h = Math.min(CHUNK_SIZE, height - y0);
		let bytes: Uint8Array;
		try {
			bytes = base64ToBytes(encoded);
		} catch {
			continue;
		}
		if (bytes.length !== w * h) continue;
		for (let ty = 0; ty < h; ty++) {
			for (let tx = 0; tx < w; tx++) {
				const level = bytes[ty * w + tx];
				if (level <= MAX_LEVEL) overrides[(y0 + ty) * width + x0 + tx] = level;
			}
		}
	}
	return overrides;
}

/** The inverse of decodeOverrides: only chunks with at least one painted tile are written. */
export function encodeOverrides(overrides: Uint8Array, width: number, height: number): Record<string, string> {
	const edits: Record<string, string> = {};
	const chunksX = Math.ceil(width / CHUNK_SIZE);
	const chunksY = Math.ceil(height / CHUNK_SIZE);
	for (let cy = 0; cy < chunksY; cy++) {
		for (let cx = 0; cx < chunksX; cx++) {
			const x0 = cx * CHUNK_SIZE;
			const y0 = cy * CHUNK_SIZE;
			const w = Math.min(CHUNK_SIZE, width - x0);
			const h = Math.min(CHUNK_SIZE, height - y0);
			const bytes = new Uint8Array(w * h);
			let edited = false;
			for (let ty = 0; ty < h; ty++) {
				for (let tx = 0; tx < w; tx++) {
					const level = overrides[(y0 + ty) * width + x0 + tx];
					bytes[ty * w + tx] = level;
					if (level !== NO_OVERRIDE) edited = true;
				}
			}
			if (edited) edits[`${cx},${cy}`] = bytesToBase64(bytes);
		}
	}
	return edits;
}
