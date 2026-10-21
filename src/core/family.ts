import { baseName, linkTarget } from "./links";
import type { NodeRecord } from "./types";

export interface FamilyPerson {
	/** Note path, or "?name" for a parent that is named but has no note yet. */
	id: string;
	name: string;
	/** Undefined for a parent without a note. */
	path?: string;
	start?: number;
	end?: number;
}

export interface FamilyGraph {
	people: Map<string, FamilyPerson>;
	parentsOf: Map<string, string[]>;
	childrenOf: Map<string, string[]>;
}

/** Turns link text such as "Alice" into a note path, or null if no such note exists. */
export type LinkResolver = (target: string, fromPath: string) => string | null;

function push(map: Map<string, string[]>, key: string, value: string): void {
	const list = map.get(key);
	if (!list) map.set(key, [value]);
	else if (!list.includes(value)) list.push(value);
}

/**
 * Builds the parent/child graph from every character note (and anything else that declares
 * `parents`). Parents named in a link but without a note become placeholder people.
 */
export function buildFamilyGraph(nodes: Iterable<NodeRecord>, resolve: LinkResolver): FamilyGraph {
	const list = [...nodes];
	const byPath = new Map(list.map((n) => [n.path, n]));
	const people = new Map<string, FamilyPerson>();
	const parentsOf = new Map<string, string[]>();
	const childrenOf = new Map<string, string[]>();

	const fromNode = (n: NodeRecord): FamilyPerson => ({ id: n.path, name: n.name, path: n.path, start: n.start, end: n.end });

	for (const n of list) {
		if (n.type === "character" || n.parents.length > 0) people.set(n.path, fromNode(n));
	}

	for (const child of list) {
		for (const raw of child.parents) {
			const target = linkTarget(raw);
			if (!target) continue;
			const path = resolve(target, child.path);
			let parentId: string;
			if (path) {
				parentId = path;
				if (!people.has(path)) {
					const node = byPath.get(path);
					people.set(path, node ? fromNode(node) : { id: path, name: baseName(path), path });
				}
			} else {
				parentId = `?${target.toLowerCase()}`;
				if (!people.has(parentId)) people.set(parentId, { id: parentId, name: baseName(target) });
			}
			if (parentId === child.path) continue;
			push(parentsOf, child.path, parentId);
			push(childrenOf, parentId, child.path);
		}
	}
	return { people, parentsOf, childrenOf };
}

export type FamilyMode = "family" | "ancestors" | "descendants";

export const FAMILY_MODES: readonly { id: FamilyMode; label: string }[] = [
	{ id: "family", label: "Whole family" },
	{ id: "ancestors", label: "Ancestors" },
	{ id: "descendants", label: "Descendants" },
];

function walk(start: string, next: (id: string) => string[] | undefined): Set<string> {
	const seen = new Set([start]);
	const queue = [start];
	while (queue.length > 0) {
		for (const id of next(queue.shift() as string) ?? []) {
			if (!seen.has(id)) {
				seen.add(id);
				queue.push(id);
			}
		}
	}
	return seen;
}

/** The people to show for `rootId`. */
export function extractFamily(graph: FamilyGraph, rootId: string, mode: FamilyMode): Set<string> {
	if (!graph.people.has(rootId)) return new Set();
	const up = (id: string) => graph.parentsOf.get(id);
	const down = (id: string) => graph.childrenOf.get(id);
	let ids: Set<string>;
	if (mode === "ancestors") {
		ids = walk(rootId, up);
	} else if (mode === "descendants") {
		ids = walk(rootId, down);
		// include the other parent of each child so couples show up together
		for (const id of [...ids]) for (const parent of graph.parentsOf.get(id) ?? []) ids.add(parent);
	} else {
		ids = walk(rootId, (id) => [...(up(id) ?? []), ...(down(id) ?? [])]);
	}
	return ids;
}

/**
 * Generation number per person (0 = oldest shown). A child sits one generation below its
 * parents, and co-parents sit on the same generation. Bad data with a cycle terminates
 * with some layering rather than looping.
 */
export function assignGenerations(graph: FamilyGraph, ids: ReadonlySet<string>): Map<string, number> {
	const gen = new Map<string, number>([...ids].map((id) => [id, 0]));
	const parentsIn = (id: string) => (graph.parentsOf.get(id) ?? []).filter((p) => ids.has(p));
	const cap = ids.size;
	for (let pass = 0; pass <= ids.size * 2; pass++) {
		let changed = false;
		for (const id of ids) {
			const parents = parentsIn(id);
			if (parents.length === 0) continue;
			const top = Math.max(...parents.map((p) => gen.get(p) as number));
			if ((gen.get(id) as number) < top + 1 && top + 1 <= cap) {
				gen.set(id, top + 1);
				changed = true;
			}
			if (parents.length > 1) {
				for (const p of parents) {
					if ((gen.get(p) as number) < top) {
						gen.set(p, top);
						changed = true;
					}
				}
			}
		}
		if (!changed) break;
	}
	const lowest = Math.min(...gen.values());
	for (const [id, g] of gen) gen.set(id, g - lowest);
	return gen;
}
