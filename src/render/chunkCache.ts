import { CHUNK_SIZE, type TileGrid } from "../core/grid";
import type { Terrain } from "../core/types";
import { writeTileColor } from "./palette";

/**
 * Pre-renders the terrain once per 64x64-tile chunk at 1 pixel per tile. Drawing a frame
 * is then just a handful of scaled drawImage calls, however many tiles are on screen.
 * Painting invalidates only the chunks it touched.
 */
export class ChunkCache {
	private readonly chunks = new Map<number, HTMLCanvasElement>();

	constructor(private readonly grid: TileGrid) {}

	get(cx: number, cy: number): HTMLCanvasElement {
		const key = cy * 65536 + cx;
		let chunk = this.chunks.get(key);
		if (!chunk) {
			chunk = this.build(cx, cy);
			this.chunks.set(key, chunk);
		}
		return chunk;
	}

	/** Forget chunks (by key) so they are redrawn from the grid next frame. */
	invalidate(keys: Iterable<number>): void {
		for (const key of keys) this.chunks.delete(key);
	}

	clear(): void {
		this.chunks.clear();
	}

	private build(cx: number, cy: number): HTMLCanvasElement {
		const { grid } = this;
		const x0 = cx * CHUNK_SIZE;
		const y0 = cy * CHUNK_SIZE;
		const w = Math.min(CHUNK_SIZE, grid.width - x0);
		const h = Math.min(CHUNK_SIZE, grid.height - y0);

		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2D canvas is not available");

		const image = ctx.createImageData(w, h);
		for (let ty = 0; ty < h; ty++) {
			for (let tx = 0; tx < w; tx++) {
				const i = (y0 + ty) * grid.width + (x0 + tx);
				writeTileColor(grid.terrain[i] as Terrain, grid.heights[i], image.data, (ty * w + tx) * 4);
			}
		}
		ctx.putImageData(image, 0, 0);
		return canvas;
	}
}
