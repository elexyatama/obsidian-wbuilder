import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { FAMILY_MODES, buildFamilyGraph, extractFamily, type FamilyMode, type FamilyPerson } from "../../core/family";
import { isActiveAt } from "../../core/timeline";
import { layoutFamily } from "../../core/treeLayout";
import { FamilyTreeRenderer } from "../../render/FamilyTreeRenderer";
import { VIEW_TYPE_FAMILY } from "./constants";
import type { WorldContext } from "./world";

/** Family tree of one character: parents above, children below, couples joined by a dot. */
export class FamilyTreeView extends ItemView {
	private renderer: FamilyTreeRenderer | null = null;
	private message: HTMLElement | null = null;
	private focusPath: string | null = null;
	private mode: FamilyMode = "family";
	private refreshTimer = 0;
	private refitNext = true;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly world: WorldContext,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_FAMILY;
	}

	getDisplayText(): string {
		const name = this.focusPath ? this.world.index.get(this.focusPath)?.name : undefined;
		return name ? `Family tree: ${name}` : "Family tree";
	}

	override getIcon(): string {
		return "network";
	}

	override getState(): Record<string, unknown> {
		return { focus: this.focusPath, mode: this.mode };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as { focus?: string; mode?: FamilyMode };
		if (typeof s.focus === "string") this.focusPath = s.focus;
		if (FAMILY_MODES.some((m) => m.id === s.mode)) this.mode = s.mode as FamilyMode;
		this.refitNext = true;
		this.refresh();
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		const { contentEl, world } = this;
		contentEl.empty();
		contentEl.addClass("wb-family");

		const bar = contentEl.createDiv({ cls: "wb-family-bar" });
		const select = bar.createEl("select");
		for (const mode of FAMILY_MODES) select.createEl("option", { value: mode.id, text: mode.label });
		select.value = this.mode;
		select.addEventListener("change", () => {
			this.mode = select.value as FamilyMode;
			this.refitNext = true;
			this.refresh();
		});
		bar.createEl("button", { text: "Fit" }).addEventListener("click", () => this.renderer?.fit());
		bar.createSpan({ cls: "wb-hint", text: "Click a person to open their note. Shift+click to center the tree on them." });

		const stage = contentEl.createDiv({ cls: "wb-family-stage" });
		this.message = stage.createDiv({ cls: "wb-family-message" });
		this.renderer = new FamilyTreeRenderer(stage, {
			onOpen: (person) => this.open(person),
			onRefocus: (person) => {
				if (!person.path) return;
				this.focusPath = person.path;
				this.refitNext = true;
				this.refresh();
			},
		});

		const refresh = () => this.scheduleRefresh();
		this.register(world.index.on("changed", refresh));
		this.register(world.timeline.on("changed", refresh));
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.refresh();
	}

	override async onClose(): Promise<void> {
		window.clearTimeout(this.refreshTimer);
		this.renderer?.destroy();
		this.renderer = null;
	}

	private scheduleRefresh(): void {
		window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => this.refresh(), 120);
	}

	private open(person: FamilyPerson): void {
		if (person.path) {
			this.world.bus.emit("open-note", { path: person.path });
			return;
		}
		// a parent that is named but has no note yet: create it, like clicking an unresolved link
		void this.world.createNote({ name: person.name, type: "character" }).then((file) => {
			if (file) this.world.bus.emit("open-note", { path: file.path });
		});
	}

	private refresh(): void {
		try {
			this.draw();
		} catch (error) {
			// show what went wrong instead of leaving a blank view
			console.error("WBuilder: family tree failed to draw", error);
			this.showMessage(`The family tree could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private draw(): void {
		const { renderer } = this;
		if (!renderer) return;
		const { index, timeline } = this.world;
		const graph = buildFamilyGraph(index.all(), (target, from) => this.app.metadataCache.getFirstLinkpathDest(target, from)?.path ?? null);

		const ids = this.focusPath ? extractFamily(graph, this.focusPath, this.mode) : new Set<string>();
		if (ids.size === 0) {
			renderer.render({ nodes: [], edges: [], width: 0, height: 0 }, graph);
			const issues = this.focusPath ? index.issuesFor(this.focusPath) : [];
			this.showMessage(
				!this.focusPath
					? "Open a character note and run “Show family tree of active note”."
					: issues.length > 0
						? `Can't read this note's properties: ${issues.join("; ")}`
						: "This note isn't a character with family links yet. Set type: character and add parents.",
			);
			return;
		}
		this.showMessage("");

		const { enabled, year } = timeline.state;
		renderer.render(
			layoutFamily(graph, ids),
			graph,
			{ focusId: this.focusPath ?? undefined, dimmed: (p) => enabled && !isActiveAt(p, year) },
			this.refitNext,
		);
		this.refitNext = false;
	}

	private showMessage(text: string): void {
		if (!this.message) return;
		this.message.textContent = text;
		this.message.hidden = text === "";
	}
}
