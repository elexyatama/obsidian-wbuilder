import { TERRAIN_BANDS } from "../core/heightmap";
import { Terrain } from "../core/types";

type RGB = readonly [number, number, number];

/** Color at the bottom and the top of each terrain band; tiles blend by height. */
const RAMPS: Record<Terrain, readonly [RGB, RGB]> = {
	[Terrain.DeepOcean]: [[12, 30, 78], [30, 66, 128]],
	[Terrain.ShallowWater]: [[46, 104, 168], [92, 160, 204]],
	[Terrain.Land]: [[104, 156, 80], [176, 176, 96]],
	[Terrain.Mountain]: [[122, 108, 96], [238, 238, 242]],
};

/** Writes the RGBA color of a tile into `out` at `offset`. */
export function writeTileColor(terrain: Terrain, height: number, out: Uint8ClampedArray, offset: number): void {
	const [lo, hi] = TERRAIN_BANDS[terrain];
	const t = Math.min(1, Math.max(0, (height - lo) / (hi - lo)));
	const [a, b] = RAMPS[terrain];
	out[offset] = a[0] + (b[0] - a[0]) * t;
	out[offset + 1] = a[1] + (b[1] - a[1]) * t;
	out[offset + 2] = a[2] + (b[2] - a[2]) * t;
	out[offset + 3] = 255;
}
