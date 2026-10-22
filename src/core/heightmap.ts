import { createNoise2D } from "simplex-noise";
import { hashSeed, mulberry32 } from "./rng";
import { Terrain, type MapDefinition } from "./types";

/*
 * Generator v1 is FROZEN. Changing any constant below changes every saved world.
 * To improve terrain, add a "v2" generator and keep this one untouched.
 *
 * Height at (x, y) is a pure function of the seed and the coordinates, so growing a
 * map (or changing its width/height) never moves existing terrain or pins.
 */
const WAVELENGTH = 64; // tiles per feature at the lowest octave
const OCTAVES = 5;
const LACUNARITY = 2;
const GAIN = 0.5;
const CONTRAST = 0.8;

/** Height thresholds (heights are in [0, 1]). */
export const DEEP_MAX = 0.32;
export const SHALLOW_MAX = 0.42;
export const MOUNTAIN_MIN = 0.72;

/** [min, max) height range of each terrain class, for shading within a band. */
export const TERRAIN_BANDS: Record<Terrain, readonly [number, number]> = {
	[Terrain.DeepOcean]: [0, DEEP_MAX],
	[Terrain.ShallowWater]: [DEEP_MAX, SHALLOW_MAX],
	[Terrain.Land]: [SHALLOW_MAX, MOUNTAIN_MIN],
	[Terrain.Mountain]: [MOUNTAIN_MIN, 1],
};

export function classify(height: number): Terrain {
	if (height < DEEP_MAX) return Terrain.DeepOcean;
	if (height < SHALLOW_MAX) return Terrain.ShallowWater;
	if (height < MOUNTAIN_MIN) return Terrain.Land;
	return Terrain.Mountain;
}

export function createHeightSampler(seed: string): (x: number, y: number) => number {
	const noise = createNoise2D(mulberry32(hashSeed(seed)));
	return (x, y) => {
		let amplitude = 1;
		let frequency = 1 / WAVELENGTH;
		let sum = 0;
		let norm = 0;
		for (let o = 0; o < OCTAVES; o++) {
			sum += amplitude * noise((x + 0.5) * frequency, (y + 0.5) * frequency);
			norm += amplitude;
			amplitude *= GAIN;
			frequency *= LACUNARITY;
		}
		const h = 0.5 + (sum / norm) * CONTRAST;
		return h < 0 ? 0 : h > 1 ? 1 : h;
	};
}

/** The height function for a map definition. Throws for generator versions this build doesn't know. */
export function samplerFor(def: MapDefinition): (x: number, y: number) => number {
	if (def.generator !== "v1") throw new Error(`Unknown terrain generator: ${String(def.generator)}`);
	return createHeightSampler(def.seed);
}

export function generateHeights(def: MapDefinition): Float32Array {
	const sample = samplerFor(def);
	const heights = new Float32Array(def.width * def.height);
	for (let y = 0; y < def.height; y++) {
		for (let x = 0; x < def.width; x++) {
			heights[y * def.width + x] = sample(x, y);
		}
	}
	return heights;
}
