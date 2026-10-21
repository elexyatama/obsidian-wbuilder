import { Emitter, type Unsubscribe } from "./emitter";

/** When something exists. A missing bound means unbounded on that side. */
export interface Period {
	start?: number;
	end?: number;
}

export function isActiveAt(period: Period, year: number): boolean {
	return (period.start === undefined || period.start <= year) && (period.end === undefined || year <= period.end);
}

export interface YearRange {
	min: number;
	max: number;
}

/** Slider bounds that cover every finite start/end, with a little padding. Null if there are none. */
export function periodRange(periods: Iterable<Period>): YearRange | null {
	let min = Infinity;
	let max = -Infinity;
	for (const p of periods) {
		for (const year of [p.start, p.end]) {
			if (year === undefined) continue;
			min = Math.min(min, year);
			max = Math.max(max, year);
		}
	}
	if (min === Infinity) return null;
	if (min === max) {
		min -= 10;
		max += 10;
	}
	const pad = Math.max(1, Math.round((max - min) * 0.05));
	return { min: Math.floor(min - pad), max: Math.ceil(max + pad) };
}

export interface TimelineState {
	/** When off, everything is shown regardless of its period. */
	enabled: boolean;
	year: number;
}

/** The current moment in the world's history, shared by the map and the family tree. */
export class Timeline {
	private current: TimelineState = { enabled: false, year: 0 };
	private emitter = new Emitter<{ changed: TimelineState }>();

	get state(): Readonly<TimelineState> {
		return this.current;
	}

	set(patch: Partial<TimelineState>): void {
		const next = { ...this.current, ...patch };
		if (next.enabled === this.current.enabled && next.year === this.current.year) return;
		this.current = next;
		this.emitter.emit("changed", next);
	}

	on(event: "changed", fn: (state: TimelineState) => void): Unsubscribe {
		return this.emitter.on(event, fn);
	}

	/** True if the node should be shown right now. */
	shows(period: Period): boolean {
		return !this.current.enabled || isActiveAt(period, this.current.year);
	}
}
