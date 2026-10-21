import type { Timeline, YearRange } from "../../core/timeline";
import { h } from "./dom";

/**
 * Slider over the world's history. While it is on, only notes whose start/end period
 * covers the chosen year are shown; notes without a period are always shown.
 */
export class TimelineBar {
	readonly el: HTMLElement;
	private readonly toggle: HTMLInputElement;
	private readonly slider: HTMLInputElement;
	private readonly year: HTMLInputElement;
	private readonly note: HTMLElement;
	private range: YearRange | null = null;
	private readonly off: () => void;

	constructor(
		parent: HTMLElement,
		private readonly timeline: Timeline,
	) {
		this.el = h("div", { class: "wb-timeline" });
		parent.append(this.el);

		this.toggle = h("input", { type: "checkbox" });
		this.slider = h("input", { type: "range", step: "1", title: "Drag to change the year" });
		this.year = h("input", { type: "number", step: "1", title: "Year" });
		this.note = h("span", { class: "wb-hint" });
		const label = h("label", { class: "wb-timeline-toggle", title: "Show the world as it was in a given year" }, [this.toggle, " Timeline"]);
		this.el.append(label, this.slider, this.year, this.note);

		this.toggle.addEventListener("change", () => {
			const state = timeline.state;
			const outside = this.range !== null && (state.year < this.range.min || state.year > this.range.max);
			timeline.set({ enabled: this.toggle.checked, year: outside && this.range ? this.range.min : state.year });
		});
		this.slider.addEventListener("input", () => timeline.set({ year: Number(this.slider.value) }));
		this.year.addEventListener("change", () => {
			const value = Number(this.year.value);
			if (Number.isFinite(value)) timeline.set({ year: Math.round(value) });
		});
		this.off = timeline.on("changed", () => this.sync());
		this.sync();
	}

	/** Slider bounds, derived from the periods of all notes. Null disables the timeline. */
	setRange(range: YearRange | null): void {
		this.range = range;
		if (range) {
			this.slider.min = String(range.min);
			this.slider.max = String(range.max);
		}
		this.sync();
	}

	/** Short text after the controls, such as "3 of 12 on map". */
	setSummary(text: string): void {
		this.note.textContent = this.range ? text : "Give notes a start and end year to use the timeline.";
	}

	destroy(): void {
		this.off();
	}

	private sync(): void {
		const { enabled, year } = this.timeline.state;
		const usable = this.range !== null;
		this.toggle.checked = enabled && usable;
		this.toggle.disabled = !usable;
		this.slider.disabled = this.year.disabled = !usable || !enabled;
		if (this.slider.value !== String(year)) this.slider.value = String(year);
		if (document.activeElement !== this.year && this.year.value !== String(year)) this.year.value = String(year);
	}
}
