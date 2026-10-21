import { BUILTIN_STICKERS } from "../../core/stickers";
import { STICKER_DRAG_PREFIX } from "../MapRenderer";
import { drawSticker, resolveBuiltin } from "../stickerPainter";
import { h } from "./dom";

/** An image sticker supplied by the host (for example a PNG in the vault's sticker folder). */
export interface CustomSticker {
	id: string;
	label: string;
	url: string;
}

const CELL = 30;

/**
 * Grid of stickers. Click one to use it for the next note you place, or drag it onto the
 * map to create a note on that tile.
 */
export class StickerPalette {
	readonly el: HTMLElement;
	private readonly cells = new Map<string, HTMLButtonElement>();
	private readonly customBox: HTMLElement;
	private selected: string | null = null;

	constructor(
		parent: HTMLElement,
		private readonly onSelect: (id: string | null) => void,
	) {
		this.el = h("div", { class: "wb-palette" });
		parent.append(this.el);

		const builtin = h("div", { class: "wb-sticker-grid" });
		for (const sticker of BUILTIN_STICKERS) {
			const canvas = h("canvas", { width: String(CELL * 2), height: String(CELL * 2) });
			canvas.style.width = `${CELL}px`;
			canvas.style.height = `${CELL}px`;
			const ctx = canvas.getContext("2d");
			if (ctx) drawSticker(ctx, resolveBuiltin(sticker.id, "place"), CELL, CELL, CELL * 1.7);
			builtin.append(this.makeCell(sticker.id, sticker.label, canvas));
		}
		this.customBox = h("div", { class: "wb-sticker-grid" });
		this.el.append(builtin, h("div", { class: "wb-label", text: "Your stickers" }), this.customBox);
		this.setCustom([]);
	}

	setVisible(visible: boolean): void {
		this.el.hidden = !visible;
	}

	setSelected(id: string | null): void {
		this.selected = id;
		for (const [cellId, button] of this.cells) button.classList.toggle("mod-cta", cellId === id);
	}

	setCustom(stickers: readonly CustomSticker[]): void {
		for (const [id, button] of this.cells) {
			if (button.dataset.custom) {
				button.remove();
				this.cells.delete(id);
			}
		}
		this.customBox.replaceChildren();
		if (stickers.length === 0) {
			this.customBox.append(h("div", { class: "wb-hint", text: "Add PNG, SVG or WebP files to your sticker folder." }));
		}
		for (const sticker of stickers) {
			const img = h("img", { src: sticker.url, alt: sticker.label, draggable: "false" });
			const cell = this.makeCell(sticker.id, sticker.label, img);
			cell.dataset.custom = "1";
			this.customBox.append(cell);
		}
		this.setSelected(this.selected);
	}

	private makeCell(id: string, label: string, content: HTMLElement): HTMLButtonElement {
		const button = h("button", { class: "wb-sticker", title: label, draggable: "true" }, [content]);
		button.addEventListener("click", () => {
			const next = this.selected === id ? null : id;
			this.setSelected(next);
			this.onSelect(next);
		});
		button.addEventListener("dragstart", (e) => {
			e.dataTransfer?.setData("text/plain", STICKER_DRAG_PREFIX + id);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
		});
		this.cells.set(id, button);
		return button;
	}
}
