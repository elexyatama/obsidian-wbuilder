import type { TrackerRow } from "../../core/tracking";
import { h } from "./dom";

export interface TrackerPanelActions {
	toggle(path: string, selected: boolean): void;
	setShowPaths(show: boolean): void;
	showTree(path: string): void;
	goTo(path: string): void;
}

export interface TrackerPanelModel {
	rows: readonly TrackerRow[];
	showPaths: boolean;
}

interface RowParts {
	el: HTMLElement;
	check: HTMLInputElement;
	swatch: HTMLElement;
	name: HTMLElement;
	status: HTMLElement;
	go: HTMLButtonElement;
}

/**
 * Character picker for the tracker. Tick characters to follow them as the timeline moves;
 * each shows where they are in the current year. Rows are updated in place so a drag on the
 * timeline doesn't rebuild the list.
 */
export class TrackerPanel {
	readonly el: HTMLElement;
	private readonly filter: HTMLInputElement;
	private readonly paths: HTMLInputElement;
	private readonly list: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly rows = new Map<string, RowParts>();
	private order = "";
	private model: TrackerPanelModel = { rows: [], showPaths: false };

	constructor(
		parent: HTMLElement,
		private readonly actions: TrackerPanelActions,
	) {
		this.el = h("div", { class: "wb-characters" });
		parent.append(this.el);

		this.filter = h("input", { type: "search", placeholder: "Find a character", class: "wb-char-filter" });
		this.filter.addEventListener("input", () => this.applyFilter());
		this.paths = h("input", { type: "checkbox" });
		this.paths.addEventListener("change", () => actions.setShowPaths(this.paths.checked));
		const pathsLabel = h("label", { class: "wb-timeline-toggle", title: "Draw the route each tracked character takes while alive" }, [this.paths, " Show paths"]);
		this.list = h("div", { class: "wb-char-list" });
		this.empty = h("div", { class: "wb-hint", text: "No characters yet. Give a note type: character." });
		this.el.append(h("div", { class: "wb-row" }, [this.filter, pathsLabel]), this.list, this.empty);
	}

	setVisible(visible: boolean): void {
		this.el.hidden = !visible;
	}

	update(model: TrackerPanelModel): void {
		this.model = model;
		if (this.paths.checked !== model.showPaths) this.paths.checked = model.showPaths;

		const seen = new Set<string>();
		for (const row of model.rows) {
			seen.add(row.path);
			const parts = this.rows.get(row.path) ?? this.makeRow(row.path);
			parts.check.checked = row.selected;
			parts.name.textContent = row.name;
			parts.swatch.style.background = row.color ?? "transparent";
			parts.swatch.hidden = !row.selected;
			parts.status.textContent = row.status + (row.warnings.length > 0 ? " ⚠" : "");
			parts.status.title = row.warnings.join("\n");
			parts.status.hidden = row.status === "" && row.warnings.length === 0;
			parts.go.disabled = !row.at;
			parts.el.classList.toggle("is-selected", row.selected);
		}
		for (const [path, parts] of this.rows) {
			if (!seen.has(path)) {
				parts.el.remove();
				this.rows.delete(path);
			}
		}

		const order = model.rows.map((r) => r.path).join("\n");
		if (order !== this.order) {
			this.order = order;
			for (const row of model.rows) this.list.append((this.rows.get(row.path) as RowParts).el);
		}
		this.empty.hidden = model.rows.length > 0;
		this.applyFilter();
	}

	private applyFilter(): void {
		const query = this.filter.value.trim().toLowerCase();
		const selected = new Set(this.model.rows.filter((r) => r.selected).map((r) => r.path));
		for (const row of this.model.rows) {
			const parts = this.rows.get(row.path);
			if (parts) parts.el.hidden = query !== "" && !selected.has(row.path) && !row.name.toLowerCase().includes(query);
		}
	}

	private makeRow(path: string): RowParts {
		const check = h("input", { type: "checkbox" });
		check.addEventListener("change", () => this.actions.toggle(path, check.checked));
		const swatch = h("span", { class: "wb-swatch" });
		const name = h("span", { class: "wb-char-name" });
		const label = h("label", { class: "wb-char-label" }, [check, swatch, name]);
		const status = h("div", { class: "wb-char-status" });
		const go = h("button", { text: "Go", title: "Center the map on them", class: "wb-mini" });
		go.addEventListener("click", () => this.actions.goTo(path));
		const tree = h("button", { text: "Tree", title: "Show their family tree", class: "wb-mini" });
		tree.addEventListener("click", () => this.actions.showTree(path));
		const el = h("div", { class: "wb-char" }, [h("div", { class: "wb-char-top" }, [label, go, tree]), status]);
		const parts: RowParts = { el, check, swatch, name, status, go };
		this.rows.set(path, parts);
		return parts;
	}
}
