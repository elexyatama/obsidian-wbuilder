import { assignGenerations, type FamilyGraph } from "./family";

export const NODE_W = 150;
export const NODE_H = 46;
export const UNION_SIZE = 10;
const H_GAP = 24;
const V_GAP = 64;
const MARGIN = 24;

export interface LayoutNode {
	id: string;
	kind: "person" | "union";
	/** Center. */
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface LayoutEdge {
	from: string;
	to: string;
}

export interface TreeLayout {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
	width: number;
	height: number;
}

interface Item extends LayoutNode {
	layer: number;
	neighbors: Item[];
}

/**
 * Lays the chosen people out in generations, oldest at the top. Two or more parents of the
 * same child(ren) are joined by a small "union" dot that the children hang from, which
 * keeps couples and their children readable. Rows are ordered with a few barycenter
 * sweeps to cut crossings, then packed so nothing overlaps.
 */
export function layoutFamily(graph: FamilyGraph, ids: ReadonlySet<string>): TreeLayout {
	const people = [...ids].filter((id) => graph.people.has(id));
	if (people.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

	const gen = assignGenerations(graph, new Set(people));
	const items = new Map<string, Item>();
	const edges: LayoutEdge[] = [];

	people.sort((a, b) => (graph.people.get(a)?.name ?? "").localeCompare(graph.people.get(b)?.name ?? ""));
	for (const id of people) {
		items.set(id, { id, kind: "person", x: 0, y: 0, w: NODE_W, h: NODE_H, layer: (gen.get(id) as number) * 2, neighbors: [] });
	}

	const connect = (from: string, to: string) => {
		const a = items.get(from) as Item;
		const b = items.get(to) as Item;
		edges.push({ from, to });
		a.neighbors.push(b);
		b.neighbors.push(a);
	};

	for (const child of people) {
		const parents = (graph.parentsOf.get(child) ?? []).filter((p) => items.has(p)).sort();
		if (parents.length === 0) continue;
		if (parents.length === 1) {
			connect(parents[0], child);
			continue;
		}
		const unionId = `u:${parents.join("+")}`;
		if (!items.has(unionId)) {
			const layer = Math.max(...parents.map((p) => (items.get(p) as Item).layer)) + 1;
			items.set(unionId, { id: unionId, kind: "union", x: 0, y: 0, w: UNION_SIZE, h: UNION_SIZE, layer, neighbors: [] });
			for (const p of parents) connect(p, unionId);
		}
		connect(unionId, child);
	}

	const rows = new Map<number, Item[]>();
	for (const item of items.values()) {
		const row = rows.get(item.layer);
		if (row) row.push(item);
		else rows.set(item.layer, [item]);
	}
	const layers = [...rows.keys()].sort((a, b) => a - b);

	const gap = (a: Item, b: Item) => (a.w + b.w) / 2 + H_GAP;

	/** Order a row by target x, then place left to right without overlap, keeping its average position. */
	const pack = (row: Item[], target: Map<Item, number>) => {
		row.sort((a, b) => (target.get(a) as number) - (target.get(b) as number));
		let prev: Item | undefined;
		for (const item of row) {
			item.x = Math.max(target.get(item) as number, prev ? prev.x + gap(prev, item) : -Infinity);
			prev = item;
		}
		let shift = 0;
		for (const item of row) shift += (target.get(item) as number) - item.x;
		shift /= row.length;
		for (const item of row) item.x += shift;
	};

	for (const layer of layers) {
		const row = rows.get(layer) as Item[];
		pack(row, new Map(row.map((item, i) => [item, i * (NODE_W + H_GAP)])));
	}

	const sweep = (layer: number, towardsParents: boolean) => {
		const row = rows.get(layer) as Item[];
		const target = new Map<Item, number>();
		for (const item of row) {
			const near = item.neighbors.filter((n) => (towardsParents ? n.layer < layer : n.layer > layer));
			target.set(item, near.length > 0 ? near.reduce((s, n) => s + n.x, 0) / near.length : item.x);
		}
		pack(row, target);
	};
	for (let pass = 0; pass < 4; pass++) {
		for (const layer of layers.slice(1)) sweep(layer, true);
		for (const layer of [...layers].reverse().slice(1)) sweep(layer, false);
	}

	const rowHeight = (NODE_H + V_GAP) / 2;
	const all = [...items.values()];
	const minX = Math.min(...all.map((n) => n.x - n.w / 2));
	const maxX = Math.max(...all.map((n) => n.x + n.w / 2));
	const maxLayer = layers[layers.length - 1];
	const nodes = all.map(({ id, kind, x, y: _y, w, h, layer }) => ({
		id,
		kind,
		x: x - minX + MARGIN,
		y: layer * rowHeight + NODE_H / 2 + MARGIN,
		w,
		h,
	}));
	return { nodes, edges, width: maxX - minX + 2 * MARGIN, height: maxLayer * rowHeight + NODE_H + 2 * MARGIN };
}
