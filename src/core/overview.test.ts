import { describe, expect, it } from "vitest";
import { describeNote } from "./describe";
import { decodeOverrides, encodeOverrides, NO_OVERRIDE, TileGrid } from "./grid";
import { parseNode } from "./frontmatter";
import { MapEditor } from "./mapEditor";
import {
	LABEL_SIZES,
	createMapData,
	isValidMapSize,
	parseMapData,
	resizeMapData,
	serializeMapData,
	type MapData,
} from "./mapFile";
import { NodeIndex } from "./nodeIndex";
import { buildFrontmatter, buildNoteText } from "./nodeTemplate";
import { getNodeType, isKnownNodeType } from "./nodeTypes";
import { describePeriod } from "./timeline";
import { Terrain } from "./types";

const fieldsOf = (fm: object) => {
	const r = parseNode(fm);
	if (r.kind !== "node") throw new Error("expected a node, got " + r.kind);
	return r.fields;
};

describe("overview", () => {
	it("is read as one trimmed line, and empty means none", () => {
		expect(fieldsOf({ type: "place", overview: "  A ruined fort\n on the plains.  " }).overview).toBe("A ruined fort on the plains.");
		expect(fieldsOf({ type: "place", overview: "" }).overview).toBeUndefined();
		expect(fieldsOf({ type: "place", overview: ["list"] }).overview).toBeUndefined();
		expect(fieldsOf({ type: "place", overview: 42 }).overview).toBe("42");
		expect(fieldsOf({ type: "place" }).overview).toBeUndefined();
	});

	it("does not by itself make a note part of the world", () => {
		expect(parseNode({ overview: "just text" })).toEqual({ kind: "none" });
	});

	it("reaches the index and re-emits when it changes", () => {
		const index = new NodeIndex();
		let events = 0;
		index.upsert("A.md", { type: "place", map: "w", x: 1, y: 1, overview: "first" });
		index.on("changed", () => events++);
		index.upsert("A.md", { type: "place", map: "w", x: 1, y: 1, overview: "first" });
		expect(events).toBe(0);
		index.upsert("A.md", { type: "place", map: "w", x: 1, y: 1, overview: "second" });
		expect(events).toBe(1);
		expect(index.get("A.md")?.overview).toBe("second");
	});

	it("is written into new notes only when given", () => {
		expect(buildFrontmatter({ name: "X", type: "place" })).toEqual({ type: "place" });
		expect(buildFrontmatter({ name: "X", type: "place", overview: "  " })).toEqual({ type: "place" });
		const text = buildNoteText({ name: "Keep", type: "structure", map: "w", x: 1, y: 2, overview: "A fort, on the plains: very old." });
		expect(text).toContain('overview: "A fort, on the plains: very old."');
		// and reads back the same
		expect(fieldsOf({ type: "structure", overview: "A fort, on the plains: very old." }).overview).toBe("A fort, on the plains: very old.");
	});

	it("writes a character's years as born/died, which read back as the same period", () => {
		const text = buildNoteText({ name: "Alaric", type: "character", start: 300, end: 360 });
		expect(text).toContain("born: 300\ndied: 360");
		expect(text).not.toContain("start:");
		const read = fieldsOf({ type: "character", born: 300, died: 360 });
		expect([read.start, read.end]).toEqual([300, 360]);
		// everything else keeps start/end
		expect(buildNoteText({ name: "Keep", type: "structure", start: 100, end: 340 })).toContain("start: 100\nend: 340");
	});

	it("describes periods for the hover card", () => {
		expect(describePeriod({ start: 300, end: 360 })).toBe("300–360");
		expect(describePeriod({ start: 330, end: 330 })).toBe("330");
		expect(describePeriod({ start: 300 })).toBe("from 300");
		expect(describePeriod({ end: 360 })).toBe("until 360");
		expect(describePeriod({})).toBe("");
	});
});

describe("affiliation", () => {
	it("is a known node type with its own look", () => {
		expect(isKnownNodeType("affiliation")).toBe(true);
		expect(getNodeType("affiliation").label).toBe("Affiliation");
		expect(getNodeType("affiliation").color).not.toBe(getNodeType("faction").color);
		const order = fieldsOf({ type: "Affiliation" });
		expect(order.type).toBe("affiliation");
	});

	it("is a property of any node, as links or names, under either key", () => {
		expect(fieldsOf({ type: "character", affiliation: "[[Order of the Ash]]" }).affiliations).toEqual(["[[Order of the Ash]]"]);
		expect(fieldsOf({ type: "character", affiliation: ["[[A]]", "[[B]]"] }).affiliations).toEqual(["[[A]]", "[[B]]"]);
		expect(fieldsOf({ type: "character", affiliations: "A, B" }).affiliations).toEqual(["A", "B"]);
		expect(fieldsOf({ type: "character", affiliation: "[[A]]", affiliations: ["[[A]]", "[[C]]"] }).affiliations).toEqual(["[[A]]", "[[C]]"]);
		expect(fieldsOf({ type: "character" }).affiliations).toEqual([]);
	});

	it("is written into new notes as a list of links", () => {
		const text = buildNoteText({ name: "Alaric", type: "character", affiliations: ["[[Order of the Ash]]"] });
		expect(text).toContain('affiliation:\n  - "[[Order of the Ash]]"');
		expect(fieldsOf({ type: "character", affiliation: ["[[Order of the Ash]]"] }).affiliations).toEqual(["[[Order of the Ash]]"]);
	});

	it("is shown by the note check, flagging a link to the wrong kind of note", () => {
		const index = new NodeIndex();
		index.upsert("Order.md", { type: "affiliation" });
		index.upsert("Keep.md", { type: "structure", map: "w", x: 1, y: 1 });
		index.upsert("A.md", { type: "character", affiliation: ["[[Order]]", "[[Keep]]", "[[Nobody]]"], overview: "Lord of the keep." });
		const resolve = (target: string) => index.all().find((n) => n.name === target)?.path ?? null;
		const text = describeNote("A", index.get("A.md"), [], [], resolve, (p) => index.get(p)?.type).join("\n");
		expect(text).toContain("overview: Lord of the keep.");
		expect(text).toContain("Order → Order.md");
		expect(text).not.toContain("Order → Order.md (that note");
		expect(text).toContain("Keep → Keep.md (that note is a structure, not an affiliation)");
		expect(text).toContain("Nobody → no note with that name");
		expect(describeNote("B", index.get("Order.md"), [], [], resolve)).toContain("overview: none (add an overview property to show text when hovering it on the map)");
	});
});

