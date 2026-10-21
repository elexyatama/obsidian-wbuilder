export type Unsubscribe = () => void;

/** Minimal typed pub/sub. Works the same in a browser, Obsidian or Node. */
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
	private handlers: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

	on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): Unsubscribe {
		const set = this.handlers[event] ?? new Set();
		this.handlers[event] = set;
		set.add(fn);
		return () => {
			set.delete(fn);
		};
	}

	emit<K extends keyof Events>(event: K, payload: Events[K]): void {
		const set = this.handlers[event];
		if (!set) return;
		// copy so a handler may unsubscribe while we iterate
		for (const fn of [...set]) fn(payload);
	}
}
