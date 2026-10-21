import { describe, expect, it } from "vitest";
import { classify, createHeightSampler, generateHeights, DEEP_MAX, MOUNTAIN_MIN, SHALLOW_MAX } from "./heightmap";
import { TileGrid } from "./grid";
import { hashSeed, mulberry32 } from "./rng";
import { Terrain, type MapDefinition } from "./types";

const def: MapDefinition = { id: "t", seed: "wbuilder", generator: "v1", width: 128, height: 96 };

describe("rng", () => {
	it("is deterministic and in [0, 1)", () => {
		const a = mulberry32(hashSeed("abc"));
		const b = mulberry32(hashSeed("abc"));
		for (let i = 0; i < 100; i++) {
			const v = a();
			expect(v).toBe(b());
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it("hashes different seeds differently", () => {
		expect(hashSeed("a")).not.toBe(hashSeed("b"));
	});
});

describe("heightmap", () => {
	it("is deterministic for a seed and stays in [0, 1]", () => {
		const a = generateHeights(def);
		const b = generateHeights(def);
		expect(a).toEqual(b);
		expect(a.length).toBe(def.width * def.height);
		for (const h of a) {
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThanOrEqual(1);
		}
	});

	it("differs between seeds", () => {
		expect(generateHeights({ ...def, seed: "other" })).not.toEqual(generateHeights(def));
	});

	it("does not depend on map size, so growing a map never moves terrain", () => {
		const small = createHeightSampler("wbuilder");
		const small2 = generateHeights({ ...def, width: 40, height: 40 });
		const big = generateHeights({ ...def, width: 200, height: 200 });
		for (const [x, y] of [[0, 0], [10, 20], [39, 39]]) {
			expect(small2[y * 40 + x]).toBeCloseTo(small(x, y), 6);
			expect(big[y * 200 + x]).toBeCloseTo(small(x, y), 6);
		}
	});

	it("rejects unknown generator versions", () => {
		expect(() => generateHeights({ ...def, generator: "v2" as "v1" })).toThrow();
	});

	it("classifies at the band edges", () => {
		expect(classify(0)).toBe(Terrain.DeepOcean);
		expect(classify(DEEP_MAX - 1e-6)).toBe(Terrain.DeepOcean);
		expect(classify(DEEP_MAX)).toBe(Terrain.ShallowWater);
		expect(classify(SHALLOW_MAX)).toBe(Terrain.Land);
		expect(classify(MOUNTAIN_MIN)).toBe(Terrain.Mountain);
		expect(classify(1)).toBe(Terrain.Mountain);
	});

	it("produces all four terrain types on a 256x256 map", () => {
		const grid = TileGrid.generate({ ...def, width: 256, height: 256 });
		const counts = new Map<number, number>();
		for (const t of grid.terrain) counts.set(t, (counts.get(t) ?? 0) + 1);
		for (const t of Object.values(Terrain)) expect(counts.get(t) ?? 0).toBeGreaterThan(256 * 256 * 0.02);
	});
});

describe("TileGrid", () => {
	it("hit-tests bounds and reads terrain", () => {
		const grid = TileGrid.generate(def);
		expect(grid.inBounds(0, 0)).toBe(true);
		expect(grid.inBounds(def.width - 1, def.height - 1)).toBe(true);
		expect(grid.inBounds(def.width, 0)).toBe(false);
		expect(grid.inBounds(-1, 0)).toBe(false);
		expect(grid.terrainAt(5, 7)).toBe(classify(grid.heightAt(5, 7)));
	});
});
