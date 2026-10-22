import type { FamilyGraph, FamilyPerson } from "../core/family";
import type { LayoutNode, TreeLayout } from "../core/treeLayout";

export interface TreeCallbacks {
	/** Click on a person. */
	onOpen(person: FamilyPerson): void;
	/** Shift/Ctrl/Cmd+click: make this person the center of the tree. */
	onRefocus(person: FamilyPerson): void;
}

export interface TreeRenderOptions {
	focusId?: string;
	/** True for people to fade out (e.g. not alive in the timeline's current year). */
	dimmed?: (person: FamilyPerson) => boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CLICK_SLOP_PX = 4;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
	parent?.append(el);
	return el;
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function lifespan(person: FamilyPerson): string {
	const { start, end } = person;
	if (start !== undefined && end !== undefined) return `${start} – ${end}`;
	if (start !== undefined) return `b. ${start}`;
	if (end !== undefined) return `d. ${end}`;
	return "";
}

/** SVG family tree with drag-to-pan and wheel zoom. Styling comes from CSS classes (wb-tree-*). */
export class FamilyTreeRenderer {
	private readonly root: SVGSVGElement;
	private readonly viewport: SVGGElement;
	private view = { x: 0, y: 0, k: 1 };
	private contentSize = { width: 0, height: 0 };
	private drag: { id: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null = null;
	/** True just after a pan drag ends, so the click that follows it is ignored. */
	private justDragged = false;
	private readonly disposers: Array<() => void> = [];

	constructor(
		private readonly container: HTMLElement,
		private readonly callbacks: TreeCallbacks,
	) {
		this.root = svg("svg", { class: "wb-tree" });
		this.viewport = svg("g", {}, this.root);
		container.append(this.root);

		const on = <K extends keyof SVGElementEventMap>(type: K, fn: (e: SVGElementEventMap[K]) => void, options?: AddEventListenerOptions) => {
			this.root.addEventListener(type, fn, options);
			this.disposers.push(() => this.root.removeEventListener(type, fn, options));
		};
		on("pointerdown", (e) => {
			if (e.button !== 0) return;
			this.drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
		});
		on("pointermove", (e) => {
			const d = this.drag;
			if (!d || d.id !== e.pointerId) return;
			if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > CLICK_SLOP_PX) {
				d.moved = true;
				// Capture only once it is really a drag: capturing on pointerdown would send the
				// following click to the SVG root instead of the node that was clicked.
				this.root.setPointerCapture(e.pointerId);
			}
			this.view.x += e.clientX - d.lastX;
			this.view.y += e.clientY - d.lastY;
			d.lastX = e.clientX;
			d.lastY = e.clientY;
			this.applyView();
		});
		const end = (e: PointerEvent) => {
			const d = this.drag;
			if (d?.id !== e.pointerId) return;
			if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
			this.drag = null;
			// the click event fires right after pointerup, so remember the drag until then
			this.justDragged = d.moved;
			window.setTimeout(() => (this.justDragged = false), 0);
		};
		on("pointerup", end);
		on("pointercancel", end);
		on(
			"wheel",
			(e) => {
				e.preventDefault();
				const rect = this.root.getBoundingClientRect();
				this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
			},
			{ passive: false },
		);
	}

	render(layout: TreeLayout, graph: FamilyGraph, options: TreeRenderOptions = {}, refit = false): void {
		this.viewport.replaceChildren();
		this.contentSize = { width: layout.width, height: layout.height };
		const byId = new Map(layout.nodes.map((n) => [n.id, n]));

		const edges = svg("g", { class: "wb-tree-edges" }, this.viewport);
		for (const edge of layout.edges) {
			const a = byId.get(edge.from);
			const b = byId.get(edge.to);
			if (!a || !b) continue;
			const y1 = a.y + a.h / 2;
			const y2 = b.y - b.h / 2;
			const mid = (y1 + y2) / 2;
			svg("path", { class: "wb-tree-edge", d: `M ${a.x} ${y1} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${y2}` }, edges);
		}

		for (const node of layout.nodes) {
			if (node.kind === "union") {
				svg("circle", { class: "wb-tree-union", cx: node.x, cy: node.y, r: node.w / 2 }, this.viewport);
				continue;
			}
			const person = graph.people.get(node.id);
			if (person) this.drawPerson(node, person, options);
		}

		if (refit) this.fit();
		else this.applyView();
	}

	/** Scale and center the whole tree in the container. */
	fit(): void {
		const { width, height } = this.contentSize;
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		if (width === 0 || height === 0 || w === 0 || h === 0) {
			this.view = { x: 0, y: 0, k: 1 };
		} else {
			const k = Math.min(1.2, w / width, h / height);
			this.view = { k, x: (w - width * k) / 2, y: (h - height * k) / 2 };
		}
		this.applyView();
	}

	destroy(): void {
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		this.root.remove();
	}

	private drawPerson(node: LayoutNode, person: FamilyPerson, options: TreeRenderOptions): void {
		const classes = ["wb-tree-node"];
		if (person.id === options.focusId) classes.push("is-focus");
		if (!person.path) classes.push("is-unresolved");
		if (options.dimmed?.(person)) classes.push("is-dimmed");
		const g = svg("g", { class: classes.join(" "), transform: `translate(${node.x - node.w / 2} ${node.y - node.h / 2})` }, this.viewport);
		svg("title", {}, g).textContent = person.path ? person.name : `${person.name} (no note yet, click to create)`;
		svg("rect", { width: node.w, height: node.h, rx: 8 }, g);
		const years = lifespan(person);
		svg("text", { class: "wb-tree-name", x: node.w / 2, y: years ? 19 : 28, "text-anchor": "middle" }, g).textContent = truncate(person.name, 20);
		if (years) svg("text", { class: "wb-tree-years", x: node.w / 2, y: 35, "text-anchor": "middle" }, g).textContent = years;
		g.addEventListener("click", (e) => {
			if (this.justDragged) return;
			if (e.shiftKey || e.ctrlKey || e.metaKey) this.callbacks.onRefocus(person);
			else this.callbacks.onOpen(person);
		});
	}

	private zoomAt(sx: number, sy: number, factor: number): void {
		const k = Math.min(3, Math.max(0.2, this.view.k * factor));
		const real = k / this.view.k;
		this.view.x = sx - (sx - this.view.x) * real;
		this.view.y = sy - (sy - this.view.y) * real;
		this.view.k = k;
		this.applyView();
	}

	private applyView(): void {
		const { x, y, k } = this.view;
		this.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
	}
}
