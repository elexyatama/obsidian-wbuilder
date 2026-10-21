import type { LinkResolver } from "./family";
import { linkTarget } from "./links";
import { isPin, type LocationEntry, type Mention, type NodeRecord } from "./types";

/* ------------------------------------------------------------------------------------------
 * `locations` entries in a character's frontmatter
 *
 *   locations:
 *     - "300: world 80,32"      at (80, 32) on map "world" from year 300
 *     - "320: 92,32"            map left out: applies to whichever map is open
 *     - "340: missing"          gone from year 340, until the next entry
 *
 * Entries can also be written as YAML objects: { year: 300, map: world, x: 80, y: 32 }.
 * ---------------------------------------------------------------------------------------- */

const NUMBER = "(-?\\d+(?:\\.\\d+)?)";
const MISSING = new RegExp(`^${NUMBER}\\s*:\\s*missing$`, "i");
const PLACE = new RegExp(`^${NUMBER}\\s*:\\s*(?:([A-Za-z0-9_.-]+)\\s+)?(-?\\d+)\\s*,\\s*(-?\\d+)$`);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One entry from a string or object, or null if it isn't a valid entry. */
export function parseLocationEntry(raw: unknown): LocationEntry | null {
	if (typeof raw === "string") {
		const text = raw.trim();
		const missing = MISSING.exec(text);
		if (missing) return { year: Number(missing[1]), missing: true };
		const place = PLACE.exec(text);
		if (place) {
			const entry: LocationEntry = { year: Number(place[1]), x: Number(place[3]), y: Number(place[4]) };
			if (place[2]) entry.map = place[2];
			return entry;
		}
		return null;
	}
	if (isRecord(raw) && typeof raw.year === "number" && Number.isFinite(raw.year)) {
		if (raw.missing === true) return { year: raw.year, missing: true };
		if (Number.isInteger(raw.x) && Number.isInteger(raw.y)) {
			const entry: LocationEntry = { year: raw.year, x: raw.x as number, y: raw.y as number };
			if (typeof raw.map === "string" && raw.map) entry.map = raw.map;
			return entry;
		}
	}
	return null;
}

export function formatLocationEntry(entry: LocationEntry): string {
	if (entry.missing) return `${entry.year}: missing`;
	return `${entry.year}: ${entry.map ? `${entry.map} ` : ""}${entry.x},${entry.y}`;
}

