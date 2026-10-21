export const Terrain = {
	DeepOcean: 0,
	ShallowWater: 1,
	Land: 2,
	Mountain: 3,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const TERRAIN_NAMES: Record<Terrain, string> = {
	[Terrain.DeepOcean]: "Deep ocean",
	[Terrain.ShallowWater]: "Shallow water",
	[Terrain.Land]: "Land",
	[Terrain.Mountain]: "Mountain",
};

/** Everything needed to regenerate a map's base terrain. Stored per map, never per tile. */
export interface MapDefinition {
	id: string;
	seed: string;
	/** Terrain algorithm version. Old versions are frozen so saved worlds never change. */
	generator: "v1";
	width: number;
	height: number;
}

/**
 * A note that takes part in the world: a place, character, event, and so on.
 * Derived from the note's frontmatter, never stored separately.
 */
export interface NodeRecord {
	path: string;
	/** Note name without folder or extension. */
	name: string;
	/** Node type id such as "character" (see nodeTypes.ts). */
	type: string;
	/** Set together when the note is placed on a map. */
	map?: string;
	x?: number;
	y?: number;
	/** Sticker id, emoji, or vault path of an image. */
	icon?: string;
	/** One or two sentences about the node, shown when hovering it on a map. */
	overview?: string;
	/** Links to the affiliation notes this node belongs to, as written, e.g. "[[Order of the Ash]]". */
	affiliations: string[];
	/** First year the node exists. Undefined means it has always existed. */
	start?: number;
	/** Last year the node exists. Undefined means indefinitely. */
	end?: number;
	/** Parent links as written in the note, e.g. "[[Alice]]". */
	parents: string[];
	/** Where a character is from given years on (the `locations` list), sorted by year. */
	locations: LocationEntry[];
	/** Links in an event's text (and `present:` list) that may place characters there. */
	mentions: Mention[];
}

/**
 * From `year` on, a character is at (x, y), or is missing. `map` is optional: without it
 * the entry applies to whichever map is being viewed.
 */
export type LocationEntry = { year: number } & ({ missing: true } | { missing?: false; map?: string; x: number; y: number });

/**
 * How a link in an event is marked:
 * "present" = written `@[[Name]]` (or listed under `present:`), "absent" = `~[[Name]]`,
 * "plain" = an ordinary `[[Name]]`.
 */
export type MentionMark = "present" | "absent" | "plain";

export interface Mention {
	/** Link target without brackets, alias or heading, e.g. "Alaric". */
	target: string;
	mark: MentionMark;
}

/** A node that is placed on a map tile. */
export type Pin = NodeRecord & { map: string; x: number; y: number };

export function isPin(node: NodeRecord): node is Pin {
	return node.map !== undefined && node.x !== undefined && node.y !== undefined;
}
