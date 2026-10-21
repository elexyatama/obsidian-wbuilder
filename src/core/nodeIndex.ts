import { Emitter, type Unsubscribe } from "./emitter";
import { parseNode, type NodeParseResult } from "./frontmatter";
import { baseName } from "./links";
import { parseMentions } from "./tracker";
import { isPin, type Mention, type NodeRecord, type Pin } from "./types";

export interface IndexChange {
	added: NodeRecord[];
	updated: NodeRecord[];
	removed: NodeRecord[];
}

const tileKey = (x: number, y: number) => `${x},${y}`;

const sameList = <T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean) =>
	a.length === b.length && a.every((item, i) => eq(item, b[i]));

const sameNode = (a: NodeRecord, b: NodeRecord) =>
	a.type === b.type &&
	a.map === b.map &&
	a.x === b.x &&
	a.y === b.y &&
	a.icon === b.icon &&
	a.overview === b.overview &&
	a.start === b.start &&
	a.end === b.end &&
	sameList(a.parents, b.parents, (p, q) => p === q) &&
	sameList(a.affiliations, b.affiliations, (p, q) => p === q) &&
	sameList(a.locations, b.locations, (p, q) => JSON.stringify(p) === JSON.stringify(q)) &&
	sameList(a.mentions, b.mentions, (p, q) => p.target === q.target && p.mark === q.mark);

/**
 * In-memory projection of the world's notes, rebuilt from their frontmatter (and, for
 * events, their text). The files are the source of truth; this is never persisted. Hosts
 * feed it through upsert/remove/rename and views subscribe to `changed`.
 *
 * `changed` only fires when something actually changed, so a write we made to a note and
 * the file-change event it triggers don't loop.
 */
export class NodeIndex {
	private nodes = new Map<string, NodeRecord>();
	/** map id -> "x,y" -> paths of placed notes on that tile */
	private tiles = new Map<string, Map<string, Set<string>>>();
	private issues = new Map<string, string[]>();
	private warnings = new Map<string, string[]>();
	/** Links found in each event's text, kept so a frontmatter-only update doesn't lose them. */
	private bodyMentions = new Map<string, Mention[]>();
	private emitter = new Emitter<{ changed: IndexChange }>();

	/**
	 * Feed a note's parsed frontmatter (or undefined if it has none). Pass the note's text as
	 * `body` when you have it: events read the characters they mention from it. Omitting
	 * `body` keeps whatever was read from the text last time.
	 */
	upsert(path: string, frontmatter: unknown, body?: string): NodeParseResult {
		const result = parseNode(frontmatter);
		const change = emptyChange();
		if (result.kind === "node") {
			this.issues.delete(path);
			if (result.warnings.length > 0) this.warnings.set(path, result.warnings);
			else this.warnings.delete(path);

			const { present, ...fields } = result.fields;
			const isEvent = fields.type === "event";
			if (!isEvent) this.bodyMentions.delete(path);
			else if (body !== undefined) this.bodyMentions.set(path, parseMentions(body));
			const mentions: Mention[] = isEvent
				? [...present.map((target): Mention => ({ target, mark: "present" })), ...(this.bodyMentions.get(path) ?? [])]
				: [];
			this.setNode({ path, name: baseName(path), ...fields, mentions }, change);
		} else {
			if (result.kind === "invalid") this.issues.set(path, result.issues);
			else this.issues.delete(path);
			this.warnings.delete(path);
			this.bodyMentions.delete(path);
			this.dropNode(path, change);
		}
		this.flush(change);
		return result;
	}

	remove(path: string): void {
		const change = emptyChange();
		this.issues.delete(path);
		this.warnings.delete(path);
		this.bodyMentions.delete(path);
		this.dropNode(path, change);
		this.flush(change);
	}

	rename(oldPath: string, newPath: string): void {
		const node = this.nodes.get(oldPath);
		const change = emptyChange();
		for (const map of [this.issues, this.warnings, this.bodyMentions] as Array<Map<string, unknown>>) {
			const value = map.get(oldPath);
			map.delete(oldPath);
			if (value !== undefined) map.set(newPath, value);
		}
		if (node) {
			this.dropNode(oldPath, change);
			this.setNode({ ...node, path: newPath, name: baseName(newPath) }, change);
		}
		this.flush(change);
	}

	get(path: string): NodeRecord | undefined {
		return this.nodes.get(path);
	}

	all(): NodeRecord[] {
		return [...this.nodes.values()];
	}

	ofType(type: string): NodeRecord[] {
		return this.all().filter((n) => n.type === type);
	}

	/** Frontmatter problems for a note that looks like a node but has bad data. */
	issuesFor(path: string): readonly string[] {
		return this.issues.get(path) ?? [];
	}

	/** Smaller problems that don't stop the note counting, such as an unreadable `locations` line. */
	warningsFor(path: string): readonly string[] {
		return this.warnings.get(path) ?? [];
	}

	/** Placed notes on one tile, sorted by path. */
	at(map: string, x: number, y: number): Pin[] {
		const paths = this.tiles.get(map)?.get(tileKey(x, y));
		if (!paths) return [];
		return [...paths].sort().map((p) => this.nodes.get(p) as Pin);
	}

	inMap(map: string): Pin[] {
		return this.all().filter((n): n is Pin => isPin(n) && n.map === map);
	}

	/** Pins inside an inclusive tile rectangle. Linear scan; bucket by chunk if this gets hot. */
	inRect(map: string, x0: number, y0: number, x1: number, y1: number): Pin[] {
		return this.inMap(map).filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
	}

	on(event: "changed", fn: (change: IndexChange) => void): Unsubscribe {
		return this.emitter.on(event, fn);
	}

	private setNode(node: NodeRecord, change: IndexChange): void {
		const existing = this.nodes.get(node.path);
		if (existing && sameNode(existing, node)) return;
		if (existing) this.untile(existing);
		this.nodes.set(node.path, node);
		this.tile(node);
		(existing ? change.updated : change.added).push(node);
	}

	private dropNode(path: string, change: IndexChange): void {
		const existing = this.nodes.get(path);
		if (!existing) return;
		this.untile(existing);
		this.nodes.delete(path);
		change.removed.push(existing);
	}

	private tile(node: NodeRecord): void {
		if (!isPin(node)) return;
		let byTile = this.tiles.get(node.map);
		if (!byTile) this.tiles.set(node.map, (byTile = new Map()));
		const key = tileKey(node.x, node.y);
		let paths = byTile.get(key);
		if (!paths) byTile.set(key, (paths = new Set()));
		paths.add(node.path);
	}

	private untile(node: NodeRecord): void {
		if (!isPin(node)) return;
		const byTile = this.tiles.get(node.map);
		const key = tileKey(node.x, node.y);
		const paths = byTile?.get(key);
		if (!paths) return;
		paths.delete(node.path);
		if (paths.size === 0) byTile!.delete(key);
	}

	private flush(change: IndexChange): void {
		if (change.added.length || change.updated.length || change.removed.length) {
			this.emitter.emit("changed", change);
		}
	}
}

function emptyChange(): IndexChange {
	return { added: [], updated: [], removed: [] };
}