function toList(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

/** All readable entries sorted by year, plus a warning for each one that could not be read. */
export function parseLocations(value: unknown): { entries: LocationEntry[]; warnings: string[] } {
	const entries: LocationEntry[] = [];
	const warnings: string[] = [];
	for (const raw of toList(value)) {
		const entry = parseLocationEntry(raw);
		if (entry) entries.push(entry);
		else warnings.push(`Can't read location ${JSON.stringify(raw)}. Use "320: 12,34" or "340: missing".`);
	}
	entries.sort((a, b) => a.year - b.year);
	return { entries, warnings };
}

interface RawItem {
	raw: unknown;
	entry: LocationEntry | null;
}

function toItems(value: unknown): RawItem[] {
	return toList(value).map((raw) => ({ raw, entry: parseLocationEntry(raw) }));
}

/** Readable entries by year, then anything unreadable in its original order. Original values are kept as written. */
function ordered(items: RawItem[]): unknown[] {
	const good = items.filter((i) => i.entry !== null).sort((a, b) => (a.entry as LocationEntry).year - (b.entry as LocationEntry).year);
	const bad = items.filter((i) => i.entry === null);
	return [...good, ...bad].map((i) => i.raw);
}

/** The `locations` value with `entry` added, replacing any entry for the same year. Other items are left as the user wrote them. */
export function upsertLocationRaw(value: unknown, entry: LocationEntry): unknown[] {
	const items = toItems(value).filter((i) => i.entry?.year !== entry.year);
	items.push({ raw: formatLocationEntry(entry), entry });
	return ordered(items);
}

export function removeLocationRaw(value: unknown, year: number): unknown[] {
	return ordered(toItems(value).filter((i) => i.entry?.year !== year));
}

/* ------------------------------------------------------------------------------------------
 * Mentions in an event note
 *
 *   @[[Alaric]]   present at the event
 *   ~[[Cedric]]   mentioned only, not there
 *   [[Beatrix]]   plain: counts or not depending on the "mention mode" setting
 * ---------------------------------------------------------------------------------------- */

/** Frontmatter, code blocks and inline code are not prose, so links inside them don't count. */
function stripNonProse(text: string): string {
	return text
		.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "")
		.replace(/(```|~~~)[\s\S]*?(\1|$)/g, "")
		.replace(/`[^`\n]*`/g, "");
}

export function parseMentions(body: string): Mention[] {
	const seen = new Set<string>();
	const mentions: Mention[] = [];
	for (const match of stripNonProse(body).matchAll(/(!|@|~)?\[\[([^\]\n]+?)\]\]/g)) {
		if (match[1] === "!") continue; // an embed, not a mention
		const target = linkTarget(`[[${match[2]}]]`);
		if (!target) continue;
		const mark = match[1] === "@" ? "present" : match[1] === "~" ? "absent" : "plain";
		const key = `${mark}:${target}`;
		if (seen.has(key)) continue;
		seen.add(key);
		mentions.push({ target, mark });
	}
	return mentions;
}

/* ------------------------------------------------------------------------------------------
 * Tracks: where each character is, year by year
 * ---------------------------------------------------------------------------------------- */

/** "auto": plain links count as presence unless marked ~. "marked": only @ links count. */
export type MentionMode = "auto" | "marked";

export interface TrackPoint {
	year: number;
	/** Null means missing. */
	at: { map?: string; x: number; y: number } | null;
	source: "manual" | "event";
	/** Path of the event that put the character here. */
	via?: string;
}

export interface Track {
	/** Sorted by year; for one year, event points come before manual ones so a manual entry wins. */
	points: TrackPoint[];
}

/**
 * Combines each character's own `locations` with the events that mention them. An event
 * places a character at the event's tile in the event's start year, when the event is on a
 * map, has a start year, and the mention counts (see MentionMode). A `~` mention of a
 * character anywhere in an event always keeps that event from placing them.
 */
export function buildTracks(nodes: readonly NodeRecord[], resolve: LinkResolver, mode: MentionMode): Map<string, Track> {
	const characters = new Map(nodes.filter((n) => n.type === "character").map((n) => [n.path, n]));
	const points = new Map<string, TrackPoint[]>();
	const add = (path: string, point: TrackPoint) => {
		const list = points.get(path);
		if (list) list.push(point);
		else points.set(path, [point]);
	};

	for (const character of characters.values()) {
		for (const entry of character.locations) {
			add(character.path, {
				year: entry.year,
				at: entry.missing ? null : { map: entry.map, x: entry.x, y: entry.y },
				source: "manual",
			});
		}
	}

	const events = nodes
		.filter((n) => n.type === "event" && n.mentions.length > 0)
		.sort((a, b) => a.path.localeCompare(b.path));
	for (const event of events) {
		if (!isPin(event) || event.start === undefined) continue;
		const present = new Set<string>();
		const absent = new Set<string>();
		for (const mention of event.mentions) {
			const path = resolve(mention.target, event.path);
			if (!path) continue;
			if (mention.mark === "absent") absent.add(path);
			else if (mention.mark === "present" || mode === "auto") present.add(path);
		}
		for (const path of present) {
			if (absent.has(path) || !characters.has(path)) continue;
			add(path, { year: event.start, at: { map: event.map, x: event.x, y: event.y }, source: "event", via: event.path });
		}
	}

	const tracks = new Map<string, Track>();
	for (const [path, list] of points) {
		const rank = (p: TrackPoint) => (p.source === "event" ? 0 : 1);
		tracks.set(path, { points: [...list].sort((a, b) => a.year - b.year || rank(a) - rank(b)) });
	}
	return tracks;
}

export type Presence =
	| { state: "at"; map?: string; x: number; y: number; source: "manual" | "event" | "home"; via?: string }
	| { state: "missing" }
	| { state: "unborn" }
	| { state: "deceased" }
	| { state: "unknown" };

/**
 * Where a character is in `year`: at the latest entry on or before that year (a step
 * function, so they stay put until the next entry), missing, or not around at all. Before
 * the first entry they are at their note's own `map/x/y`, if it has one.
 */
export function presenceAt(node: NodeRecord, track: Track | undefined, year: number): Presence {
	if (node.start !== undefined && year < node.start) return { state: "unborn" };
	if (node.end !== undefined && year > node.end) return { state: "deceased" };
	let current: TrackPoint | undefined;
	for (const point of track?.points ?? []) {
		if (point.year > year) break;
		current = point;
	}
	if (current) {
		return current.at ? { state: "at", ...current.at, source: current.source, via: current.via } : { state: "missing" };
	}
	if (isPin(node)) return { state: "at", map: node.map, x: node.x, y: node.y, source: "home" };
	return { state: "unknown" };
}

export interface TrackEnd {
	map?: string;
	x: number;
	y: number;
}

export interface TrackSegment {
	from: TrackEnd;
	to: TrackEnd;
	fromYear: number;
	toYear: number;
}

/**
 * The legs of a character's journey while alive, in order. A missing period breaks the
 * line: it resumes from wherever they reappear.
 */
export function trackSegments(node: NodeRecord, track: Track | undefined): TrackSegment[] {
	const first = node.start ?? -Infinity;
	const last = node.end ?? Infinity;
	let points = (track?.points ?? []).filter((p) => p.year >= first && p.year <= last);
	if (isPin(node) && (points.length === 0 || points[0].year > first)) {
		points = [{ year: first, at: { map: node.map, x: node.x, y: node.y }, source: "manual" }, ...points];
	}

	const segments: TrackSegment[] = [];
	let previous: TrackPoint | null = null;
	for (const point of points) {
		if (!point.at) {
			previous = null;
			continue;
		}
		const from = previous?.at;
		const to = point.at;
		const sameMap = from && (from.map === undefined || to.map === undefined || from.map === to.map);
		if (previous && from && sameMap && (from.x !== to.x || from.y !== to.y)) {
			segments.push({ from, to, fromYear: previous.year, toYear: point.year });
		}
		previous = point;
	}
	return segments;
}
