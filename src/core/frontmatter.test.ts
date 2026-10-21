import { describe, expect, it } from "vitest";
import { parseNode } from "./frontmatter";

describe("parseNode", () => {
	it("ignores notes that are not part of the world", () => {
		expect(parseNode(undefined)).toEqual({ kind: "none" });
		expect(parseNode({ title: "x" })).toEqual({ kind: "none" });
		expect(parseNode({ x: 1, y: 2 })).toEqual({ kind: "none" });
		expect(parseNode({ type: "book" })).toEqual({ kind: "none" });
		expect(parseNode({ map: null, x: 1, y: 2 })).toEqual({ kind: "none" });
	});

	it("reads a placed node", () => {
		expect(parseNode({ type: "structure", map: "world", x: 12, y: 34, icon: "castle" })).toEqual({
			kind: "node",
			fields: { type: "structure", map: "world", x: 12, y: 34, icon: "castle", parents: [] },
		});
	});

	it("defaults the type: place when placed, character when it has parents", () => {
		const placed = parseNode({ map: "world", x: 1, y: 2 });
		expect(placed.kind === "node" && placed.fields.type).toBe("place");
		const kid = parseNode({ parents: ["[[Alice]]"] });
		expect(kid.kind === "node" && kid.fields.type).toBe("character");
	});

	it("accepts a known type without a location", () => {
		const result = parseNode({ type: "Character" });
		expect(result.kind === "node" && result.fields.type).toBe("character");
		expect(result.kind === "node" && result.fields.map).toBeUndefined();
	});

	it("keeps unknown types when the note is placed", () => {
		const result = parseNode({ type: "Ship", map: "world", x: 1, y: 1 });
		expect(result.kind === "node" && result.fields.type).toBe("ship");
	});

	it("accepts tile_x / tile_y and negative coordinates", () => {
		const result = parseNode({ map: "world", tile_x: -3, tile_y: 0 });
		expect(result.kind === "node" && [result.fields.x, result.fields.y]).toEqual([-3, 0]);
	});

	it("ignores x/y when there is no map", () => {
		const result = parseNode({ type: "character", x: 5, y: 6 });
		expect(result.kind).toBe("node");
		expect(result.kind === "node" && result.fields.x).toBeUndefined();
	});

	it("reads periods, with born/died aliases and indefinite as the default", () => {
		const bounded = parseNode({ type: "character", born: 300, died: 360 });
		expect(bounded.kind === "node" && [bounded.fields.start, bounded.fields.end]).toEqual([300, 360]);
		const open = parseNode({ type: "structure", start: 100, end: null });
		expect(open.kind === "node" && [open.fields.start, open.fields.end]).toEqual([100, undefined]);
		const always = parseNode({ type: "place" });
		expect(always.kind === "node" && [always.fields.start, always.fields.end]).toEqual([undefined, undefined]);
	});

	it("reads parents as a list, a string, or unquoted wikilinks", () => {
		const parentsOf = (parents: unknown) => {
			const r = parseNode({ type: "character", parents });
			return r.kind === "node" ? r.fields.parents : null;
		};
		expect(parentsOf(["[[Alice]]", "[[Bob]]"])).toEqual(["[[Alice]]", "[[Bob]]"]);
		expect(parentsOf("[[Alice]]")).toEqual(["[[Alice]]"]);
		expect(parentsOf([["Alice"], ["Bob"]])).toEqual(["Alice", "Bob"]);
		expect(parentsOf(["Alice", "Alice", "", 7, null])).toEqual(["Alice"]);
		expect(parentsOf(undefined)).toEqual([]);
		expect(parentsOf([])).toEqual([]);
	});

	it("reports bad data instead of guessing", () => {
		for (const fm of [
			{ map: "world", x: 1 },
			{ map: "world", x: 1.5, y: 2 },
			{ map: "world", x: "12", y: 2 },
			{ map: "", x: 1, y: 2 },
			{ type: "character", start: "long ago" },
			{ type: "character", start: 50, end: 10 },
		]) {
			const result = parseNode(fm);
			expect(result.kind).toBe("invalid");
			if (result.kind === "invalid") expect(result.issues.length).toBeGreaterThan(0);
		}
	});
});
