import type { TFile } from "obsidian";
import type { NavigationBus } from "../../core/navigation";
import type { NewNodeSpec } from "../../core/nodeTemplate";
import type { NodeIndex } from "../../core/nodeIndex";
import type { Timeline } from "../../core/timeline";
import type { CreateNodeRequest } from "../../render/MapScreen";
import type { StickerLibrary } from "./stickerLibrary";

/** What the plugin shares with every map and family-tree tab. */
export interface WorldContext {
	index: NodeIndex;
	timeline: Timeline;
	bus: NavigationBus;
	stickers: StickerLibrary;
	/** Ask the user about a note to place on a map, then create it. */
	requestCreateNode(request: CreateNodeRequest): void;
	/** Create a note straight away (no dialog). Null if it could not be created. */
	createNote(spec: NewNodeSpec): Promise<TFile | null>;
	showFamilyTree(path: string): void;
}
