import { Notice, normalizePath, type App, type TFile } from "obsidian";
import { buildNoteText, sanitizeNoteName, type NewNodeSpec } from "../../core/nodeTemplate";

/** Creates every missing folder along a path. */
export async function ensureFolder(app: App, folder: string): Promise<void> {
	let current = "";
	for (const part of normalizePath(folder).split("/").filter(Boolean)) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
	}
}

export function pathInFolder(folder: string, fileName: string): string {
	return normalizePath(folder ? `${folder}/${fileName}` : fileName);
}

/**
 * Creates the note for a new node. Tells the user and returns null if the name is unusable or
 * taken. A name counts as taken if it exists in *any* folder: notes are linked by name, so with
 * a folder per type "Alaric" in Characters and "Alaric" in Places would make [[Alaric]] ambiguous.
 */
export async function createNodeNote(app: App, folder: string, spec: NewNodeSpec): Promise<TFile | null> {
	const name = sanitizeNoteName(spec.name);
	if (!name) {
		new Notice("Give the note a name.");
		return null;
	}
	const clash = app.vault.getMarkdownFiles().find((file) => file.basename.toLowerCase() === name.toLowerCase());
	if (clash) {
		new Notice(`A note called "${name}" already exists (${clash.path}). Pick another name so links to it stay unambiguous.`);
		return null;
	}
	const path = pathInFolder(folder, `${name}.md`);
	if (app.vault.getAbstractFileByPath(path)) {
		new Notice(`"${path}" already exists.`);
		return null;
	}
	if (folder) await ensureFolder(app, folder);
	return app.vault.create(path, buildNoteText({ ...spec, name }));
}
