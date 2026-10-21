import * as z from "zod/mini";
import { decodeOverrides, encodeOverrides, NO_OVERRIDE } from "./grid";
import type { MapDefinition } from "./types";

export const MAP_EXTENSION = "worldmap";
export const MIN_MAP_SIZE = 16;
export const MAX_MAP_SIZE = 1024;

export const LABEL_SIZES = ["s", "m", "l", "xl"] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

/**
 * Text written straight onto a map (a region, a sea, a mountain range), as opposed to a note's
 * pin. Positions are in tile units and need not be whole tiles.
 */
export interface MapLabel {
	id: string;
	text: string;
	x: number;
	y: number;
	size: LabelSize;
}

/** Contents of a `.worldmap` file: how to regenerate the terrain, the painted edits, and the labels. */
export interface MapData extends MapDefinition {
	version: 1;
	/** Painted tiles per chunk ("cx,cy" -> base64), see TileGrid.exportEdits. */
	edits: Record<string, string>;
	labels: MapLabel[];
}

export type MapParseResult = { ok: true; data: MapData } | { ok: false; error: string };

const size = () => z.int().check(z.gte(MIN_MAP_SIZE), z.lte(MAX_MAP_SIZE));

const schema = z.object({
	version: z.literal(1),
	id: z.string().check(z.minLength(1)),
	seed: z.string(),
	generator: z.literal("v1"),
	width: size(),
	height: size(),
	edits: z.record(z.string(), z.string()),
	// older map files have no labels
	labels: z.optional(
		z.array(z.object({ id: z.string(), text: z.string(), x: z.number(), y: z.number(), size: z.enum(LABEL_SIZES) })),
	),
});

export function createMapData(init: { id: string; seed: string; width: number; height: number }): MapData {
	return { version: 1, generator: "v1", edits: {}, labels: [], ...init };
}

export function createLabelId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function parseMapData(text: string): MapParseResult {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return { ok: false, error: "The map file is not valid JSON." };
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { ok: false, error: `Invalid map file (${issue.path.join(".") || "root"}: ${issue.message}).` };
	}
	return { ok: true, data: { ...parsed.data, labels: parsed.data.labels ?? [] } };
}

export function serializeMapData(data: MapData): string {
	const { version, id, seed, generator, width, height, edits, labels } = data;
	return JSON.stringify({ version, id, seed, generator, width, height, edits, labels }, null, "\t");
}

export function isValidMapSize(width: number, height: number): boolean {
	return [width, height].every((n) => Number.isInteger(n) && n >= MIN_MAP_SIZE && n <= MAX_MAP_SIZE);
}

/**
 * The same map at a new size. Terrain depends only on the seed and the position, so growing
 * reveals more terrain on the right and bottom and shrinking crops from there; painted tiles
 * that stay inside are kept. Labels and notes keep their coordinates (anything now outside the
 * map is simply not shown, and comes back if the map is grown again).
 */
export function resizeMapData(data: MapData, width: number, height: number): MapData {
	if (!isValidMapSize(width, height)) {
		throw new Error(`A map must be between ${MIN_MAP_SIZE} and ${MAX_MAP_SIZE} tiles on each side.`);
	}
	if (width === data.width && height === data.height) return data;

	const old = decodeOverrides(data.edits, data.width, data.height);
	const next = new Uint8Array(width * height).fill(NO_OVERRIDE);
	const keepW = Math.min(data.width, width);
	const keepH = Math.min(data.height, height);
	for (let y = 0; y < keepH; y++) {
		for (let x = 0; x < keepW; x++) next[y * width + x] = old[y * data.width + x];
	}
	return { ...data, width, height, edits: encodeOverrides(next, width, height) };
}
