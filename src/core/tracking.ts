import { baseName } from "./links";
import { presenceAt, trackSegments, type Presence, type Track } from "./tracker";
import type { NodeRecord, Pin } from "./types";

/** Distinct colors for tracked characters, handed out in the order they are picked. */
export const TRACK_COLORS = ["#e6194b", "#3cb44b", "#4a6cf0", "#f58231", "#a23bc9", "#2bb8d9", "#e03fb4", "#9ac21f"];

export interface TrackerRow {
	path: string;
	name: string;
	selected: boolean;
	color?: string;
	/** Where they are right now, or why they are not on the map. Empty for characters not being tracked. */
	status: string;
	/** Tile they are on in the current year, if any (for "go to"). */
	at?: { x: number; y: number };
	warnings: string[];
}

export interface LineSegment {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** The journey has already reached the end of this leg in the current year. */
	traveled: boolean;
}

export interface TrackLine {
	path: string;
	color: string;
	segments: LineSegment[];
}

export interface TrackingInput {
	characters: readonly NodeRecord[];
	tracks: ReadonlyMap<string, Track>;
	/** Selected characters. */
	tracked: ReadonlySet<string>;
	colors: ReadonlyMap<string, string>;
	/** Timeline on? Tracked characters only move (and their static pins only hide) while it is. */
	enabled: boolean;
	year: number;
	mapId: string;
	showPaths: boolean;
	warnings(path: string): readonly string[];
}

export interface TrackingView {
	/** Pins to draw for tracked characters at their position in the current year. */
	moved: Pin[];
	/** Paths whose ordinary (static) pin must be hidden because the tracker draws them instead. */
	hidden: Set<string>;
	/** Pin ring color per tracked character. */
	rings: Map<string, string>;
	lines: TrackLine[];
	rows: TrackerRow[];
}

export function describePresence(presence: Presence, mapId: string): string {
	switch (presence.state) {
		case "at": {
			const where = `at ${presence.x}, ${presence.y}${presence.map && presence.map !== mapId ? ` on ${presence.map}` : ""}`;
			if (presence.source === "event" && presence.via) return `${where} · event: ${baseName(presence.via)}`;
			return presence.source === "home" ? `${where} · home` : where;
		}
		case "missing":
			return "missing";
		case "unborn":
			return "not born yet";
		case "deceased":
			return "deceased";
		case "unknown":
			return "location unknown";
	}
}

/**
 * Everything the map and the characters panel need for the tracker, from plain data.
 * Pure so it can be tested without a canvas.
 */
export function computeTracking(input: TrackingInput): TrackingView {
	const { tracks, tracked, colors, enabled, year, mapId } = input;
	const moved: Pin[] = [];
	const hidden = new Set<string>();
	const rings = new Map<string, string>();
	const lines: TrackLine[] = [];
	const rows: TrackerRow[] = [];

	const characters = [...input.characters].sort((a, b) => a.name.localeCompare(b.name));
	for (const node of characters) {
		const selected = tracked.has(node.path);
		const color = selected ? colors.get(node.path) : undefined;
		const track = tracks.get(node.path);
		const row: TrackerRow = { path: node.path, name: node.name, selected, color, status: "", warnings: [...input.warnings(node.path)] };
		rows.push(row);
		if (!selected) continue;

		if (enabled) {
			hidden.add(node.path);
			const presence = presenceAt(node, track, year);
			row.status = describePresence(presence, mapId);
			if (presence.state === "at" && (presence.map === undefined || presence.map === mapId)) {
				row.at = { x: presence.x, y: presence.y };
				moved.push({ ...node, map: mapId, x: presence.x, y: presence.y });
				if (color) rings.set(node.path, color);
			}
		} else {
			row.status = "turn the timeline on to see them move";
		}

		if (input.showPaths && color) {
			const segments: LineSegment[] = [];
			for (const s of trackSegments(node, track)) {
				if ((s.from.map ?? mapId) !== mapId || (s.to.map ?? mapId) !== mapId) continue;
				segments.push({ x0: s.from.x, y0: s.from.y, x1: s.to.x, y1: s.to.y, traveled: !enabled || s.toYear <= year });
			}
			if (segments.length > 0) lines.push({ path: node.path, color, segments });
		}
	}
	// selected first, then alphabetical (the sort above is stable)
	rows.sort((a, b) => Number(b.selected) - Number(a.selected));
	return { moved, hidden, rings, lines, rows };
}
