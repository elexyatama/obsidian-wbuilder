export interface NodeTypeDef {
	id: string;
	label: string;
	/** Pin badge color. */
	color: string;
	/** Built-in sticker used when a note has no `icon`. */
	defaultSticker: string;
}

export const NODE_TYPES: readonly NodeTypeDef[] = [
	{ id: "place", label: "Place", color: "#d4a017", defaultSticker: "town" },
	{ id: "structure", label: "Structure", color: "#a8672d", defaultSticker: "castle" },
	{ id: "character", label: "Character", color: "#c2467a", defaultSticker: "person" },
	{ id: "creature", label: "Creature", color: "#8348b8", defaultSticker: "dragon" },
	{ id: "faction", label: "Faction", color: "#2f86ad", defaultSticker: "flag" },
	{ id: "affiliation", label: "Affiliation", color: "#1f9e89", defaultSticker: "shield" },
	{ id: "event", label: "Event", color: "#d2562a", defaultSticker: "star" },
	{ id: "item", label: "Item", color: "#3f9f6c", defaultSticker: "gem" },
];

export const DEFAULT_NODE_TYPE = "place";

const byId = new Map(NODE_TYPES.map((t) => [t.id, t]));

export function isKnownNodeType(id: string): boolean {
	return byId.has(id);
}

/** Unknown types are allowed (users can invent their own) and get a neutral look. */
export function getNodeType(id: string): NodeTypeDef {
	return byId.get(id) ?? { id, label: id, color: "#7d838c", defaultSticker: "pin" };
}
