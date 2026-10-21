import { describe, expect, it } from "vitest";
import { NODE_TYPES } from "./nodeTypes";
import { DEFAULT_TYPE_FOLDERS, cleanFolder, folderForType, type FolderConfig } from "./folders";

const config = (over: Partial<FolderConfig> = {}): FolderConfig => ({ base: "World", sortByType: true, typeFolders: {}, ...over });

describe("folderForType", () => {
	it("puts each type in its own folder under the notes folder by default", () => {
		expect(folderForType("character", config())).toBe("World/Characters");
		expect(folderForType("event", config())).toBe("World/Events");
		expect(folderForType("structure", config())).toBe("World/Structures");
		expect(folderForType("affiliation", config())).toBe("World/Affiliations");
	});

	it("has a default folder for every built-in node type", () => {
		for (const type of NODE_TYPES) expect(DEFAULT_TYPE_FOLDERS[type.id], type.id).toBeTruthy();
	});

	it("uses the notes folder for everything when sorting is off", () => {
		expect(folderForType("character", config({ sortByType: false }))).toBe("World");
		expect(folderForType("event", config({ sortByType: false, base: "" }))).toBe("");
	});

	it("lets a type's folder be renamed, nested, or set to the notes folder with a dot", () => {
		const typeFolders = { event: "Timeline/Events", character: "People", place: ".", item: "  " };
		expect(folderForType("event", config({ typeFolders }))).toBe("World/Timeline/Events");
		expect(folderForType("character", config({ typeFolders }))).toBe("World/People");
		expect(folderForType("place", config({ typeFolders }))).toBe("World");
		// blank means "use the default"
		expect(folderForType("item", config({ typeFolders }))).toBe("World/Items");
	});

	it("puts types without a folder, such as your own, in the notes folder", () => {
		expect(folderForType("ship", config())).toBe("World");
		expect(folderForType("ship", config({ typeFolders: { ship: "Ships" } }))).toBe("World/Ships");
	});

	it("works with an empty or messy notes folder", () => {
		expect(folderForType("character", config({ base: "" }))).toBe("Characters");
		expect(folderForType("character", config({ base: "/Lore//World/" }))).toBe("Lore/World/Characters");
	});

	it("never lets a folder name climb out of the vault", () => {
		expect(cleanFolder("../../etc")).toBe("etc");
		expect(cleanFolder("a/./b/../c")).toBe("a/b/c");
		expect(cleanFolder("C:\\Users\\x")).toBe("C:/Users/x");
		expect(folderForType("event", config({ typeFolders: { event: "../Elsewhere" } }))).toBe("World/Elsewhere");
	});
});
