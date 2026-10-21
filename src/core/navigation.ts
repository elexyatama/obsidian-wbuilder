import { Emitter } from "./emitter";

/**
 * Fire-and-forget intents between the editor side and the map side.
 * These carry no state; durable state lives in LocationIndex.
 */
export interface NavigationEvents {
	/** Center the map on a tile (e.g. from "reveal note on map" or a coordinate link). */
	"focus-tile": { map: string; x: number; y: number };
	/** Open or focus a note in the editor (e.g. from clicking a pin). */
	"open-note": { path: string };
	/** Something the tracker depends on changed outside the index (a setting, or links resolving differently). */
	"tracking-changed": null;
}

export type NavigationBus = Emitter<NavigationEvents>;

export function createNavigationBus(): NavigationBus {
	return new Emitter<NavigationEvents>();
}
