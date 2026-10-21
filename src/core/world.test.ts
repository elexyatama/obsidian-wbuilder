import { describe, expect, it, vi } from "vitest";
import { describeNote } from "./describe";
import { assignGenerations, buildFamilyGraph, extractFamily, type FamilyGraph } from "./family";
import { baseName, linkTarget } from "./links";
import { buildFrontmatter, buildNoteText, sanitizeNoteName, yamlScalar } from "./nodeTemplate";
import { defaultStickerFor, findSticker, looksLikeEmoji } from "./stickers";
import { Timeline, isActiveAt, periodRange } from "./timeline";
import { NODE_H, NODE_W, layoutFamily } from "./treeLayout";
import type { NodeRecord } from "./types";

const person = (name: string, parents: string[] = [], extra: Partial<NodeRecord> = {}): NodeRecord => ({
	path: `${name}.md`,
	name,
	type: "character",
	parents,
	locations: [],
	mentions: [],
	...extra,
});

/** Resolves "[[Name]]"-style targets by note name. */
const resolver = (nodes: NodeRecord[]) => (target: string) => nodes.find((n) => n.name === target)?.path ?? null;

function graphOf(nodes: NodeRecord[]): FamilyGraph {
	return buildFamilyGraph(nodes, resolver(nodes));
}

describe("links", () => {
	it("extracts link targets", () => {
		expect(linkTarget("[[Alice]]")).toBe("Alice");
		expect(linkTarget("[[World/Alice#Early life|Al]]")).toBe("World/Alice");
		expect(linkTarget("  Alice.md ")).toBe("Alice");
		expect(baseName("World/Characters/Alice.md")).toBe("Alice");
	});
});

describe("timeline", () => {
	it("treats missing bounds as unbounded", () => {
		expect(isActiveAt({}, -9999)).toBe(true);
		expect(isActiveAt({ start: 10 }, 9)).toBe(false);
		expect(isActiveAt({ start: 10 }, 10)).toBe(true);
		expect(isActiveAt({ end: 20 }, 20)).toBe(true);
		expect(isActiveAt({ end: 20 }, 21)).toBe(false);
		expect(isActiveAt({ start: 10, end: 20 }, 15)).toBe(true);
	});

	it("computes a padded slider range, or none when nothing has a period", () => {
		expect(periodRange([{}, {}])).toBeNull();
		const range = periodRange([{ start: 100 }, { start: 150, end: 300 }, {}]);
		expect(range && range.min).toBeLessThan(100);
		expect(range && range.max).toBeGreaterThan(300);
		const single = periodRange([{ start: 50 }]);
		expect(single && single.max - single.min).toBeGreaterThan(10);
	});

	it("shows everything while disabled and filters once enabled", () => {
		const timeline = new Timeline();
		const changed = vi.fn();
		timeline.on("changed", changed);
		expect(timeline.shows({ start: 500 })).toBe(true);
		timeline.set({ enabled: true, year: 100 });
		expect(timeline.shows({ start: 500 })).toBe(false);
		expect(timeline.shows({})).toBe(true);
		timeline.set({ year: 100 });
		expect(changed).toHaveBeenCalledTimes(1);
	});
});

describe("stickers", () => {
	it("finds built-ins and falls back per node type", () => {
		expect(findSticker("well")?.label).toBe("Well");
		expect(findSticker("nope")).toBeUndefined();
		expect(defaultStickerFor("character").id).toBe("person");
		expect(defaultStickerFor("something-custom").id).toBe("pin");
		expect(looksLikeEmoji("🗡️")).toBe(true);
		expect(looksLikeEmoji("castle")).toBe(false);
	});
});

