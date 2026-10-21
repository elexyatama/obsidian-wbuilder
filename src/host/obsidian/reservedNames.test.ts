/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Obsidian drives its views, plugin and dialogs by calling methods on them by name. A
 * member of ours with the same name silently replaces Obsidian's (for example a method
 * called `open` on a view replaced the one Obsidian uses to attach the view and call
 * `onOpen`, so the tab stayed blank and nothing was reported). Many of these are internal
 * and missing from obsidian.d.ts, so the list below was taken from Obsidian's own code.
 */
const COMPONENT = [
	"load", "onload", "unload", "onunload", "addChild", "removeChild", "register", "registerEvent", "registerDomEvent",
	"registerScopeEvent", "registerInterval",
];

const VIEW = [
	...COMPONENT,
	"open", "close", "onOpen", "onClose", "getState", "setState", "getEphemeralState", "setEphemeralState", "getIcon",
	"onResize", "onPaneMenu", "onHeaderMenu", "onTabMenu", "getSideTooltipPlacement", "handleCut", "handleCopy", "handlePaste",
	"updateNavButtons", "handleDrop", "onGroupChange", "addAction", "onMoreOptions", "onMoreOptionsMenu", "updateViewState",
	"updateWorkspace", "updateShareMenuItem", "buildMenu", "headerEl", "titleEl", "contentEl", "containerEl", "leaf", "app",
	"icon", "navigation", "file", "data", "requestSave", "save", "onLoadFile", "onUnloadFile", "onRename", "allowNoFile",
];

const PLUGIN = [
	...COMPONENT, "app", "manifest", "loadData", "saveData", "addCommand", "removeCommand", "addRibbonIcon", "addStatusBarItem",
	"addSettingTab", "registerView", "registerExtensions", "registerMarkdownPostProcessor", "registerEditorExtension", "onUserEnable",
];

const MODAL = ["app", "scope", "containerEl", "modalEl", "titleEl", "contentEl", "open", "close", "onOpen", "onClose", "setTitle", "setContent", "setCloseCallback"];

const SETTING_TAB = ["app", "plugin", "containerEl", "icon", "display", "hide"];

const RESERVED_BY_BASE: Record<string, Set<string>> = {
	ItemView: new Set(VIEW),
	TextFileView: new Set(VIEW),
	Plugin: new Set(PLUGIN),
	Modal: new Set(MODAL),
	PluginSettingTab: new Set(SETTING_TAB),
};

/** Members we implement on purpose, because Obsidian requires them or we mark them `override`. */
const REQUIRED_IMPLEMENTATIONS = new Set(["getViewType", "getDisplayText", "getViewData", "setViewData", "clear", "display"]);

const dir = dirname(fileURLToPath(import.meta.url));

function ownMembers(source: string): Array<{ name: string; override: boolean }> {
	const members: Array<{ name: string; override: boolean }> = [];
	const declaration = /^\t(?!\t)((?:(?:private|protected|public|static|readonly|abstract|override|async|get|set)\s+)*)([A-Za-z_$][\w$]*)\s*(?:\(|<|:|=|;|\?)/gm;
	for (const m of source.matchAll(declaration)) {
		if (["constructor", "return", "if", "for", "while", "switch", "throw"].includes(m[2])) continue;
		members.push({ name: m[2], override: m[1].includes("override") });
	}
	// constructor parameter properties: `private readonly world: WorldContext`
	const ctor = /constructor\(([\s\S]*?)\)\s*\{/.exec(source);
	if (ctor) for (const m of ctor[1].matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\s*:/g)) members.push({ name: m[1], override: false });
	return members;
}

describe("classes that extend Obsidian's", () => {
	const BASES = Object.keys(RESERVED_BY_BASE).join("|");
	const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
	const extending = files
		.map((file) => ({ file, base: new RegExp(`extends\\s+(${BASES})\\b`).exec(readFileSync(join(dir, file), "utf8"))?.[1] }))
		.filter((f): f is { file: string; base: string } => f.base !== undefined);

	it("finds the view, plugin, modal and settings classes", () => {
		expect(extending.map((e) => e.file).sort()).toEqual(["FamilyTreeView.ts", "MapView.ts", "WBuilderPlugin.ts", "modals.ts", "settings.ts"]);
	});

	for (const { file, base } of extending) {
		it(`${file} does not replace a member Obsidian calls`, () => {
			const reserved = RESERVED_BY_BASE[base];
			const clashes = ownMembers(readFileSync(join(dir, file), "utf8"))
				.filter((m) => reserved.has(m.name) && !m.override && !REQUIRED_IMPLEMENTATIONS.has(m.name))
				.map((m) => m.name);
			expect(clashes).toEqual([]);
		});
	}

	it("would have caught the original bug", () => {
		const source = "export class V extends ItemView {\n\tprivate open(person: P): void {}\n}";
		expect(ownMembers(source).some((m) => RESERVED_BY_BASE.ItemView.has(m.name) && !m.override)).toBe(true);
	});
});
