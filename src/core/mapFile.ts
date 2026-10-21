import * as z from "zod/mini";
import type { MapDefinition } from "./types";

export const MAP_EXTENSION = "worldmap";
export const MIN_MAP_SIZE = 16;
export const MAX_MAP_SIZE = 1024;

/** Contents of a `.worldmap` file: how to regenerate the terrain, plus the painted edits. */
export interface MapData extends MapDefinition {
	version: 1;
	/** Painted tiles per chunk ("cx,cy" -> base64), see TileGrid.exportEdits. */
	edits: Record<string, string>;
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
});

export function createMapData(init: { id: string; seed: string; width: number; height: number }): MapData {
	return { version: 1, generator: "v1", edits: {}, ...init };
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
	return { ok: true, data: parsed.data };
}

export function serializeMapData(data: MapData): string {
	const { version, id, seed, generator, width, height, edits } = data;
	return JSON.stringify({ version, id, seed, generator, width, height, edits }, null, "\t");
}