describe("node template", () => {
	it("writes frontmatter, omitting indefinite periods", () => {
		const text = buildNoteText({ name: "Dragon Keep", type: "structure", map: "world", x: 80, y: 32, icon: "castle", start: 120 });
		expect(text).toBe(
			["---", "type: structure", "map: world", "x: 80", "y: 32", "icon: castle", "start: 120", "---", "", "# Dragon Keep", "", ""].join("\n"),
		);
	});

	it("gives characters a parents list and quotes risky strings", () => {
		expect(buildNoteText({ name: "Alaric", type: "character" })).toContain("parents: []");
		const kid = buildNoteText({ name: "Kid", type: "character", parents: ["[[Alaric]]", "[[Beatrix]]"] });
		expect(kid).toContain('parents:\n  - "[[Alaric]]"\n  - "[[Beatrix]]"');
		expect(yamlScalar("world")).toBe("world");
		expect(yamlScalar("Stickers/tree.png")).toBe("Stickers/tree.png");
		expect(yamlScalar("yes")).toBe('"yes"');
		expect(yamlScalar("12")).toBe('"12"');
		expect(yamlScalar("a: b")).toBe('"a: b"');
		expect(buildFrontmatter({ name: "X", type: "place" })).toEqual({ type: "place" });
	});

	it("sanitizes note names", () => {
		expect(sanitizeNoteName('  The "Old": Keep? #1 ')).toBe("The Old Keep 1");
		expect(sanitizeNoteName("a/b\\c")).toBe("abc");
		expect(sanitizeNoteName("...")).toBe("");
	});
});

describe("describeNote", () => {
	it("explains a note that isn't part of the world, or has unreadable properties", () => {
		expect(describeNote("Plain", undefined, [], [], () => null).join("\n")).toContain("Not part of the world yet");
		const bad = describeNote("Bad", undefined, ["start: Invalid input"], [], () => null);
		expect(bad.join("\n")).toContain("Can't read this note's properties");
		expect(bad.join("\n")).toContain("start: Invalid input");
	});

	it("shows what a character note resolved to", () => {
		const node = person("Cedric", ["[[Alaric]]", "[[Fenn]]"], { start: 330, locations: [{ year: 330, x: 1, y: 1 }] });
		const text = describeNote("Cedric", node, [], ["a warning"], (target) => (target === "Alaric" ? "World/Alaric.md" : null)).join("\n");
		expect(text).toContain("type: character");
		expect(text).toContain("years 330 to …");
		expect(text).toContain("Alaric → World/Alaric.md");
		expect(text).toContain("Fenn → no note with that name");
		expect(text).toContain("locations: 1 entry");
		expect(text).toContain("⚠ a warning");
	});
});

describe("family graph", () => {
	const alaric = person("Alaric", [], { start: 300, end: 360 });
	const beatrix = person("Beatrix");
	const cedric = person("Cedric", ["[[Alaric]]", "[[Beatrix]]"]);
	const dara = person("Dara", ["[[Alaric]]", "[[Beatrix]]"]);
	const edda = person("Edda", ["[[Cedric]]", "[[Fenn]]"]);
	const nodes = [alaric, beatrix, cedric, dara, edda];

	it("links children to parents and keeps unresolved parents as placeholders", () => {
		const graph = graphOf(nodes);
		expect(graph.parentsOf.get("Cedric.md")).toEqual(["Alaric.md", "Beatrix.md"]);
		expect(graph.childrenOf.get("Alaric.md")).toEqual(["Cedric.md", "Dara.md"]);
		const fenn = graph.people.get("?fenn");
		expect(fenn?.name).toBe("Fenn");
		expect(fenn?.path).toBeUndefined();
		expect(graph.parentsOf.get("Edda.md")).toEqual(["Cedric.md", "?fenn"]);
	});

	it("ignores a note listing itself as a parent", () => {
		const loner = person("Loner", ["[[Loner]]"]);
		expect(graphOf([loner]).parentsOf.get("Loner.md")).toBeUndefined();
	});

	it("extracts ancestors, descendants (with their co-parents) and the whole family", () => {
		const graph = graphOf(nodes);
		expect([...extractFamily(graph, "Edda.md", "ancestors")].sort()).toEqual(
			["?fenn", "Alaric.md", "Beatrix.md", "Cedric.md", "Edda.md"].sort(),
		);
		expect([...extractFamily(graph, "Alaric.md", "descendants")].sort()).toEqual(
			["?fenn", "Alaric.md", "Beatrix.md", "Cedric.md", "Dara.md", "Edda.md"].sort(),
		);
		expect(extractFamily(graph, "Dara.md", "family").size).toBe(6);
		expect(extractFamily(graph, "Nobody.md", "family").size).toBe(0);
		const stranger = person("Stranger");
		const solo = graphOf([...nodes, stranger]);
		expect([...extractFamily(solo, "Stranger.md", "family")]).toEqual(["Stranger.md"]);
	});

	it("puts children one generation below parents and aligns co-parents", () => {
		const graph = graphOf(nodes);
		const gen = assignGenerations(graph, extractFamily(graph, "Alaric.md", "family"));
		expect(gen.get("Alaric.md")).toBe(0);
		expect(gen.get("Beatrix.md")).toBe(0);
		expect(gen.get("Cedric.md")).toBe(1);
		expect(gen.get("Edda.md")).toBe(2);
		expect(gen.get("?fenn")).toBe(1);
	});

	it("terminates on a parent cycle", () => {
		const a = person("A", ["[[B]]"]);
		const b = person("B", ["[[A]]"]);
		const graph = graphOf([a, b]);
		const gen = assignGenerations(graph, new Set(["A.md", "B.md"]));
		expect(gen.size).toBe(2);
		expect(layoutFamily(graph, new Set(["A.md", "B.md"])).nodes.length).toBeGreaterThanOrEqual(2);
	});
});

