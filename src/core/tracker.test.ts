import { describe, expect, it } from "vitest";
import { NodeIndex } from "./nodeIndex";
import {
	buildTracks,
	formatLocationEntry,
	parseLocationEntry,
	parseLocations,
	parseMentions,
	presenceAt,
	removeLocationRaw,
	trackSegments,
	upsertLocationRaw,
	type TrackPoint,
} from "./tracker";
import { computeTracking, describePresence, TRACK_COLORS } from "./tracking";
import type { LocationEntry, NodeRecord } from "./types";

describe("location entries", () => {
	it("reads the string forms", () => {
		expect(parseLocationEntry("300: world 80,32")).toEqual({ year: 300, map: "world", x: 80, y: 32 });
		expect(parseLocationEntry("320: 92, 32")).toEqual({ year: 320, x: 92, y: 32 });
		expect(parseLocationEntry("-5: eldoria -3,0")).toEqual({ year: -5, map: "eldoria", x: -3, y: 0 });
		expect(parseLocationEntry("340: missing")).toEqual({ year: 340, missing: true });
		expect(parseLocationEntry("340:  MISSING ")).toEqual({ year: 340, missing: true });
	});

	it("reads the object forms", () => {
		expect(parseLocationEntry({ year: 10, map: "w", x: 1, y: 2 })).toEqual({ year: 10, map: "w", x: 1, y: 2 });
		expect(parseLocationEntry({ year: 10, x: 1, y: 2 })).toEqual({ year: 10, x: 1, y: 2 });
		expect(parseLocationEntry({ year: 10, missing: true })).toEqual({ year: 10, missing: true });
	});

	it("rejects anything else", () => {
		for (const bad of ["", "320 92 32", "320: 92", "x: 1,2", "320: 1.5,2", { year: "a", x: 1, y: 1 }, { year: 5, x: 1.5, y: 1 }, 7, null]) {
			expect(parseLocationEntry(bad)).toBeNull();
		}
	});

	it("round-trips through format", () => {
		for (const entry of [{ year: 300, map: "world", x: 80, y: 32 }, { year: 320, x: 1, y: 2 }, { year: 340, missing: true }] as LocationEntry[]) {
			expect(parseLocationEntry(formatLocationEntry(entry))).toEqual(entry);
		}
	});

	it("sorts by year and warns about unreadable lines", () => {
		const { entries, warnings } = parseLocations(["340: missing", "300: 1,1", "nonsense"]);
		expect(entries.map((e) => e.year)).toEqual([300, 340]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("nonsense");
		expect(parseLocations(undefined)).toEqual({ entries: [], warnings: [] });
		expect(parseLocations("300: 1,1").entries).toHaveLength(1);
	});

	it("upserts into the raw list, replacing the same year and keeping other items as written", () => {
		const raw = ["300: world 1,1", { year: 320, x: 5, y: 5 }, "garbage"];
		const next = upsertLocationRaw(raw, { year: 310, map: "world", x: 9, y: 9 });
		expect(next).toEqual(["300: world 1,1", "310: world 9,9", { year: 320, x: 5, y: 5 }, "garbage"]);
		expect(upsertLocationRaw(raw, { year: 300, missing: true })).toEqual(["300: missing", { year: 320, x: 5, y: 5 }, "garbage"]);
		expect(upsertLocationRaw(undefined, { year: 1, x: 2, y: 3 })).toEqual(["1: 2,3"]);
		expect(upsertLocationRaw("100: 1,1", { year: 50, x: 0, y: 0 })).toEqual(["50: 0,0", "100: 1,1"]);
	});

	it("removes the entry for a year", () => {
		expect(removeLocationRaw(["300: 1,1", "310: 2,2", "junk"], 300)).toEqual(["310: 2,2", "junk"]);
		expect(removeLocationRaw(["300: 1,1"], 999)).toEqual(["300: 1,1"]);
		expect(removeLocationRaw(undefined, 1)).toEqual([]);
	});
});

describe("mentions", () => {
	it("marks present, absent and plain links", () => {
		expect(parseMentions("@[[Alaric]] held the gate; ~[[Cedric]] heard later. [[Beatrix]] fled.")).toEqual([
			{ target: "Alaric", mark: "present" },
			{ target: "Cedric", mark: "absent" },
			{ target: "Beatrix", mark: "plain" },
		]);
	});

	it("understands aliases, headings and folders, and dedupes", () => {
		expect(parseMentions("[[World/Alaric#Early life|the lord]] and again [[World/Alaric|him]]")).toEqual([
			{ target: "World/Alaric", mark: "plain" },
		]);
	});

	it("ignores embeds, code, and frontmatter", () => {
		const text = ["---", "parents: ['[[Hidden]]']", "---", "![[Embedded]]", "`[[Inline]]`", "```", "[[Fenced]]", "```", "[[Real]]"].join("\n");
		expect(parseMentions(text)).toEqual([{ target: "Real", mark: "plain" }]);
	});
});

describe("NodeIndex and mentions", () => {
	it("reads mentions from an event's text and its present list, only for events", () => {
		const index = new NodeIndex();
		index.upsert("Siege.md", { type: "event", map: "world", x: 1, y: 1, start: 340, present: ["[[Dara]]"] }, "@[[Alaric]] and [[Beatrix]]");
		expect(index.get("Siege.md")?.mentions).toEqual([
			{ target: "Dara", mark: "present" },
			{ target: "Alaric", mark: "present" },
			{ target: "Beatrix", mark: "plain" },
		]);
		index.upsert("Keep.md", { type: "structure", map: "world", x: 2, y: 2 }, "[[Alaric]]");
		expect(index.get("Keep.md")?.mentions).toEqual([]);
	});

	it("keeps text-derived mentions across a frontmatter-only update, and emits when they change", () => {
		const index = new NodeIndex();
		const fm = { type: "event", map: "world", x: 1, y: 1, start: 5 };
		index.upsert("E.md", fm, "[[A]]");
		index.upsert("E.md", { ...fm, start: 6 });
		expect(index.get("E.md")?.mentions).toEqual([{ target: "A", mark: "plain" }]);
		let events = 0;
		index.on("changed", () => events++);
		index.upsert("E.md", { ...fm, start: 6 }, "[[A]]");
		expect(events).toBe(0);
		index.upsert("E.md", { ...fm, start: 6 }, "@[[A]]");
		expect(events).toBe(1);
	});

	it("tracks warnings and moves them on rename", () => {
		const index = new NodeIndex();
		index.upsert("A.md", { type: "character", locations: ["???"] });
		expect(index.warningsFor("A.md")).toHaveLength(1);
		index.rename("A.md", "B.md");
		expect(index.warningsFor("B.md")).toHaveLength(1);
		index.upsert("B.md", { type: "character", locations: ["1: 1,1"] });
		expect(index.warningsFor("B.md")).toHaveLength(0);
	});
});

const resolver = (nodes: NodeRecord[]) => (target: string) => nodes.find((n) => n.name === target)?.path ?? null;
const lastPoint = (track?: { points: TrackPoint[] }) => track?.points[track.points.length - 1];

function world() {
	const index = new NodeIndex();
	index.upsert("Alaric.md", {
		type: "character",
		born: 300,
		died: 360,
		locations: ["300: world 80,32", "315: world 92,32", "325: missing", "332: world 86,40"],
	});
	index.upsert("Beatrix.md", { type: "character", locations: ["305: world 80,32"] });
	index.upsert("Cedric.md", { type: "character", locations: ["330: world 80,32"] });
	index.upsert("Fenn.md", { type: "character", map: "world", x: 10, y: 10 });
	index.upsert(
		"Siege.md",
		{ type: "event", map: "world", x: 90, y: 36, start: 340 },
		"@[[Alaric]] held the gate. [[Beatrix]] fled. ~[[Cedric]] only heard of it. [[Dragon Keep]] fell. [[Nobody]]",
	);
	index.upsert("Dragon Keep.md", { type: "structure", map: "world", x: 80, y: 32 });
	return index;
}

describe("buildTracks", () => {
	it("adds event placements in auto mode, honoring ~ and ignoring non-characters", () => {
		const index = world();
		const tracks = buildTracks(index.all(), resolver(index.all()), "auto");
		expect(tracks.get("Alaric.md")?.points.map((p) => [p.year, p.source])).toEqual([
			[300, "manual"], [315, "manual"], [325, "manual"], [332, "manual"], [340, "event"],
		]);
		expect(lastPoint(tracks.get("Beatrix.md"))).toMatchObject({ year: 340, source: "event", via: "Siege.md", at: { map: "world", x: 90, y: 36 } });
		expect(tracks.get("Cedric.md")?.points).toHaveLength(1);
		expect(tracks.has("Dragon Keep.md")).toBe(false);
	});

	it("in marked mode only @ links place a character", () => {
		const index = world();
		const tracks = buildTracks(index.all(), resolver(index.all()), "marked");
		expect(lastPoint(tracks.get("Alaric.md"))?.source).toBe("event");
		expect(tracks.get("Beatrix.md")?.points.map((p) => p.source)).toEqual(["manual"]);
	});

	it("lets ~ beat @ and plain links in the same event", () => {
		const index = new NodeIndex();
		index.upsert("A.md", { type: "character" });
		index.upsert("E.md", { type: "event", map: "w", x: 1, y: 1, start: 5 }, "@[[A]] [[A]] ~[[A]]");
		const tracks = buildTracks(index.all(), resolver(index.all()), "auto");
		expect(tracks.has("A.md")).toBe(false);
	});

	it("ignores events with no tile or no start year", () => {
		const index = new NodeIndex();
		index.upsert("A.md", { type: "character" });
		index.upsert("NoStart.md", { type: "event", map: "w", x: 1, y: 1 }, "@[[A]]");
		index.upsert("NoTile.md", { type: "event", start: 5 }, "@[[A]]");
		expect(buildTracks(index.all(), resolver(index.all()), "auto").size).toBe(0);
	});

	it("lets a manual entry beat an event in the same year", () => {
		const index = new NodeIndex();
		index.upsert("A.md", { type: "character", locations: ["5: w 9,9"] });
		index.upsert("E.md", { type: "event", map: "w", x: 1, y: 1, start: 5 }, "@[[A]]");
		const track = buildTracks(index.all(), resolver(index.all()), "auto").get("A.md");
		expect(presenceAt(index.get("A.md")!, track, 5)).toMatchObject({ state: "at", x: 9, y: 9, source: "manual" });
	});
});

describe("presenceAt", () => {
	const index = world();
	const tracks = buildTracks(index.all(), resolver(index.all()), "auto");
	const alaric = index.get("Alaric.md")!;
	const at = (year: number) => presenceAt(alaric, tracks.get(alaric.path), year);

	it("stays at the latest entry until the next one", () => {
		expect(at(300)).toMatchObject({ state: "at", x: 80, y: 32 });
		expect(at(314)).toMatchObject({ state: "at", x: 80, y: 32 });
		expect(at(315)).toMatchObject({ state: "at", x: 92, y: 32 });
		expect(at(335)).toMatchObject({ state: "at", x: 86, y: 40 });
		expect(at(340)).toMatchObject({ state: "at", x: 90, y: 36, source: "event", via: "Siege.md" });
		expect(at(359)).toMatchObject({ state: "at", x: 90, y: 36 });
	});

	it("is missing between a missing entry and the next one", () => {
		expect(at(325)).toEqual({ state: "missing" });
		expect(at(331)).toEqual({ state: "missing" });
		expect(at(332)).toMatchObject({ state: "at" });
	});

	it("is not around before birth or after death", () => {
		expect(at(299)).toEqual({ state: "unborn" });
		expect(at(361)).toEqual({ state: "deceased" });
	});

	it("falls back to the note's own tile before the first entry, else unknown", () => {
		const beatrix = index.get("Beatrix.md")!;
		expect(presenceAt(beatrix, tracks.get(beatrix.path), 100)).toEqual({ state: "unknown" });
		const fenn = index.get("Fenn.md")!;
		expect(presenceAt(fenn, undefined, 100)).toMatchObject({ state: "at", x: 10, y: 10, source: "home" });
	});
});

describe("trackSegments", () => {
	const index = world();
	const tracks = buildTracks(index.all(), resolver(index.all()), "auto");
	const segments = (path: string) => trackSegments(index.get(path)!, tracks.get(path));

	it("joins consecutive places and breaks the line at a missing period", () => {
		const s = segments("Alaric.md");
		expect(s.map((x) => [x.from.x, x.from.y, x.to.x, x.to.y])).toEqual([
			[80, 32, 92, 32],
			// missing 325-332: no leg from (92,32) to (86,40)
			[86, 40, 90, 36],
		]);
		expect(s[0]).toMatchObject({ fromYear: 300, toYear: 315 });
	});

	it("starts from the note's own tile and skips legs that go nowhere", () => {
		const index2 = new NodeIndex();
		index2.upsert("A.md", { type: "character", map: "w", x: 1, y: 1, locations: ["10: w 1,1", "20: w 5,5"] });
		const tracks2 = buildTracks(index2.all(), () => null, "auto");
		const s = trackSegments(index2.get("A.md")!, tracks2.get("A.md"));
		expect(s).toHaveLength(1);
		expect(s[0].to).toMatchObject({ x: 5, y: 5 });
	});

	it("ignores entries outside the lifetime and legs between different maps", () => {
		const index2 = new NodeIndex();
		index2.upsert("A.md", { type: "character", born: 10, died: 20, locations: ["5: a 0,0", "12: a 1,1", "15: b 2,2", "30: a 9,9"] });
		const tracks2 = buildTracks(index2.all(), () => null, "auto");
		expect(trackSegments(index2.get("A.md")!, tracks2.get("A.md"))).toEqual([]);
	});
});

describe("computeTracking", () => {
	const index = world();
	const nodes = index.all();
	const tracks = buildTracks(nodes, resolver(nodes), "auto");
	const base = {
		characters: index.ofType("character"),
		tracks,
		tracked: new Set(["Alaric.md", "Beatrix.md"]),
		colors: new Map([["Alaric.md", TRACK_COLORS[0]], ["Beatrix.md", TRACK_COLORS[1]]]),
		enabled: true,
		year: 335,
		mapId: "world",
		showPaths: false,
		warnings: () => [] as string[],
	};

	it("moves tracked characters to their position in the current year and hides their static pins", () => {
		const view = computeTracking(base);
		expect(view.moved.map((p) => [p.name, p.x, p.y])).toEqual([["Alaric", 86, 40], ["Beatrix", 80, 32]]);
		expect([...view.hidden].sort()).toEqual(["Alaric.md", "Beatrix.md"]);
		expect(view.rings.get("Alaric.md")).toBe(TRACK_COLORS[0]);
		expect(view.lines).toEqual([]);
	});

	it("lists every character, tracked ones first, with a status", () => {
		const view = computeTracking({ ...base, year: 327 });
		expect(view.rows.map((r) => r.name)).toEqual(["Alaric", "Beatrix", "Cedric", "Fenn"]);
		expect(view.rows[0]).toMatchObject({ selected: true, status: "missing" });
		expect(view.rows[1].status).toBe("at 80, 32");
		expect(view.rows[2]).toMatchObject({ selected: false, status: "" });
		expect(view.moved.map((p) => p.name)).toEqual(["Beatrix"]);
	});

	it("draws paths with traveled and upcoming legs, only for tracked characters", () => {
		const view = computeTracking({ ...base, showPaths: true, year: 310 });
		expect(view.lines.map((l) => l.path)).toEqual(["Alaric.md", "Beatrix.md"]);
		const alaric = view.lines[0].segments;
		expect(alaric.map((s) => s.traveled)).toEqual([false, false]);
		expect(computeTracking({ ...base, showPaths: true, year: 316 }).lines[0].segments[0].traveled).toBe(true);
	});

	it("leaves everything alone while the timeline is off", () => {
		const view = computeTracking({ ...base, enabled: false, showPaths: true });
		expect(view.moved).toEqual([]);
		expect(view.hidden.size).toBe(0);
		expect(view.rows[0].status).toContain("timeline");
		expect(view.lines[0].segments.every((s) => s.traveled)).toBe(true);
	});

	it("only shows characters whose position is on this map", () => {
		const view = computeTracking({ ...base, mapId: "other" });
		expect(view.moved).toEqual([]);
		expect(view.rows[1].status).toBe("at 80, 32 on world");
	});

	it("describes presence states and event sources", () => {
		expect(describePresence({ state: "at", x: 1, y: 2, source: "event", via: "World/Siege.md" }, "world")).toBe("at 1, 2 · event: Siege");
		expect(describePresence({ state: "at", x: 1, y: 2, source: "home" }, "world")).toBe("at 1, 2 · home");
		expect(describePresence({ state: "unborn" }, "w")).toBe("not born yet");
		expect(describePresence({ state: "deceased" }, "w")).toBe("deceased");
		expect(describePresence({ state: "unknown" }, "w")).toBe("location unknown");
	});
});
