import type { LinkResolver } from "./family";
import { linkTarget } from "./links";
import { isPin, type NodeRecord } from "./types";

/**
 * Plain-language summary of how WBuilder reads a note, one line each. Shown by the
 * "check note" command and in the messages that explain why a feature isn't available.
 * `typeOf` lets it say when a link meant as an affiliation points at some other kind of note.
 */
export function describeNote(
	name: string,
	node: NodeRecord | undefined,
	issues: readonly string[],
	warnings: readonly string[],
	resolve: LinkResolver,
	typeOf?: (path: string) => string | undefined,
): string[] {
	const lines = [name];
	if (!node) {
		if (issues.length > 0) lines.push("Can't read this note's properties:", ...issues.map((issue) => `  • ${issue}`));
		else lines.push("Not part of the world yet. Give it type: character (or a map position) in its properties.");
		return lines;
	}

	const facts = [`type: ${node.type}`];
	if (isPin(node)) facts.push(`on map "${node.map}" at ${node.x}, ${node.y}`);
	if (node.start !== undefined || node.end !== undefined) facts.push(`years ${node.start ?? "…"} to ${node.end ?? "…"}`);
	lines.push(facts.join(" · "));
	lines.push(node.overview ? `overview: ${node.overview}` : "overview: none (add an overview property to show text when hovering it on the map)");

	if (node.parents.length > 0) {
		lines.push("parents:");
		for (const raw of node.parents) {
			const target = linkTarget(raw);
			lines.push(`  ${target} → ${resolve(target, node.path) ?? "no note with that name"}`);
		}
	} else if (node.type === "character") {
		lines.push("parents: none listed");
	}

	if (node.affiliations.length > 0) {
		lines.push("affiliation:");
		for (const raw of node.affiliations) {
			const target = linkTarget(raw);
			const path = resolve(target, node.path);
			const kind = path ? typeOf?.(path) : undefined;
			const wrongKind = kind !== undefined && kind !== "affiliation" ? ` (that note is a ${kind}, not an affiliation)` : "";
			lines.push(`  ${target} → ${path ? `${path}${wrongKind}` : "no note with that name"}`);
		}
	}

	if (node.locations.length > 0) lines.push(`locations: ${node.locations.length} ${node.locations.length === 1 ? "entry" : "entries"}`);
	for (const warning of warnings) lines.push(`⚠ ${warning}`);
	return lines;
}
