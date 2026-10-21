import { TFile, type App } from "obsidian";
import { Emitter, type Unsubscribe } from "../../core/emitter";
import { findSticker, looksLikeEmoji } from "../../core/stickers";
import { resolveBuiltin, type ResolvedSticker, type StickerResolver } from "../../render/stickerPainter";
import type { CustomSticker } from "../../render/ui/stickerPalette";
import { isImageExtension } from "./constants";

/**
 * Image stickers from the vault. A note's `icon` can be a path ("Stickers/tree.png") or just
 * a file name inside the sticker folder; images load once and are cached.
 */
export class StickerLibrary {
	private readonly images = new Map<string, HTMLImageElement>();
	private readonly emitter = new Emitter<{ changed: null }>();

	constructor(
		private readonly app: App,
		private readonly folder: () => string,
	) {}

	/** Images in the sticker folder, for the palette. */
	custom(): CustomSticker[] {
		const folder = this.folder();
		const prefix = folder ? `${folder.replace(/\/+$/, "")}/` : "";
		return this.app.vault
			.getFiles()
			.filter((f) => isImageExtension(f.extension) && f.path.startsWith(prefix))
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((f) => ({ id: f.path, label: f.basename, url: this.app.vault.getResourcePath(f) }));
	}

	readonly resolve: StickerResolver = (node): ResolvedSticker => {
		const icon = node.icon;
		if (icon && !findSticker(icon) && !looksLikeEmoji(icon)) {
			const file = this.lookup(icon);
			const image = file ? this.imageFor(file) : null;
			if (image) return { image };
		}
		return resolveBuiltin(icon, node.type);
	};

	/** Call when sticker files were added, removed or the folder setting changed. */
	changed(): void {
		this.emitter.emit("changed", null);
	}

	onChanged(fn: () => void): Unsubscribe {
		return this.emitter.on("changed", fn);
	}

	private lookup(icon: string): TFile | null {
		const direct = this.app.vault.getAbstractFileByPath(icon);
		if (direct instanceof TFile && isImageExtension(direct.extension)) return direct;
		const folder = this.folder();
		const inFolder = this.app.vault.getAbstractFileByPath(folder ? `${folder}/${icon}` : icon);
		return inFolder instanceof TFile && isImageExtension(inFolder.extension) ? inFolder : null;
	}

	/** The loaded image, or null while it is still loading (the map redraws when it arrives). */
	private imageFor(file: TFile): HTMLImageElement | null {
		let image = this.images.get(file.path);
		if (!image) {
			image = new Image();
			image.onload = () => this.changed();
			image.src = this.app.vault.getResourcePath(file);
			this.images.set(file.path, image);
		}
		return image.complete && image.naturalWidth > 0 ? image : null;
	}
}
