/** "[[Folder/Alice#Heading|Al]]" -> "Folder/Alice". Plain "Alice" is returned as is. */
export function linkTarget(raw: string): string {
	let text = raw.trim();
	const wiki = /^\[\[(.*)\]\]$/.exec(text);
	if (wiki) text = wiki[1];
	text = text.split("|")[0].split("#")[0].trim();
	return text.replace(/\.md$/i, "");
}

/** "World/Characters/Alice.md" -> "Alice". */
export function baseName(path: string): string {
	const file = path.split("/").pop() ?? path;
	return file.replace(/\.md$/i, "");
}