describe("map labels in the file", () => {
	it("defaults to none for older files and round-trips", () => {
		const old = { version: 1, id: "w", seed: "s", generator: "v1", width: 64, height: 64, edits: {} };
		const parsed = parseMapData(JSON.stringify(old));
		expect(parsed.ok && parsed.data.labels).toEqual([]);

		const data: MapData = { ...createMapData({ id: "w", seed: "s", width: 64, height: 64 }), labels: [{ id: "a1", text: "The Ash Sea", x: 10.5, y: 20.25, size: "xl" }] };
		const again = parseMapData(serializeMapData(data));
		expect(again.ok && again.data).toEqual(data);
	});

	it("rejects a label with an unknown size or a bad position", () => {
		const base = createMapData({ id: "w", seed: "s", width: 64, height: 64 });
		for (const label of [{ id: "a", text: "x", x: 1, y: 1, size: "huge" }, { id: "a", text: "x", x: "1", y: 1, size: "m" }]) {
			expect(parseMapData(JSON.stringify({ ...base, labels: [label] })).ok).toBe(false);
		}
		expect(LABEL_SIZES).toEqual(["s", "m", "l", "xl"]);
	});
});

describe("resizing a map", () => {
	const paint = (grid: TileGrid, tiles: Array<[number, number]>) => {
		const editor = new MapEditor(grid);
		editor.brush = { mode: "mountain", radius: 1, strength: 1 };
		for (const [x, y] of tiles) {
			editor.beginStroke(x, y);
			editor.endStroke();
		}
	};

	const base = (): MapData => createMapData({ id: "w", seed: "wbuilder", width: 100, height: 70 });

	it("encodes and decodes painted tiles at the right and bottom edge, where chunks are smaller", () => {
		const grid = TileGrid.generate(base());
		paint(grid, [[0, 0], [99, 69], [70, 66], [64, 0]]);
		const edits = grid.exportEdits();
		const decoded = decodeOverrides(edits, 100, 70);
		expect([...decoded].filter((v) => v !== NO_OVERRIDE)).toHaveLength(4);
		expect(encodeOverrides(decoded, 100, 70)).toEqual(edits);
		// the wrong size cannot read the edge chunks (their byte length no longer matches)
		expect([...decodeOverrides(edits, 120, 70)].filter((v) => v !== NO_OVERRIDE).length).toBeLessThan(4);
	});

	it("grows: keeps painted tiles and adds generated terrain on the right and bottom", () => {
		const data = base();
		const grid = TileGrid.generate(data);
		paint(grid, [[99, 69], [5, 5]]);
		const grown = resizeMapData({ ...data, edits: grid.exportEdits() }, 160, 130);
		expect([grown.width, grown.height]).toEqual([160, 130]);

		const after = TileGrid.generate(grown, grown.edits);
		expect(after.terrainAt(99, 69)).toBe(Terrain.Mountain);
		expect(after.terrainAt(5, 5)).toBe(Terrain.Mountain);
		// terrain does not depend on size, so everything inside the old map is unchanged
		const plain = TileGrid.generate({ ...data, width: 160, height: 130 });
		expect(after.terrainAt(150, 120)).toBe(plain.terrainAt(150, 120));
		expect(after.terrainAt(30, 40)).toBe(plain.terrainAt(30, 40));
	});

	it("shrinks: crops from the right and bottom and drops edits that fall outside", () => {
		const data = base();
		const grid = TileGrid.generate(data);
		paint(grid, [[10, 10], [99, 69], [70, 5]]);
		const small = resizeMapData({ ...data, edits: grid.exportEdits() }, 64, 64);
		const after = TileGrid.generate(small, small.edits);
		expect(after.terrainAt(10, 10)).toBe(Terrain.Mountain);
		expect([...after.overrides].filter((v) => v !== NO_OVERRIDE)).toHaveLength(1);
		expect(Object.keys(small.edits)).toEqual(["0,0"]);
	});

	it("round-trips grow then shrink back, and leaves labels alone", () => {
		const data = { ...base(), labels: [{ id: "l", text: "Far", x: 90, y: 60, size: "m" as const }] };
		const grid = TileGrid.generate(data);
		paint(grid, [[95, 65]]);
		const withEdits = { ...data, edits: grid.exportEdits() };
		const there = resizeMapData(resizeMapData(withEdits, 200, 200), 100, 70);
		expect(there.edits).toEqual(withEdits.edits);
		expect(there.labels).toEqual(data.labels);
	});

	it("does nothing for the same size and refuses sizes outside the limits", () => {
		const data = base();
		expect(resizeMapData(data, 100, 70)).toBe(data);
		for (const [w, h] of [[10, 64], [64, 5000], [64.5, 64], [0, 0]]) {
			expect(isValidMapSize(w, h)).toBe(false);
			expect(() => resizeMapData(data, w, h)).toThrow();
		}
		expect(isValidMapSize(16, 1024)).toBe(true);
	});
});
