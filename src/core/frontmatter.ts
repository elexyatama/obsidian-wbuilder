// zod/mini keeps the plugin bundle small; full zod adds ~400 KB for a handful of fields.
import * as z from "zod/mini";
import { DEFAULT_NODE_TYPE, isKnownNodeType } from "./nodeTypes";
import type { NodeRecord } from "./types";

/** Node fields read from frontmatter. The index adds `path` and `name`. */
export type NodeFields = Omit<NodeRecord, "path" | "name">;

export type NodeParseResult =
	| { kind: "none" }
	| { kind: "node"; fields: NodeFields }
	| { kind: "invalid"; issues: string[] };

const schema = z.object({
	map: z.optional(z.string().check(z.minLength(1))),
	x: z.optional(z.int()),
	y: z.optional(z.int()),
	icon: z.optional(z.string()),
	start: z.optional(z.number()),
	end: z.optional(z.number()),
});

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

function readParents(value: unknown): string[] {
	const raw = Array.isArray(value) ? value.map(firstString) : [firstString(value)];
	return [...new Set(raw.filter((p): p is string => p !== undefined))];
}

/**
 * Reads a note's world data from already-parsed frontmatter:
 *
 *   type: character         place | structure | character | creature | faction | event | item | your own
 *   map: world              with x and y, puts the note on that map
 *   x: 12                   (tile_x also accepted)
 *   y: 34                   (tile_y also accepted)
 *   icon: castle            sticker id, emoji, or path of an image in the vault
 *   start: 120              (born also accepted) omit = has always existed
 *   end: 340                (died also accepted) omit = indefinite
 *   parents: ["[[Alice]]"]  character parents, as links or plain names
 *
 * A note is part of the world when it has `map`, a known `type`, or `parents`. Anything
 * else is ignored, so an unrelated `type: book` or `x: 3` in someone's vault never makes
 * a node. Bad coordinates or periods make the note invalid (its pin disappears and the
 * problem is recorded); malformed parent entries are skipped.
 */
export function parseNode(frontmatter: unknown): NodeParseResult {
	if (!isRecord(frontmatter)) return { kind: "none" };

	const parents = readParents(frontmatter.parents);
	const type = typeof frontmatter.type === "string" ? frontmatter.type.trim().toLowerCase() : "";
	const hasMap = frontmatter.map !== undefined && frontmatter.map !== null;
	if (!hasMap && parents.length === 0 && !isKnownNodeType(type)) return { kind: "none" };

	const parsed = schema.safeParse({
		map: hasMap ? frontmatter.map : undefined,
		x: frontmatter.x ?? frontmatter.tile_x ?? undefined,
		y: frontmatter.y ?? frontmatter.tile_y ?? undefined,
		icon: frontmatter.icon ?? undefined,
		start: frontmatter.start ?? frontmatter.born ?? undefined,
		end: frontmatter.end ?? frontmatter.died ?? undefined,
	});
	if (!parsed.success) {
		return {
			kind: "invalid",
			issues: parsed.error.issues.map((i) => `${i.path.join(".") || "frontmatter"}: ${i.message}`),
		};
	}

	const { map, x, y, icon, start, end } = parsed.data;
	const issues: string[] = [];
	if (map !== undefined && (x === undefined || y === undefined)) issues.push("x and y: required when map is set");
	if (start !== undefined && end !== undefined && start > end) issues.push("start: must not be after end");
	if (issues.length > 0) return { kind: "invalid", issues };

	const resolvedType = type || (parents.length > 0 ? "character" : DEFAULT_NODE_TYPE);
	// x/y without a map are ignored: they are not a location
	const placed = map !== undefined ? { map, x, y } : {};
	return { kind: "node", fields: { type: resolvedType, ...placed, icon, start, end, parents } };
}