describe("family layout", () => {
	const nodes = [
		person("Alaric"),
		person("Beatrix"),
		person("Cedric", ["[[Alaric]]", "[[Beatrix]]"]),
		person("Dara", ["[[Alaric]]", "[[Beatrix]]"]),
		person("Edda", ["[[Cedric]]"]),
		person("Gil", ["[[Dara]]"]),
	];
	const graph = graphOf(nodes);
	const layout = layoutFamily(graph, extractFamily(graph, "Alaric.md", "family"));
	const at = (id: string) => layout.nodes.find((n) => n.id === id)!;

	it("lays out every person plus a union dot for the couple", () => {
		expect(layout.nodes.filter((n) => n.kind === "person")).toHaveLength(6);
		expect(layout.nodes.filter((n) => n.kind === "union")).toHaveLength(1);
		expect(layout.edges.length).toBe(2 + 2 + 1 + 1);
	});

	it("keeps generations top to bottom", () => {
		expect(at("Alaric.md").y).toBeLessThan(at("Cedric.md").y);
		expect(at("Cedric.md").y).toBeLessThan(at("Edda.md").y);
		expect(at("Alaric.md").y).toBe(at("Beatrix.md").y);
		expect(at("u:Alaric.md+Beatrix.md").y).toBeGreaterThan(at("Alaric.md").y);
		expect(at("u:Alaric.md+Beatrix.md").y).toBeLessThan(at("Cedric.md").y);
	});

	it("never overlaps nodes within a row and stays inside the canvas", () => {
		const rows = new Map<number, typeof layout.nodes>();
		for (const n of layout.nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n]);
		for (const row of rows.values()) {
			const sorted = [...row].sort((a, b) => a.x - b.x);
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i].x - sorted[i - 1].x).toBeGreaterThanOrEqual((sorted[i].w + sorted[i - 1].w) / 2);
			}
		}
		for (const n of layout.nodes) {
			expect(n.x - n.w / 2).toBeGreaterThanOrEqual(0);
			expect(n.x + n.w / 2).toBeLessThanOrEqual(layout.width);
			expect(n.y + n.h / 2).toBeLessThanOrEqual(layout.height);
		}
		expect(NODE_W).toBeGreaterThan(0);
		expect(NODE_H).toBeGreaterThan(0);
	});

	it("handles a single person and an empty selection", () => {
		const solo = layoutFamily(graph, new Set(["Gil.md"]));
		expect(solo.nodes).toHaveLength(1);
		expect(layoutFamily(graph, new Set())).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
	});
});
