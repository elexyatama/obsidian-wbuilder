import type { Vec2 } from "../../core/camera";
import { LABEL_SIZES, type LabelSize } from "../../core/mapFile";
import { h } from "./dom";

export interface LabelEditorHandlers {
	/** Called on every keystroke, so the label can be previewed on the map while typing. */
	onText(text: string): void;
	onSize(size: LabelSize): void;
	/** Enter or the Done button. */
	onDone(): void;
	/** Escape. */
	onCancel(): void;
	onDelete(): void;
}

const SIZE_TITLES: Record<LabelSize, string> = { s: "Small", m: "Medium", l: "Large", xl: "Extra large" };

/**
 * Small box that appears on the map next to a label while you type it: the text, four sizes,
 * delete and done. Enter finishes, Escape cancels.
 */
export class LabelEditor {
	readonly el: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly sizeButtons = new Map<LabelSize, HTMLButtonElement>();
	private handlers: LabelEditorHandlers | null = null;

	constructor(parent: HTMLElement) {
		this.el = h("div", { class: "wb-label-editor" });
		this.el.hidden = true;
		parent.append(this.el);

		this.input = h("input", { type: "text", placeholder: "Name this place", maxlength: "120" });
		this.input.addEventListener("input", () => this.handlers?.onText(this.input.value));
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.handlers?.onDone();
			} else if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				this.handlers?.onCancel();
			}
		});

		const sizes = h("div", { class: "wb-row" });
		for (const size of LABEL_SIZES) {
			const button = h("button", { text: size.toUpperCase(), title: SIZE_TITLES[size] });
			// keep the keyboard focus in the text box when a size is picked
			button.addEventListener("mousedown", (e) => e.preventDefault());
			button.addEventListener("click", () => this.handlers?.onSize(size));
			this.sizeButtons.set(size, button);
			sizes.append(button);
		}
		const remove = h("button", { text: "Delete", title: "Remove this label" });
		remove.addEventListener("click", () => this.handlers?.onDelete());
		const done = h("button", { text: "Done", class: "mod-cta", title: "Enter" });
		done.addEventListener("click", () => this.handlers?.onDone());
		this.el.append(this.input, h("div", { class: "wb-row" }, [sizes, remove, done]));

		// clicks inside the box must not reach the map underneath
		for (const type of ["pointerdown", "wheel", "contextmenu"] as const) this.el.addEventListener(type, (e) => e.stopPropagation());
	}

	get isOpen(): boolean {
		return !this.el.hidden;
	}

	open(init: { text: string; size: LabelSize; anchor: Vec2; bounds: { width: number; height: number } }, handlers: LabelEditorHandlers): void {
		this.handlers = handlers;
		this.input.value = init.text;
		this.setSize(init.size);
		this.el.hidden = false;
		this.moveTo(init.anchor, init.bounds);
		this.input.focus();
		this.input.select();
	}

	setSize(size: LabelSize): void {
		for (const [s, button] of this.sizeButtons) button.classList.toggle("mod-cta", s === size);
	}

	/** Keeps the box just below the label, inside the map area. */
	moveTo(anchor: Vec2, bounds: { width: number; height: number }): void {
		const width = this.el.offsetWidth;
		const height = this.el.offsetHeight;
		const left = Math.min(Math.max(8, anchor.x - width / 2), Math.max(8, bounds.width - width - 8));
		const top = Math.min(Math.max(8, anchor.y + 22), Math.max(8, bounds.height - height - 8));
		this.el.style.left = `${left}px`;
		this.el.style.top = `${top}px`;
	}

	close(): void {
		this.handlers = null;
		this.el.hidden = true;
	}
}
