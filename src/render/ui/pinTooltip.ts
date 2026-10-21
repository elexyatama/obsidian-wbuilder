import type { Vec2 } from "../../core/camera";
import { baseName, linkTarget } from "../../core/links";
import { getNodeType } from "../../core/nodeTypes";
import { describePeriod } from "../../core/timeline";
import type { Pin } from "../../core/types";
import { h } from "./dom";

const MAX_ITEMS = 3;

/**
 * Card shown while hovering a pin: the name, type and years, the node's overview, and the
 * affiliations it belongs to. When several notes share a tile it lists each of them.
 */
export class PinTooltip {
	readonly el: HTMLElement;

	constructor(parent: HTMLElement) {
		this.el = h("div", { class: "wb-tip" });
		this.el.hidden = true;
		parent.append(this.el);
	}

	/** Shows the card beside `anchor` (canvas pixels), flipping or sliding so it stays inside `bounds`. */
	show(pins: readonly Pin[], anchor: Vec2, bounds: { width: number; height: number }): void {
		this.el.replaceChildren(...pins.slice(0, MAX_ITEMS).map((pin) => this.item(pin)));
		if (pins.length > MAX_ITEMS) this.el.append(h("div", { class: "wb-tip-more", text: `+${pins.length - MAX_ITEMS} more` }));
		this.el.hidden = false;

		const width = this.el.offsetWidth;
		const height = this.el.offsetHeight;
		let left = anchor.x + 18;
		if (left + width > bounds.width - 8) left = anchor.x - width - 18;
		const top = Math.min(Math.max(8, anchor.y - 14), Math.max(8, bounds.height - height - 8));
		this.el.style.left = `${Math.max(8, left)}px`;
		this.el.style.top = `${top}px`;
	}

	hide(): void {
		this.el.hidden = true;
	}

	private item(pin: Pin): HTMLElement {
		const type = getNodeType(pin.type);
		const dot = h("span", { class: "wb-tip-dot" });
		dot.style.background = type.color;
		const detail = [type.label, describePeriod(pin)].filter(Boolean).join(" · ");
		const item = h("div", { class: "wb-tip-item" }, [
			h("div", { class: "wb-tip-title" }, [dot, h("span", { class: "wb-tip-name", text: pin.name }), h("span", { class: "wb-tip-type", text: detail })]),
		]);
		if (pin.overview) item.append(h("div", { class: "wb-tip-overview", text: pin.overview }));
		if (pin.affiliations.length > 0) {
			const names = pin.affiliations.map((link) => baseName(linkTarget(link))).join(", ");
			item.append(h("div", { class: "wb-tip-meta", text: `Affiliation: ${names}` }));
		}
		return item;
	}
}
