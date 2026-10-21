import { TFile, type Plugin, type TAbstractFile } from "obsidian";
import type { NodeIndex } from "../../core/nodeIndex";

const isNote = (file: TAbstractFile): file is TFile => file instanceof TFile && file.extension === "md";

/**
 * Keeps the LocationIndex in step with the vault. Obsidian's MetadataCache already
 * parses frontmatter, so this host never reads or parses note text itself.
 */
export function syncIndexWithVault(plugin: Plugin, index: NodeIndex): void {
	const { vault, metadataCache, workspace } = plugin.app;

	const seed = () => {
		for (const file of vault.getMarkdownFiles()) {
			index.upsert(file.path, metadataCache.getFileCache(file)?.frontmatter);
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

	plugin.registerEvent(metadataCache.on("changed", (file, _data, cache) => index.upsert(file.path, cache.frontmatter)));
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
