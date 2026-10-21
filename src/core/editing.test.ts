import { describe, expect, it, vi } from "vitest";
import { MAX_BRUSH_RADIUS, brushFootprint, type Brush } from "./brush";
import { CHUNK_SIZE, NO_OVERRIDE, TileGrid } from "./grid";
import { MapEditor } from "./mapEditor";
import { createMapData, parseMapData, serializeMapData } from "./mapFile";
import { Terrain, type MapDefinition } from "./types";

const def: MapDefinition = { id: "t", seed: "wbuilder", generator: "v1", width: 100, height: 70 };

const paint = (mode: Brush["mode"], radius = 1, strength = 1): Brush => ({ mode, radius, strength });

describe("brushFootprint", () => {
	it("covers 1, 9 and a rounded blob for radius 1, 2 and 3", () => {
		expect(brushFootprint(10, 10, 1)).toHaveLength(1);
		expect(brushFootprint(10, 10, 2)).toHaveLength(9);
		expect(brushFootprint(10, 10, 3)).toHaveLength(21);
	});

	it("is centered, strongest in the middle, and clamped to a sensible size", () => {
		const tiles = brushFootprint(5, 5, 4);
		const middle = tiles.find((t) => t.x === 5 && t.y === 5);
		expect(middle?.weight).toBe(1);
		expect(Math.max(...tiles.map((t) => t.weight))).toBe(1);
		expect(tiles.every((t) => t.weight > 0)).toBe(true);
		expect(brushFootprint(0, 0, 0)).toHaveLength(1);
		expect(brushFootprint(0, 0, MAX_BRUSH_RADIUS).length).toBeGreaterThan(1000);
	});
});

describe("TileGrid overrides", () => {
	it("starts with no overrides and the generated terrain", () => {
		const grid = TileGrid.generate(def);
		expect(grid.overrides.every((v) => v === NO_OVERRIDE)).toBe(true);
		expect(grid.exportEdits()).toEqual({});
	});

	it("round-trips painted tiles through exportEdits, including partial edge chunks", () => {
		const grid = TileGrid.generate(def);
		const tiles: Array<[number, number]> = [[0, 0], [CHUNK_SIZE, 5], [99, 69], [70, 66]];
		for (const [x, y] of tiles) grid.setOverride(y * def.width + x, 200);
		const edits = grid.exportEdits();
		expect(Object.keys(edits).sort()).toEqual(["0,0", "1,0", "1,1"]);

		const loaded = TileGrid.generate(def, edits);
		for (const [x, y] of tiles) expect(loaded.heightAt(x, y)).toBeCloseTo(200 / 254, 5);
		expect(loaded.heights).toEqual(grid.heights);
		expect(loaded.terrain).toEqual(grid.terrain);
	});

	it("restores the generated height when an override is cleared", () => {
		const pristine = TileGrid.generate(def);
		const grid = TileGrid.generate(def);
		grid.setOverride(500, 10);
		expect(grid.heights[500]).not.toBe(pristine.heights[500]);
		grid.setOverride(500, NO_OVERRIDE);
		expect(grid.heights[500]).toBe(pristine.heights[500]);
		expect(grid.terrain[500]).toBe(pristine.terrain[500]);
	});

	it("ignores corrupt edit data", () => {
		const grid = TileGrid.generate(def, { "0,0": "not base64 !!", "9,9": "AAAA", "x": "AAAA", "0,1": "AAAA" });
		expect(grid.overrides.every((v) => v === NO_OVERRIDE)).toBe(true);
	});
});

