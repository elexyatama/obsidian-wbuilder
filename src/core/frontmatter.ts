// zod/mini keeps the plugin bundle small; full zod adds ~400 KB for a handful of fields.
import * as z from "zod/mini";
import { linkTarget } from "./links";
import { DEFAULT_NODE_TYPE, isKnownNodeType } from "./nodeTypes";
import { parseLocations } from "./tracker";
import type { NodeRecord } from "./types";

/**
 * Node fields read from frontmatter. The index adds `path`, `name` and `mentions`
 * (it combines `present` with the links it finds in an event's text).
 */
export type NodeFields = Omit<NodeRecord, "path" | "name" | "mentions"> & {
	/** Link targets listed under `present:`. */
	present: string[];
};

export type NodeParseResult =
	| { kind: "none" }
	/** `warnings` are problems that don't stop the note being a node, such as an unreadable `locations` line. */
	| { kind: "node"; fields: NodeFields; warnings: string[] }
	| { kind: "invalid"; issues: string[] };

const schema = z.object({
	map: z.optional(z.string().check(z.minLength(1))),
	x: z.optional(z.int()),
	y: z.optional(z.int()),
	icon: z.optional(z.string()),
	start: z.optional(z.number()),
	end: z.optional(z.number()),
});

/** What to tell the user when a property has the wrong kind of value. */
const FIELD_HINTS: Record<string, string> = {
	map: "must be text, such as world",
	x: "must be a whole number",
	y: "must be a whole number",
	icon: "must be text",
	start: "(or born) must be a number, such as 300",
	end: "(or died) must be a number, such as 360",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First string inside a value; `[[Alice]]` written unquoted in YAML arrives as `[["Alice"]]`. */
function firstString(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = firstString(item);
			if (found) return found;
		}
	}
	return undefined;
}

/**
 * One list entry may hold several names, because a plain text property is one string:
 * "[[Alaric]], [[Beatrix]]" gives both links, and "Alaric, Beatrix" is split on commas.
 */
function splitNames(text: string): string[] {
	const links = text.match(/\[\[[^\]]+\]\]/g);
	if (links) return links;
	return text.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
}

/** A list of links or names, from a list, a single value, or a comma-separated text property. */
function readLinks(value: unknown): string[] {
	const raw = Array.isArray(value) ? value.map(firstString) : [firstString(value)];
	const names = raw.flatMap((item) => (item === undefined ? [] : splitNames(item)));
	return [...new Set(names)];
}

/** The overview as one trimmed line of text; empty or non-text values mean "no overview". */
function readOverview(value: unknown): string | undefined {
	const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
	return text.replace(/\s+/g, " ").trim() || undefined;
}

/** "300" typed into a text property is still the number 300. Anything else is passed on to be rejected. */
function asNumber(value: unknown): unknown {
	return typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? Number(value) : value;
}

/**
 * Reads a note's world data from already-parsed frontmatter:
 *
 *   type: character         place | structure | character | creature | faction | event | item | your own
 *   map: world              with x and y, puts the note on that map
 *   x: 12                   (tile_x also accepted)
 *   y: 34                   (tile_y also accepted)
 *   icon: castle            sticker id, emoji, or path of an image in the vault
 *   overview: A ruined fort. one or two sentences, shown when hovering the node on a map
 *   affiliation: ["[[Order of the Ash]]"]   the affiliation notes it belongs to (affiliations also accepted)
 *   start: 120              (born also accepted) omit = has always existed
 *   end: 340                (died also accepted) omit = indefinite
 *   parents: ["[[Alice]]"]  character parents, as links or plain names
 *   locations: ["320: 12,34", "340: missing"]   where a character is, from which year (see tracker.ts)
 *   present: ["[[Alice]]"]  characters at an event (see tracker.ts)
 *
 * A note is part of the world when it has `map`, a known `type`, `parents` or `locations`.
 * Anything else is ignored, so an unrelated `type: book` or `x: 3` in someone's vault never
 * makes a node. Bad coordinates or periods make the note invalid (its pin disappears and
 * the problem is recorded); malformed parent or location entries are skipped with a warning.
 */
export function parseNode(frontmatter: unknown): NodeParseResult {
	if (!isRecord(frontmatter)) return { kind: "none" };

	const parents = readLinks(frontmatter.parents);
	const affiliations = [...new Set([...readLinks(frontmatter.affiliation), ...readLinks(frontmatter.affiliations)])];
	const overview = readOverview(frontmatter.overview);
	const { entries: locations, warnings } = parseLocations(frontmatter.locations);
	const present = readLinks(frontmatter.present).map(linkTarget).filter(Boolean);
	const type = typeof frontmatter.type === "string" ? frontmatter.type.trim().toLowerCase() : "";
	const hasMap = frontmatter.map !== undefined && frontmatter.map !== null;
	if (!hasMap && parents.length === 0 && locations.length === 0 && !isKnownNodeType(type)) return { kind: "none" };

	const parsed = schema.safeParse({
		map: hasMap ? frontmatter.map : undefined,
		x: asNumber(frontmatter.x ?? frontmatter.tile_x ?? undefined),
		y: asNumber(frontmatter.y ?? frontmatter.tile_y ?? undefined),
		icon: frontmatter.icon ?? undefined,
		start: asNumber(frontmatter.start ?? frontmatter.born ?? undefined),
		end: asNumber(frontmatter.end ?? frontmatter.died ?? undefined),
	});
	if (!parsed.success) {
		return {
			kind: "invalid",
			issues: parsed.error.issues.map((i) => {
				const key = String(i.path[0] ?? "");
				return `${key || "properties"} ${FIELD_HINTS[key] ?? i.message}`;
			}),
		};
	}

	const { map, x, y, icon, start, end } = parsed.data;
	const issues: string[] = [];
	if (map !== undefined && (x === undefined || y === undefined)) issues.push("x and y: required when map is set");
	if (start !== undefined && end !== undefined && start > end) issues.push("start: must not be after end");
	if (issues.length > 0) return { kind: "invalid", issues };

	const resolvedType = type || (parents.length > 0 || locations.length > 0 ? "character" : DEFAULT_NODE_TYPE);
	// x/y without a map are ignored: they are not a location
	const placed = map !== undefined ? { map, x, y } : {};
	return {
		kind: "node",
		fields: { type: resolvedType, ...placed, icon, overview, start, end, parents, affiliations, locations, present },
		warnings,
	};
}
