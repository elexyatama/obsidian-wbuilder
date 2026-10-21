/** Where new notes of each type go by default, inside the notes folder. */
export const DEFAULT_TYPE_FOLDERS: Readonly<Record<string, string>> = {
	place: "Places",
	structure: "Structures",
	character: "Characters",
	creature: "Creatures",
	faction: "Factions",
	affiliation: "Affiliations",
	event: "Events",
	item: "Items",
};

export interface FolderConfig {
	/** The notes folder. */
	base: string;
	/** When off, every new note goes straight into `base`. */
	sortByType: boolean;
	/** Folder names the user changed, by type. Types missing here use DEFAULT_TYPE_FOLDERS. */
	typeFolders: Readonly<Record<string, string>>;
}

/** A vault-relative folder path with forward slashes and no empty, "." or ".." parts. */
export function cleanFolder(path: string): string {
	return path
		.replace(/\\/g, "/")
		.split("/")
		.map((part) => part.trim())
		.filter((part) => part !== "" && part !== "." && part !== "..")
		.join("/");
}

/**
 * The folder a new note of this type is created in. By default every type has its own folder
 * under the notes folder (Characters, Events, ...). A type's folder can be renamed in the
 * settings; "." puts that type straight into the notes folder; types without a folder (your
 * own invented ones) go into the notes folder.
 */
export function folderForType(type: string, config: FolderConfig): string {
	const base = cleanFolder(config.base);
	if (!config.sortByType) return base;
	const chosen = config.typeFolders[type]?.trim();
	const sub = chosen ? cleanFolder(chosen) : (DEFAULT_TYPE_FOLDERS[type] ?? "");
	return [base, sub].filter(Boolean).join("/");
}
