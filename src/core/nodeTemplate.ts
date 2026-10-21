export interface NewNodeSpec {
	name: string;
	type: string;
	map?: string;
	x?: number;
	y?: number;
	icon?: string;
	/** One or two sentences, shown when hovering the node on a map. */
	overview?: string;
	start?: number;
	end?: number;
	/** Links to affiliation notes, e.g. "[[Order of the Ash]]". */
	affiliations?: string[];
	parents?: string[];
}

/** Removes characters Obsidian does not allow in note names. */
export function sanitizeNoteName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\.+$/, "");
}

const RESERVED = /^(true|false|yes|no|on|off|null|~)$/i;

/** A YAML-safe string: bare when it is plainly a word or two, otherwise JSON-quoted. */
export function yamlScalar(value: string): string {
	return /^[A-Za-z][A-Za-z0-9_./ -]*$/.test(value) && value === value.trim() && !RESERVED.test(value)
		? value
		: JSON.stringify(value);
}

/** The frontmatter a new node note starts with. Start/end are left out when indefinite. */
export function buildFrontmatter(spec: NewNodeSpec): Record<string, unknown> {
	const fm: Record<string, unknown> = { type: spec.type };
	if (spec.map !== undefined) {
		fm.map = spec.map;
		fm.x = spec.x;
		fm.y = spec.y;
	}
	if (spec.icon) fm.icon = spec.icon;
	const overview = spec.overview?.replace(/\s+/g, " ").trim();
	if (overview) fm.overview = overview;
	if (spec.start !== undefined) fm.start = spec.start;
	if (spec.end !== undefined) fm.end = spec.end;
	if (spec.affiliations && spec.affiliations.length > 0) fm.affiliation = spec.affiliations;
	if (spec.type === "character" || (spec.parents && spec.parents.length > 0)) fm.parents = spec.parents ?? [];
	return fm;
}

export function buildNoteText(spec: NewNodeSpec): string {
	const lines = ["---"];
	for (const [key, value] of Object.entries(buildFrontmatter(spec))) {
		if (Array.isArray(value)) {
			if (value.length === 0) lines.push(`${key}: []`);
			else {
				lines.push(`${key}:`);
				for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
			}
		} else if (typeof value === "string") {
			lines.push(`${key}: ${yamlScalar(value)}`);
		} else {
			lines.push(`${key}: ${String(value)}`);
		}
	}
	lines.push("---", "", `# ${spec.name}`, "", "");
	return lines.join("\n");
}
