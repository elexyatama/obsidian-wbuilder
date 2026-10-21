import { BRUSH_MODES, MAX_BRUSH_RADIUS, MIN_BRUSH_RADIUS, type Brush, type BrushMode } from "../../core/brush";
import { NODE_TYPES } from "../../core/nodeTypes";
import { h } from "./dom";

export type Tool = "select" | "place" | "brush";

const TOOLS: readonly { id: Tool; label: string; hint: string }[] = [
	{ id: "select", label: "Select", hint: "Pan the map and open notes. Right-click to create a note." },
	{ id: "place", label: "Place", hint: "Click the map to create a note there. Pick a sticker to choose its icon." },
	{ id: "brush", label: "Brush", hint: "Paint water, land and elevation. Shift or middle mouse pans. Ctrl+Z undoes." },
];

export interface ToolbarModel {
	tool: Tool;
	charactersOpen: boolean;
	nodeType: string;
	brush: Brush;
	canUndo: boolean;
	canRedo: boolean;
}

export interface ToolbarActions {
	setTool(tool: Tool): void;
	/** Show or hide the characters panel (the tracker). */
	toggleCharacters(): void;
	setNodeType(id: string): void;
	setBrush(patch: Partial<Brush>): void;
	undo(): void;
	redo(): void;
}

/**
 * Tool picker with per-tool options. Built once; `update` only flips states and values,
 * so a slider keeps working while it is being dragged.
 */
export class Toolbar {
	readonly el: HTMLElement;
	private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
	private readonly modeButtons = new Map<BrushMode, HTMLButtonElement>();
	private readonly placeRow: HTMLElement;
	private readonly brushRow: HTMLElement;
	private readonly typeSelect: HTMLSelectElement;
	private readonly radius: HTMLInputElement;
	private readonly radiusLabel: HTMLElement;
	private readonly strength: HTMLInputElement;
	private readonly strengthLabel: HTMLElement;
	private readonly strengthWrap: HTMLElement;
	private readonly undoButton: HTMLButtonElement;
	private readonly redoButton: HTMLButtonElement;
	private readonly charactersButton: HTMLButtonElement;

	constructor(parent: HTMLElement, actions: ToolbarActions) {
		this.el = h("div", { class: "wb-toolbar" });
		parent.append(this.el);

		const toolRow = h("div", { class: "wb-row" });
		for (const tool of TOOLS) {
			const button = h("button", { text: tool.label, title: tool.hint });
			button.addEventListener("click", () => actions.setTool(tool.id));
			this.toolButtons.set(tool.id, button);
			toolRow.append(button);
		}
		this.charactersButton = h("button", {
			text: "Characters",
			title: "Follow characters through time: pick who to track, see where they are each year",
		});
		this.charactersButton.addEventListener("click", () => actions.toggleCharacters());
		toolRow.append(this.charactersButton);
		this.undoButton = h("button", { text: "Undo", title: "Undo the last brush stroke (Ctrl+Z)" });
		this.redoButton = h("button", { text: "Redo", title: "Redo (Ctrl+Shift+Z)" });
		this.undoButton.addEventListener("click", () => actions.undo());
		this.redoButton.addEventListener("click", () => actions.redo());
		toolRow.append(this.undoButton, this.redoButton);

		this.placeRow = h("div", { class: "wb-row" });
		this.typeSelect = h("select", { title: "Type of note to create" });
		for (const type of NODE_TYPES) this.typeSelect.append(h("option", { value: type.id, text: type.label }));
		this.typeSelect.addEventListener("change", () => actions.setNodeType(this.typeSelect.value));
		this.placeRow.append(h("span", { class: "wb-label", text: "New:" }), this.typeSelect);

		this.brushRow = h("div", { class: "wb-row" });
		const modes = h("div", { class: "wb-row" });
		for (const mode of BRUSH_MODES) {
			const button = h("button", { text: mode.label, title: mode.hint });
			button.addEventListener("click", () => actions.setBrush({ mode: mode.id }));
			this.modeButtons.set(mode.id, button);
			modes.append(button);
		}
		this.radiusLabel = h("span", { class: "wb-label" });
		this.radius = h("input", {
			type: "range",
			min: String(MIN_BRUSH_RADIUS),
			max: String(MAX_BRUSH_RADIUS),
			step: "1",
			title: "Brush size in tiles",
		});
		this.radius.addEventListener("input", () => actions.setBrush({ radius: Number(this.radius.value) }));
		this.strengthLabel = h("span", { class: "wb-label" });
		this.strength = h("input", { type: "range", min: "0.1", max: "1", step: "0.1", title: "How fast Raise and Lower change elevation" });
		this.strength.addEventListener("input", () => actions.setBrush({ strength: Number(this.strength.value) }));
		this.strengthWrap = h("div", { class: "wb-row" }, [this.strengthLabel, this.strength]);
		this.brushRow.append(modes, h("div", { class: "wb-row" }, [this.radiusLabel, this.radius]), this.strengthWrap);

		this.el.append(toolRow, this.placeRow, this.brushRow);
	}

	update(model: ToolbarModel): void {
		for (const [tool, button] of this.toolButtons) button.classList.toggle("mod-cta", tool === model.tool);
		this.charactersButton.classList.toggle("mod-cta", model.charactersOpen);
		this.placeRow.hidden = model.tool !== "place";
		this.brushRow.hidden = model.tool !== "brush";
		this.undoButton.hidden = this.redoButton.hidden = model.tool !== "brush";
		this.undoButton.disabled = !model.canUndo;
		this.redoButton.disabled = !model.canRedo;

		if (this.typeSelect.value !== model.nodeType) this.typeSelect.value = model.nodeType;
		for (const [mode, button] of this.modeButtons) button.classList.toggle("mod-cta", mode === model.brush.mode);
		this.radiusLabel.textContent = `Size ${model.brush.radius}`;
		if (this.radius.value !== String(model.brush.radius)) this.radius.value = String(model.brush.radius);
		const gradual = model.brush.mode === "raise" || model.brush.mode === "lower";
		this.strengthWrap.hidden = !gradual;
		this.strengthLabel.textContent = `Strength ${model.brush.strength.toFixed(1)}`;
		if (Number(this.strength.value) !== model.brush.strength) this.strength.value = String(model.brush.strength);
	}
}
