export const VIEW_TYPE_MAP = "wbuilder-map";
export const VIEW_TYPE_FAMILY = "wbuilder-family";

/** The map a fresh vault gets. Notes join it with `map: world` in their frontmatter. */
export const DEFAULT_MAP = { id: "world", name: "World", seed: "wbuilder", width: 256, height: 256 } as const;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export const isImageExtension = (extension: string) => IMAGE_EXTENSIONS.has(extension.toLowerCase());
