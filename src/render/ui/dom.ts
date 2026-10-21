/** Tiny element builder: `h("button", { class: "x", text: "Go" }, [child])`. */
export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Record<string, string> = {},
	children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) {
		if (name === "text") el.textContent = value;
		else el.setAttribute(name, value);
	}
	for (const child of children) el.append(child);
	return el;
}
