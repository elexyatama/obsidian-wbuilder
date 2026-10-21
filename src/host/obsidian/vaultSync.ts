import { TFile, type Plugin, type TAbstractFile } from "obsidian";
import type { NodeIndex } from "../../core/nodeIndex";

const isNote = (file: TAbstractFile): file is TFile => file instanceof TFile && file.extension === "md";

const isEventFrontmatter = (frontmatter: unknown): boolean => {
	const type = (frontmatter as { type?: unknown } | undefined)?.type;
	return typeof type === "string" && type.trim().toLowerCase() === "event";
};

/**
 * Keeps the NodeIndex in step with the vault. Obsidian's MetadataCache already parses
 * frontmatter, so this host never parses YAML itself. Events also need their text (to see
 * which characters they mention): `changed` hands it over for free, and at startup the
 * event notes are read once.
 */
export function syncIndexWithVault(plugin: Plugin, index: NodeIndex): void {
	const { vault, metadataCache, workspace } = plugin.app;

	const seed = () => {
		const events: TFile[] = [];
		for (const file of vault.getMarkdownFiles()) {
			const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
			index.upsert(file.path, frontmatter);
			if (isEventFrontmatter(frontmatter)) events.push(file);
		}
		for (const file of events) {
			void vault.cachedRead(file).then((text) => {
				index.upsert(file.path, metadataCache.getFileCache(file)?.frontmatter, text);
			});
		}
	};

	// Seed once the workspace is ready, and once more when the cache finishes its first
	// full pass in case some files were not parsed yet. Upserts are idempotent.
	workspace.onLayoutReady(seed);
	let reseeded = false;
	plugin.registerEvent(
		metadataCache.on("resolved", () => {
			if (reseeded) return;
			reseeded = true;
			seed();
		}),
	);

	plugin.registerEvent(metadataCache.on("changed", (file, data, cache) => index.upsert(file.path, cache.frontmatter, data)));
	plugin.registerEvent(
		vault.on("rename", (file, oldPath) => {
			if (isNote(file)) index.rename(oldPath, file.path);
		}),
	);
	plugin.registerEvent(
		vault.on("delete", (file) => {
			if (isNote(file)) index.remove(file.path);
		}),
	);
}
