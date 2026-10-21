import { getNodeType } from "./nodeTypes";

export interface Sticker {
	id: string;
	label: string;
	/** Emoji drawn as the sticker. A few stickers also have hand-drawn art in render/. */
	glyph: string;
}

export const BUILTIN_STICKERS: readonly Sticker[] = [
	{ id: "pin", label: "Pin", glyph: "📍" },
	{ id: "town", label: "Town", glyph: "🏘️" },
	{ id: "castle", label: "Castle", glyph: "🏰" },
	{ id: "house", label: "House", glyph: "🏠" },
	{ id: "church", label: "Temple", glyph: "⛪" },
	{ id: "tent", label: "Camp", glyph: "⛺" },
	{ id: "well", label: "Well", glyph: "⛲" },
	{ id: "bridge", label: "Bridge", glyph: "🌉" },
	{ id: "ship", label: "Ship", glyph: "⛵" },
	{ id: "anchor", label: "Harbor", glyph: "⚓" },
	{ id: "tree", label: "Forest", glyph: "🌲" },
	{ id: "mountain", label: "Peak", glyph: "⛰️" },
	{ id: "volcano", label: "Volcano", glyph: "🌋" },
	{ id: "cave", label: "Cave", glyph: "🕳️" },
	{ id: "ruins", label: "Ruins", glyph: "🏚️" },
	{ id: "tomb", label: "Tomb", glyph: "⚰️" },
	{ id: "skull", label: "Danger", glyph: "💀" },
	{ id: "dragon", label: "Dragon", glyph: "🐉" },
	{ id: "wolf", label: "Wolf", glyph: "🐺" },
	{ id: "person", label: "Person", glyph: "🧑" },
	{ id: "wizard", label: "Wizard", glyph: "🧙" },
	{ id: "shield", label: "Shield", glyph: "🛡️" },
	{ id: "sword", label: "Battle", glyph: "⚔️" },
	{ id: "crown", label: "Crown", glyph: "👑" },
	{ id: "flag", label: "Banner", glyph: "🚩" },
	{ id: "gem", label: "Treasure", glyph: "💎" },
	{ id: "coins", label: "Market", glyph: "💰" },
	{ id: "book", label: "Library", glyph: "📖" },
	{ id: "scroll", label: "Scroll", glyph: "📜" },
	{ id: "fire", label: "Fire", glyph: "🔥" },
	{ id: "star", label: "Event", glyph: "⭐" },
];

const byId = new Map(BUILTIN_STICKERS.map((s) => [s.id, s]));

export function findSticker(id: string | undefined): Sticker | undefined {
	return id === undefined ? undefined : byId.get(id);
}

export function defaultStickerFor(type: string): Sticker {
	return findSticker(getNodeType(type).defaultSticker) ?? BUILTIN_STICKERS[0];
}

/** True for a short string containing a pictograph, so `icon: "🗡️"` works without a catalog entry. */
export function looksLikeEmoji(text: string): boolean {
	return text.length <= 8 && /\p{Extended_Pictographic}/u.test(text);
}