describe("MapEditor", () => {
	it("paints terrain classes and reports the touched chunks", () => {
		const grid = TileGrid.generate(def);
		const editor = new MapEditor(grid);
		const chunks = vi.fn();
		editor.on("terrain", chunks);
		editor.brush = paint("deep", 3);
		editor.beginStroke(10, 10);
		expect(editor.endStroke()).toBe(true);
		expect(grid.terrainAt(10, 10)).toBe(Terrain.DeepOcean);
		expect(grid.terrainAt(11, 10)).toBe(Terrain.DeepOcean);
		expect(chunks).toHaveBeenCalled();

		editor.brush = paint("mountain", 1);
		editor.beginStroke(10, 10);
		editor.endStroke();
		expect(grid.terrainAt(10, 10)).toBe(Terrain.Mountain);
		editor.brush = paint("land", 1);
		editor.beginStroke(10, 10);
		editor.endStroke();
		expect(grid.terrainAt(10, 10)).toBe(Terrain.Land);
	});

	it("raises and lowers gradually, crossing terrain bands", () => {
		const grid = TileGrid.generate(def);
		const editor = new MapEditor(grid);
		editor.brush = paint("deep", 1);
		editor.beginStroke(20, 20);
		editor.endStroke();
		const low = grid.heightAt(20, 20);
		editor.brush = paint("raise", 1, 1);
		for (let i = 0; i < 6; i++) {
			editor.beginStroke(20, 20);
			editor.endStroke();
		}
		expect(grid.heightAt(20, 20)).toBeGreaterThan(low + 0.2);
		expect(grid.terrainAt(20, 20)).not.toBe(Terrain.DeepOcean);
		const high = grid.heightAt(20, 20);
		editor.brush = paint("lower", 1, 1);
		editor.beginStroke(20, 20);
		editor.endStroke();
		expect(grid.heightAt(20, 20)).toBeLessThan(high);
	});

	it("stamps every tile along a fast drag", () => {
		const grid = TileGrid.generate(def);
		const editor = new MapEditor(grid);
		editor.brush = paint("mountain", 1);
		editor.beginStroke(5, 5);
		editor.strokeTo(15, 9);
		editor.endStroke();
		const painted = [...grid.overrides].filter((v) => v !== NO_OVERRIDE).length;
		expect(painted).toBe(11);
		expect(grid.terrainAt(15, 9)).toBe(Terrain.Mountain);
	});

	it("ignores tiles outside the map and strokes that change nothing", () => {
		const grid = TileGrid.generate(def);
		const editor = new MapEditor(grid);
		editor.brush = paint("land", 3);
		editor.beginStroke(-50, -50);
		expect(editor.endStroke()).toBe(false);
		editor.brush = paint("reset", 3);
		editor.beginStroke(10, 10);
		expect(editor.endStroke()).toBe(false);
		expect(editor.canUndo).toBe(false);
	});

	it("undoes and redoes whole strokes exactly", () => {
		const grid = TileGrid.generate(def);
		const pristine = TileGrid.generate(def);
		const editor = new MapEditor(grid);
		editor.brush = paint("deep", 4);
		editor.beginStroke(30, 30);
		editor.strokeTo(40, 30);
		editor.endStroke();
		const painted = new Float32Array(grid.heights);
		expect(painted).not.toEqual(pristine.heights);

		expect(editor.undo()).toBe(true);
		expect(grid.heights).toEqual(pristine.heights);
		expect(grid.terrain).toEqual(pristine.terrain);
		expect(grid.overrides.every((v) => v === NO_OVERRIDE)).toBe(true);
		expect(editor.canUndo).toBe(false);
		expect(editor.canRedo).toBe(true);

		expect(editor.redo()).toBe(true);
		expect(grid.heights).toEqual(painted);
		expect(editor.redo()).toBe(false);
	});

	it("drops the redo history after a new stroke", () => {
		const editor = new MapEditor(TileGrid.generate(def));
		editor.brush = paint("deep", 1);
		editor.beginStroke(1, 1);
		editor.endStroke();
		editor.undo();
		expect(editor.canRedo).toBe(true);
		editor.beginStroke(2, 2);
		editor.endStroke();
		expect(editor.canRedo).toBe(false);
	});

	it("resets painted tiles back to the generated terrain", () => {
		const grid = TileGrid.generate(def);
		const pristine = TileGrid.generate(def);
		const editor = new MapEditor(grid);
		editor.brush = paint("mountain", 5);
		editor.beginStroke(50, 30);
		editor.endStroke();
		editor.brush = paint("reset", 8);
		editor.beginStroke(50, 30);
		editor.endStroke();
		expect(grid.heights).toEqual(pristine.heights);
		expect(grid.exportEdits()).toEqual({});
	});
});

describe("map file", () => {
	it("round-trips a map with edits", () => {
		const grid = TileGrid.generate(def);
		const editor = new MapEditor(grid);
		editor.brush = paint("mountain", 4);
		editor.beginStroke(20, 20);
		editor.endStroke();

		const data = { ...createMapData({ id: "world", seed: "s", width: def.width, height: def.height }), edits: grid.exportEdits() };
		const parsed = parseMapData(serializeMapData(data));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.data).toEqual(data);
			const reloaded = TileGrid.generate(parsed.data, parsed.data.edits);
			expect(reloaded.terrainAt(20, 20)).toBe(Terrain.Mountain);
		}
	});

	it("explains what is wrong with a bad file", () => {
		expect(parseMapData("{not json").ok).toBe(false);
		expect(parseMapData("{}").ok).toBe(false);
		const tooBig = { ...createMapData({ id: "w", seed: "s", width: 5000, height: 64 }) };
		const result = parseMapData(JSON.stringify(tooBig));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("width");
		const unknownGenerator = JSON.stringify({ ...createMapData({ id: "w", seed: "s", width: 64, height: 64 }), generator: "v9" });
		expect(parseMapData(unknownGenerator).ok).toBe(false);
	});
});
