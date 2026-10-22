import { describe, expect, it, vi } from "vitest";
import { Emitter } from "./emitter";
import { NodeIndex } from "./nodeIndex";

const placed = (x: number, y: number, extra: object = {}) => ({ map: "world", x, y, ...extra });

describe("NodeIndex", () => {
	it("adds a node and emits once", () => {
		const index = new NodeIndex();
		const fn = vi.fn();
		index.on("changed", fn);
		index.upsert("World/a.md", placed(1, 2));
		expect(index.get("World/a.md")).toMatchObject({ path: "World/a.md", name: "a", type: "place", map: "world", x: 1, y: 2 });
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith(expect.objectContaining({ added: [expect.objectContaining({ path: "World/a.md" })] }));
	});

	it("does not emit when nothing changed (no write/watch feedback loop)", () => {
		const index = new NodeIndex();
		index.upsert("a.md", placed(1, 2, { parents: ["[[B]]"] }));
		const fn = vi.fn();
		index.on("changed", fn);
		index.upsert("a.md", placed(1, 2, { parents: ["[[B]]"] }));
		expect(fn).not.toHaveBeenCalled();
	});

	it("emits when type, period, icon or parents change", () => {
		const index = new NodeIndex();
		index.upsert("a.md", { type: "character" });
		const fn = vi.fn();
		index.on("changed", fn);
		index.upsert("a.md", { type: "character", born: 10 });
		index.upsert("a.md", { type: "character", born: 10, died: 50 });
		index.upsert("a.md", { type: "character", born: 10, died: 50, parents: ["[[X]]"] });
		index.upsert("a.md", { type: "creature", born: 10, died: 50, parents: ["[[X]]"] });
		expect(fn).toHaveBeenCalledTimes(4);
	});

	it("moves a pin and keeps the tile lookup in sync", () => {
		const index = new NodeIndex();
		index.upsert("a.md", placed(1, 2));
		index.upsert("a.md", placed(5, 6));
		expect(index.at("world", 1, 2)).toEqual([]);
		expect(index.at("world", 5, 6).map((p) => p.path)).toEqual(["a.md"]);
	});

	it("lists several notes on one tile, sorted by path", () => {
		const index = new NodeIndex();
		index.upsert("b.md", placed(3, 3));
		index.upsert("a.md", placed(3, 3));
		expect(index.at("world", 3, 3).map((p) => p.path)).toEqual(["a.md", "b.md"]);
	});

	it("keeps unplaced nodes out of the map but in the index", () => {
		const index = new NodeIndex();
		index.upsert("kid.md", { type: "character", parents: ["[[Mum]]"] });
		expect(index.inMap("world")).toEqual([]);
		expect(index.ofType("character").map((n) => n.path)).toEqual(["kid.md"]);
		expect(index.all()).toHaveLength(1);
	});

	it("removes a node when the note stops being one or is deleted", () => {
		const index = new NodeIndex();
		index.upsert("a.md", placed(1, 2));
		index.upsert("b.md", placed(1, 2));
		const fn = vi.fn();
		index.on("changed", fn);
		index.upsert("a.md", { title: "no longer a node" });
		index.remove("b.md");
		expect(index.all()).toEqual([]);
		expect(index.at("world", 1, 2)).toEqual([]);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("drops the node and records issues when data becomes invalid", () => {
		const index = new NodeIndex();
		index.upsert("a.md", placed(1, 2));
		const result = index.upsert("a.md", { map: "world", x: "oops", y: 2 });
		expect(result.kind).toBe("invalid");
		expect(index.get("a.md")).toBeUndefined();
		expect(index.issuesFor("a.md").length).toBeGreaterThan(0);
		index.upsert("a.md", placed(1, 2));
		expect(index.issuesFor("a.md")).toEqual([]);
	});

	it("keeps nodes across a rename and updates the name", () => {
		const index = new NodeIndex();
		index.upsert("old.md", placed(1, 2, { icon: "tower" }));
		index.rename("old.md", "World/new.md");
		expect(index.get("old.md")).toBeUndefined();
		expect(index.get("World/new.md")).toMatchObject({ name: "new", x: 1, y: 2, icon: "tower" });
		expect(index.at("world", 1, 2).map((p) => p.path)).toEqual(["World/new.md"]);
	});

	it("filters by map and by rectangle", () => {
		const index = new NodeIndex();
		index.upsert("a.md", placed(0, 0));
		index.upsert("b.md", placed(10, 10));
		index.upsert("c.md", { map: "other", x: 1, y: 1 });
		expect(index.inMap("world").map((p) => p.path).sort()).toEqual(["a.md", "b.md"]);
		expect(index.inRect("world", 0, 0, 5, 5).map((p) => p.path)).toEqual(["a.md"]);
		expect(index.inRect("world", 0, 0, 10, 10)).toHaveLength(2);
	});

	it("stops notifying after unsubscribe", () => {
		const index = new NodeIndex();
		const fn = vi.fn();
		const off = index.on("changed", fn);
		off();
		index.upsert("a.md", placed(1, 1));
		expect(fn).not.toHaveBeenCalled();
	});
});

describe("Emitter", () => {
	it("lets a handler unsubscribe while emitting", () => {
		const bus = new Emitter<{ ping: number }>();
		const calls: string[] = [];
		const off = bus.on("ping", () => {
			calls.push("first");
			off();
		});
		bus.on("ping", () => calls.push("second"));
		bus.emit("ping", 1);
		bus.emit("ping", 2);
		expect(calls).toEqual(["first", "second", "second"]);
	});
});
